// OpenAI-compatible chat client. Plain fetch, no SDK. The key is sent only as
// `Authorization: Bearer`, and only to tutorChatUrl(). Redirects are rejected so the
// key is not forwarded to another host. Nothing here is logged.

import { tutorChatUrl } from './settings';
import type { TutorMessage } from './prompt';

export const TUTOR_TIMEOUT_MS = 30_000;
export const TUTOR_MAX_OUTPUT_CHARS = 4_000;
export const TUTOR_MAX_TOKENS = 700;
/** Stop reading a provider body past this. The displayed reply is capped much lower. */
export const TUTOR_MAX_RESPONSE_BYTES = 1_000_000;
const MAX_BODY_CHARS = 500_000;

export type TutorErrorCode = 'unauthorized' | 'payment' | 'rate-limit' | 'network' | 'provider' | 'empty' | 'bad-url';

export type TutorResult =
  | { ok: true; text: string }
  | { ok: false; code: TutorErrorCode; message: string };

export const TUTOR_ERROR_TEXT: Record<Exclude<TutorErrorCode, 'provider'>, string> = {
  unauthorized: 'The API key was rejected (401). Check it in Settings.',
  payment: 'The provider says this key is out of credit (402).',
  'rate-limit': 'The provider is rate-limiting requests (429). Wait and try again.',
  network: 'The request did not finish (network error or timeout). Your code is still here.',
  empty: 'The provider sent an empty or unreadable reply.',
  'bad-url': 'The tutor URL is not allowed. Use https, or http on localhost only.',
};

export function tutorErrorMessage(code: TutorErrorCode, status?: number): string {
  if (code === 'provider') {
    return status
      ? `The provider returned an error (${status}). Your code is still here; try again later.`
      : 'The provider returned an error. Your code is still here; try again later.';
  }
  return TUTOR_ERROR_TEXT[code];
}

function fail(code: TutorErrorCode, status?: number): TutorResult {
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

export interface TutorRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: readonly TutorMessage[];
  timeoutMs?: number;
  maxOutputChars?: number;
  fetchImpl?: typeof fetch;
}

/**
 * POST {base}/chat/completions. The returned text is capped and the key is redacted from it.
 * Error messages never include the key or the response body (a provider might echo the key).
 */
export async function requestTutorReply(req: TutorRequest): Promise<TutorResult> {
  const endpoint = tutorChatUrl(req.baseUrl);
  if (!endpoint || !req.apiKey || !req.model.trim()) return fail('bad-url');
  let url: URL;
  try { url = new URL(endpoint); } catch { return fail('bad-url'); }
  if (keyInUrl(url, req.apiKey)) return fail('bad-url');

  const payload = JSON.stringify({
    model: req.model,
    messages: req.messages,
    temperature: 0.3,
    max_tokens: TUTOR_MAX_TOKENS,
    stream: false,
  });
  if (payload.length > MAX_BODY_CHARS) return fail('provider');

  const timeoutMs = req.timeoutMs ?? TUTOR_TIMEOUT_MS;
  const fetchImpl = req.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
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
  const redacted = redactKey(text, req.apiKey);
  const max = req.maxOutputChars ?? TUTOR_MAX_OUTPUT_CHARS;
  const capped = redacted.length > max ? `${redacted.slice(0, max)}\n[Reply shortened.]` : redacted;
  return { ok: true, text: capped };
}

/** A connection check. Sends no learner code. */
export function tutorPingMessages(): TutorMessage[] {
  return [
    { role: 'system', content: 'Reply with the single word ok.' },
    { role: 'user', content: 'ok' },
  ];
}
