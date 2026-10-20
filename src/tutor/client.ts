// OpenRouter-style chat client. Plain fetch, no SDK. The key is sent only as
// `Authorization: Bearer`, and only to tutorChatUrl(). Redirects are rejected so the
// key is not forwarded to another host. Nothing here is logged.

import { OPENROUTER_HOST, tutorChatUrl } from './settings';
import type { TutorMessage } from './prompt';

export const TUTOR_TIMEOUT_MS = 30_000;
export const TUTOR_MAX_OUTPUT_CHARS = 4_000;
export const TUTOR_MAX_TOKENS = 700;
/** The lesson chat streams, so it can afford a longer answer. */
export const TUTOR_CHAT_MAX_TOKENS = 1_200;
export const TUTOR_CHAT_MAX_OUTPUT_CHARS = 6_000;
/** A stream may think for a while, but a silent connection longer than this is dead. Any bytes, even a keep-alive comment, reset it. */
export const TUTOR_STREAM_IDLE_MS = 30_000;
export const TUTOR_STREAM_TOTAL_MS = 120_000;
/** One server-sent event is a few hundred bytes. A buffer this big without a blank line is not a stream we understand. */
const MAX_EVENT_CHARS = 262_144;
/** Tried in this order by OpenRouter. The course picks them; the learner does not. */
export const TUTOR_MODELS = ['openai/gpt-oss-120b', 'google/gemini-3.5-flash-lite', 'nvidia/nemotron-3.5-super-vl:free'] as const;
/** OpenRouter provider routing: only these providers, with a fallback between them. */
export const TUTOR_PROVIDER = { only: ['groq', 'cerebras', 'google-ai-studio', 'nvidia'], allow_fallbacks: true } as const;
/** Stop reading a provider body past this. The displayed reply is capped much lower. */
export const TUTOR_MAX_RESPONSE_BYTES = 1_000_000;
const MAX_BODY_CHARS = 500_000;

export type TutorErrorCode = 'unauthorized' | 'payment' | 'rate-limit' | 'network' | 'provider' | 'empty' | 'bad-url' | 'no-model' | 'aborted';

export type TutorResult =
  | { ok: true; text: string }
  | { ok: false; code: TutorErrorCode; message: string };

export const TUTOR_ERROR_TEXT: Record<Exclude<TutorErrorCode, 'provider'>, string> = {
  unauthorized: 'The API key was rejected (401). Check it in Settings.',
  payment: 'The provider says this key is out of credit (402).',
  'rate-limit': 'The provider is rate-limiting requests (429). Wait and try again.',
  network: 'The request did not finish (network error or timeout). Nothing you wrote was lost.',
  empty: 'The provider sent an empty or unreadable reply.',
  'bad-url': 'The tutor URL is not allowed. Use https, or http on localhost only.',
  'no-model': 'Choose a model in Settings first. The course default models only work through OpenRouter.',
  aborted: 'Stopped.',
};

export function tutorErrorMessage(code: TutorErrorCode, status?: number): string {
  if (code === 'provider') {
    return status
      ? `The provider returned an error (${status}). Nothing you wrote was lost; try again later.`
      : 'The provider returned an error. Nothing you wrote was lost; try again later.';
  }
  return TUTOR_ERROR_TEXT[code];
}

type Failure = Extract<TutorResult, { ok: false }>;

function fail(code: TutorErrorCode, status?: number): Failure {
  return { ok: false, code, message: tutorErrorMessage(code, status) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Text from an OpenAI-compatible body, or null when the shape is not one we can show. */
export function textFromChatBody(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) return null;
  const first = body.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const content = first.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && typeof part.text === 'string') parts.push(part.text);
  }
  return parts.length ? parts.join('') : null;
}

export function statusToError(status: number): TutorResult {
  if (status === 401) return fail('unauthorized', status);
  if (status === 402) return fail('payment', status);
  if (status === 429) return fail('rate-limit', status);
  return fail('provider', status);
}

function keyInUrl(url: URL, apiKey: string): boolean {
  if (url.username || url.password) return true;
  if (!apiKey) return false;
  if (url.hash.includes(apiKey)) return true;
  for (const value of url.searchParams.values()) if (value.includes(apiKey)) return true;
  return keyInPathOrHost(url, apiKey);
}

/** A key in a host label or a path segment. Short keys match a whole label or segment only, so `v1` is not every path. */
function keyInPathOrHost(url: URL, apiKey: string): boolean {
  const needle = apiKey.toLowerCase();
  const matches = (part: string) => part === needle || (needle.length >= 8 && part.includes(needle));
  if (url.hostname.toLowerCase().split('.').some(matches)) return true;
  let path = url.pathname;
  try { path = decodeURIComponent(url.pathname); } catch { /* keep the raw path */ }
  return path.toLowerCase().split('/').filter(Boolean).some(matches);
}

function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('[redacted]');
}

/** Read at most `maxBytes`. A longer body, or a declared Content-Length over the cap, is refused. */
async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return text.length > maxBytes ? null : text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/**
 * The request body. With no model chosen it is the owner's fixed OpenRouter body: `models`, `provider`,
 * `messages` and `max_tokens`, and nothing else. A model the learner chose gives the plain
 * OpenAI-compatible body, so a provider that rejects unknown fields never sees OpenRouter's. The course
 * default exists only for OpenRouter: for any other host with no model this returns null.
 * The lesson chat adds `stream: true` to either body and nothing more.
 */
export function tutorRequestBody(input: {
  host: string;
  model: string;
  messages: readonly TutorMessage[];
  maxTokens?: number;
  stream?: boolean;
}): Record<string, unknown> | null {
  const model = input.model.trim();
  const max_tokens = input.maxTokens ?? TUTOR_MAX_TOKENS;
  const stream = input.stream ? { stream: true } : {};
  if (model) return { model, messages: input.messages, max_tokens, ...stream };
  if (input.host !== OPENROUTER_HOST) return null;
  return { models: TUTOR_MODELS, provider: TUTOR_PROVIDER, messages: input.messages, max_tokens, ...stream };
}

export interface TutorRequest {
  baseUrl: string;
  apiKey: string;
  /** The learner's own model id. Empty means the course default, which only OpenRouter understands. */
  model: string;
  messages: readonly TutorMessage[];
  timeoutMs?: number;
  maxOutputChars?: number;
  fetchImpl?: typeof fetch;
}

type Prepared = { ok: true; url: URL; payload: string } | Failure;

/** Everything both request kinds check before a byte leaves: the URL, that the key is not in it, the body and its size. */
function prepare(req: { baseUrl: string; apiKey: string; model: string; messages: readonly TutorMessage[]; maxTokens?: number; stream?: boolean }): Prepared {
  const endpoint = tutorChatUrl(req.baseUrl);
  if (!endpoint || !req.apiKey) return fail('bad-url');
  let url: URL;
  try { url = new URL(endpoint); } catch { return fail('bad-url'); }
  if (keyInUrl(url, req.apiKey)) return fail('bad-url');

  const requestBody = tutorRequestBody({ host: url.host, model: req.model, messages: req.messages, maxTokens: req.maxTokens, stream: req.stream });
  if (!requestBody) return fail('no-model');
  const payload = JSON.stringify(requestBody);
  if (payload.length > MAX_BODY_CHARS) return fail('provider');
  return { ok: true, url, payload };
}

function fetchInit(apiKey: string, payload: string, signal: AbortSignal, accept: string): RequestInit {
  return {
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: accept,
    },
    body: payload,
    signal,
  };
}

/** Redact the key, then cap. The cap leaves a note so the learner knows the reply was cut. */
function shown(text: string, apiKey: string, max: number): string {
  const redacted = redactKey(text, apiKey);
  return redacted.length > max ? `${redacted.slice(0, max)}\n[Reply shortened.]` : redacted;
}

/**
 * POST {base}/chat/completions. The returned text is capped and the key is redacted from it.
 * Error messages never include the key or the response body (a provider might echo the key).
 */
export async function requestTutorReply(req: TutorRequest): Promise<TutorResult> {
  const prepared = prepare(req);
  if (!prepared.ok) return prepared;

  const timeoutMs = req.timeoutMs ?? TUTOR_TIMEOUT_MS;
  const fetchImpl = req.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(prepared.url.toString(), fetchInit(req.apiKey, prepared.payload, AbortSignal.timeout(timeoutMs), 'application/json'));
  } catch {
    // Never surface the thrown message: it can contain the request URL, and a provider error must not echo the key.
    return fail('network');
  }

  if (!response.ok) return statusToError(response.status);
  const raw = await readLimited(response, TUTOR_MAX_RESPONSE_BYTES);
  if (raw === null) return fail('empty');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail('empty'); }
  const text = textFromChatBody(body);
  if (text === null || text.trim() === '') return fail('empty');
  return { ok: true, text: shown(text, req.apiKey, req.maxOutputChars ?? TUTOR_MAX_OUTPUT_CHARS) };
}

export interface TutorStreamRequest {
  baseUrl: string;
  apiKey: string;
  /** The learner's own model id. Empty means the course default, which only OpenRouter understands. */
  model: string;
  messages: readonly TutorMessage[];
  /** Called with the whole reply so far (key redacted, capped) each time it grows. */
  onText: (textSoFar: string) => void;
  /** Stops the request. The result is `aborted` and `onText` keeps whatever it last showed. */
  signal?: AbortSignal;
  maxTokens?: number;
  maxOutputChars?: number;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** What one parsed `data:` payload adds to the reply. `error` means the provider failed mid-stream. */
function readStreamChunk(json: unknown): { text: string; error: boolean } {
  if (!isRecord(json)) return { text: '', error: false };
  if (json.error !== undefined && json.error !== null) return { text: '', error: true };
  const first = Array.isArray(json.choices) ? json.choices[0] : null;
  if (!isRecord(first)) return { text: '', error: false };
  const error = first.finish_reason === 'error';
  const delta = isRecord(first.delta) ? first.delta.content : undefined;
  if (typeof delta === 'string') return { text: delta, error };
  if (Array.isArray(delta)) {
    return { text: delta.map(p => (isRecord(p) && typeof p.text === 'string' ? p.text : '')).join(''), error };
  }
  return { text: '', error };
}

/**
 * Like requestTutorReply, but asks for `stream: true` and reports the reply as it grows. Same URL checks, same
 * headers, no redirects, and the key is redacted from everything shown. A provider that ignores `stream` and
 * answers with plain JSON still works (the reply then arrives in one piece). The request ends when the caller's
 * signal fires, when no bytes arrive for `idleTimeoutMs`, or after `totalTimeoutMs`.
 */
export async function streamTutorReply(req: TutorStreamRequest): Promise<TutorResult> {
  const prepared = prepare({ ...req, maxTokens: req.maxTokens ?? TUTOR_CHAT_MAX_TOKENS, stream: true });
  if (!prepared.ok) return prepared;
  if (req.signal?.aborted) return fail('aborted');

  const controller = new AbortController();
  let timedOut = false;
  const stop = () => controller.abort();
  const giveUp = () => { timedOut = true; controller.abort(); };
  req.signal?.addEventListener('abort', stop, { once: true });
  const idleMs = req.idleTimeoutMs ?? TUTOR_STREAM_IDLE_MS;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const bump = () => { clearTimeout(idle); idle = setTimeout(giveUp, idleMs); };
  const total = setTimeout(giveUp, req.totalTimeoutMs ?? TUTOR_STREAM_TOTAL_MS);
  /** Our own stop is `aborted`. A timeout, or a connection that dropped, is a network problem. */
  const interrupted = (): Failure => fail(controller.signal.aborted && !timedOut ? 'aborted' : 'network');

  const max = req.maxOutputChars ?? TUTOR_CHAT_MAX_OUTPUT_CHARS;
  let reply = '';
  let lastShown = '';
  /** How much of the end of `text` could be the start of the key, which the next chunk may complete. */
  const keyStartAtEnd = (text: string) => {
    for (let n = Math.min(req.apiKey.length - 1, text.length); n > 0; n--) if (req.apiKey.startsWith(text.slice(-n))) return n;
    return 0;
  };
  /**
   * While the reply grows, hold back a tail that could be the start of the key: it is shown only once the next chunk
   * proves it is not the key, or the reply ends normally (`whole`). A reply cut short (error, Stop, cap) never shows it.
   */
  const emit = (whole = false) => {
    const redacted = redactKey(reply, req.apiKey);
    const text = shown(whole ? redacted : redacted.slice(0, redacted.length - keyStartAtEnd(redacted)), '', max);
    if (text === lastShown) return;
    lastShown = text;
    req.onText(text);
  };

  try {
    bump();
    let response: Response;
    try {
      response = await (req.fetchImpl ?? fetch)(prepared.url.toString(), fetchInit(req.apiKey, prepared.payload, controller.signal, 'text/event-stream, application/json'));
    } catch {
      return interrupted();
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return statusToError(response.status);
    }

    // A provider that does not stream sends one JSON body.
    if (/application\/json/i.test(response.headers.get('content-type') ?? '')) {
      const raw = await readLimited(response, TUTOR_MAX_RESPONSE_BYTES);
      if (controller.signal.aborted) return interrupted();
      if (raw === null) return fail('empty');
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return fail('empty'); }
      const text = textFromChatBody(body);
      if (text === null || text.trim() === '') return fail('empty');
      reply = text;
      emit(true);
      return { ok: true, text: lastShown };
    }

    const reader = response.body?.getReader();
    if (!reader) return fail('empty');
    // A stop or a timeout must end a read that is waiting for the next chunk, whatever the fetch implementation does with its signal.
    controller.signal.addEventListener('abort', () => { void reader.cancel().catch(() => {}); }, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    let finished = false;
    let broken = false;
    let capped = false;

    /** One server-sent event: its `data:` lines, joined. Comments (`: keep-alive`) and other fields are ignored. */
    const handle = (event: string) => {
      const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (data === '') return;
      if (data.trim() === '[DONE]') { finished = true; return; }
      let json: unknown;
      try { json = JSON.parse(data); } catch { return; }
      const chunk = readStreamChunk(json);
      if (chunk.error) broken = true;
      if (chunk.text) { reply += chunk.text; emit(); }
    };

    try {
      while (!finished && !broken) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();
        bytes += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        for (let m = /\r?\n\r?\n/.exec(buffer); m && !finished && !broken; m = /\r?\n\r?\n/.exec(buffer)) {
          handle(buffer.slice(0, m.index));
          buffer = buffer.slice(m.index + m[0].length);
        }
        if (buffer.length > MAX_EVENT_CHARS || bytes > TUTOR_MAX_RESPONSE_BYTES) { broken = true; break; }
        // Past the cap more text would not be shown, so stop paying for it.
        if (redactKey(reply, req.apiKey).length > max) { capped = true; break; }
      }
      if (!finished && !broken) {
        buffer += decoder.decode();
        if (buffer.trim() !== '') handle(buffer);
      }
    } catch {
      return interrupted();
    } finally {
      void reader.cancel().catch(() => {});
    }

    if (controller.signal.aborted) return interrupted();
    if (broken && reply.trim() === '') return fail('provider');
    if (reply.trim() === '') return fail('empty');
    // A provider error after some text: the learner keeps what arrived, and the caller is told the reply is not whole.
    if (broken) return fail('provider');
    if (!capped) emit(true);
    return { ok: true, text: lastShown };
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
    req.signal?.removeEventListener('abort', stop);
  }
}

/** A connection check. Sends no learner code. */
export function tutorPingMessages(): TutorMessage[] {
  return [{ role: 'user', content: 'Reply with the single word ok.' }];
}
