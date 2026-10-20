// The streaming request of the lesson chat. Every test builds the response the way a provider sends it: server-sent
// events cut into arbitrary chunks. No test calls the network.
import { describe, expect, it, vi } from 'vitest';
import { streamTutorReply, tutorRequestBody, TUTOR_CHAT_MAX_TOKENS, type TutorStreamRequest } from './client';
import { DEFAULT_TUTOR_BASE_URL } from './settings';
import type { TutorMessage } from './prompt';

const KEY = 'sk-stream-secret-value';
const messages: TutorMessage[] = [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'what is a pointer?' }];
const enc = new TextEncoder();

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

function stream(chunks: Array<string | Uint8Array>, init: { status?: number; type?: string; onCancel?: () => void } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk);
      controller.close();
    },
    cancel() { init.onCancel?.(); },
  });
  return new Response(body, { status: init.status ?? 200, headers: { 'Content-Type': init.type ?? 'text/event-stream' } });
}

/** A body that sends the given chunks and then waits, as a model that is still thinking does. */
function open(chunks: string[], onCancel?: () => void): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) { controller.enqueue(enc.encode(chunks[i++])); return; }
      return new Promise<void>(() => {});
    },
    cancel() { onCancel?.(); },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function run(fetchImpl: NonNullable<TutorStreamRequest['fetchImpl']>, extra: Partial<TutorStreamRequest> = {}) {
  const seen: string[] = [];
  const result = streamTutorReply({
    baseUrl: DEFAULT_TUTOR_BASE_URL, apiKey: KEY, model: '', messages, fetchImpl, onText: t => seen.push(t), ...extra,
  });
  return { result, seen };
}

describe('the streaming request', () => {
  it('asks for stream: true on top of the usual body, to chat/completions only, with the key in the header', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      expect(init?.referrerPolicy).toBe('no-referrer');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${KEY}`);
      expect(headers.Accept).toContain('text/event-stream');
      expect(String(init?.body)).not.toContain(KEY);
      expect(JSON.parse(String(init?.body))).toEqual({
        models: ['openai/gpt-oss-120b', 'google/gemini-3.5-flash-lite', 'nvidia/nemotron-3.5-super-vl:free'],
        provider: { only: ['groq', 'cerebras', 'google-ai-studio', 'nvidia'], allow_fallbacks: true },
        messages,
        max_tokens: TUTOR_CHAT_MAX_TOKENS,
        stream: true,
      });
      return stream([delta('ok')]);
    });
    const { result } = run(fetchImpl);
    expect(await result).toEqual({ ok: true, text: 'ok' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('adds only `stream` to the plain body of a model the learner chose, and never to a request that did not ask for it', () => {
    expect(Object.keys(tutorRequestBody({ host: 'tutor.test', model: 'm', messages, stream: true }) ?? {}).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
    expect(Object.keys(tutorRequestBody({ host: 'tutor.test', model: 'm', messages }) ?? {}).sort()).toEqual(['max_tokens', 'messages', 'model']);
    expect(tutorRequestBody({ host: 'tutor.test', model: '', messages, stream: true }), 'no course default off OpenRouter').toBeNull();
  });

  it('reports the reply as it grows, across chunk boundaries inside an event, inside a line and inside a character', async () => {
    const bytes = enc.encode(delta('Naïve ') + delta('pointer') + 'data: [DONE]\n\n');
    const cut = [3, 29, 31, bytes.length - 4].sort((a, b) => a - b);
    const chunks: Uint8Array[] = [];
    let from = 0;
    for (const at of [...cut, bytes.length]) { chunks.push(bytes.slice(from, at)); from = at; }
    const { result, seen } = run(async () => stream(chunks));
    expect(await result).toEqual({ ok: true, text: 'Naïve pointer' });
    expect(seen.at(-1)).toBe('Naïve pointer');
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((t, i) => i === 0 || t.startsWith(seen[i - 1])), 'each report extends the last').toBe(true);
  });

  it('reads CRLF events, ignores keep-alive comments and other fields, and a last event with no blank line after it', async () => {
    const crlf = (t: string) => delta(t).replace(/\n/g, '\r\n');
    const { result } = run(async () => stream([': OPENROUTER PROCESSING\n\n', 'event: message\r\n', crlf('A'), ': keep-alive\n\n', `data: ${JSON.stringify({ choices: [{ delta: { content: 'B' } }] })}`]));
    expect(await result).toEqual({ ok: true, text: 'AB' });
  });

  it('skips events that are not JSON or carry no text (role announcements, reasoning, usage)', async () => {
    const { result } = run(async () => stream([
      'data: not json\n\n',
      `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'thinking about pointers' } }] })}\n\n`,
      delta('Answer'),
      `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 9 } })}\n\n`,
      'data: [DONE]\n\n',
    ]));
    expect(await result).toEqual({ ok: true, text: 'Answer' });
  });

  it('keeps what arrived and reports a provider error that comes mid-stream', async () => {
    const { result, seen } = run(async () => stream([delta('Half an'), `data: ${JSON.stringify({ error: { message: `upstream died ${KEY}` } })}\n\n`, delta('never read')]));
    const done = await result;
    expect(done).toMatchObject({ ok: false, code: 'provider' });
    expect(JSON.stringify(done)).not.toContain(KEY);
    expect(seen.at(-1)).toBe('Half an');
  });

  it('treats finish_reason "error" as a failure too', async () => {
    const { result } = run(async () => stream([`data: ${JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'error' }] })}\n\n`]));
    expect(await result).toMatchObject({ ok: false, code: 'provider' });
  });

  it('accepts a provider that ignores `stream` and answers with one JSON body', async () => {
    const { result, seen } = run(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'All at once' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(await result).toEqual({ ok: true, text: 'All at once' });
    expect(seen).toEqual(['All at once']);
  });

  it.each([
    [401, 'unauthorized'],
    [402, 'payment'],
    [429, 'rate-limit'],
    [500, 'provider'],
  ] as const)('maps status %s to %s without echoing the key', async (status, code) => {
    const { result, seen } = run(async () => new Response(JSON.stringify({ error: KEY }), { status, headers: { 'Content-Type': 'application/json' } }));
    const done = await result;
    expect(done).toMatchObject({ ok: false, code });
    expect(JSON.stringify(done)).not.toContain(KEY);
    expect(seen).toEqual([]);
  });

  it('reports a network error when fetch rejects, and an empty stream as empty', async () => {
    expect(await run(async () => { throw new TypeError('Failed to fetch'); }).result).toMatchObject({ ok: false, code: 'network' });
    expect(await run(async () => stream([': only a comment\n\n', 'data: [DONE]\n\n'])).result).toMatchObject({ ok: false, code: 'empty' });
    expect(await run(async () => stream([])).result).toMatchObject({ ok: false, code: 'empty' });
  });

  it('never shows the key, even when the model repeats it in two pieces', async () => {
    const { result, seen } = run(async () => stream([delta(`the key is ${KEY.slice(0, 9)}`), delta(`${KEY.slice(9)} ok`)]));
    const done = await result;
    expect(done.ok && done.text).toBe('the key is [redacted] ok');
    expect(seen.at(-1)).toBe('the key is [redacted] ok');
    expect(seen.filter(s => s.includes(KEY.slice(0, 6))), 'no frame shows the start of the key').toEqual([]);
  });

  it('never leaves the start of the key on screen when a provider error cuts the reply off', async () => {
    const { result, seen } = run(async () => stream([delta(`the key is ${KEY.slice(0, 12)}`), 'data: {"error":{"message":"overloaded"}}\n\n']));
    expect(await result).toMatchObject({ ok: false, code: 'provider' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter(s => s.includes(KEY.slice(0, 6))), 'no frame shows the start of the key').toEqual([]);
  });

  it('never shows the start of the key when the length cap cuts through it', async () => {
    const { result, seen } = run(async () => stream([delta(`${'a'.repeat(100)}${KEY.slice(0, 10)}`), delta(`${KEY.slice(10)}${'b'.repeat(50)}`)]), { maxOutputChars: 108 });
    const done = await result;
    expect(done.ok).toBe(true);
    for (const s of [...seen, done.ok ? done.text : '']) expect(s).not.toContain(KEY.slice(0, 6));
  });

  it('shows the whole reply once it ends, even when its last letters could start the key', async () => {
    const { result, seen } = run(async () => stream([delta('pointers'), 'data: [DONE]\n\n']));
    const done = await result;
    expect(done.ok && done.text).toBe('pointers');
    expect(seen.at(-1)).toBe('pointers');
  });

  it('stops reading and says so when the reply passes the cap', async () => {
    const onCancel = vi.fn();
    const chunks = Array.from({ length: 50 }, () => delta('abcd'.repeat(25)));
    const { result, seen } = run(async () => stream(chunks, { onCancel }), { maxOutputChars: 120 });
    const done = await result;
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.text.endsWith('\n[Reply shortened.]')).toBe(true);
      expect(done.text.length).toBeLessThan(120 + 30);
    }
    expect(seen.at(-1)).toBe(done.ok ? done.text : '');
    expect(onCancel, 'the rest of the body is not read').toHaveBeenCalled();
  });

  it('refuses one event that never ends', async () => {
    const huge = Array.from({ length: 6 }, () => `data: ${'x'.repeat(60_000)}`);
    expect(await run(async () => stream(huge)).result).toMatchObject({ ok: false, code: 'provider' });
  });

  it('stops when the learner stops, and keeps the text that arrived', async () => {
    const controller = new AbortController();
    const onCancel = vi.fn();
    const { result, seen } = run(async () => open([delta('So far')], onCancel), { signal: controller.signal });
    await vi.waitFor(() => expect(seen).toEqual(['So far']));
    controller.abort();
    expect(await result).toMatchObject({ ok: false, code: 'aborted' });
    expect(seen).toEqual(['So far']);
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not even send a request when it was stopped before it started', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => stream([delta('x')]));
    expect(await run(fetchImpl, { signal: controller.signal }).result).toMatchObject({ ok: false, code: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up on a connection that goes quiet, as a network error and not as a stop', async () => {
    const { result, seen } = run(async () => open([delta('Start')]), { idleTimeoutMs: 40 });
    expect(await result).toMatchObject({ ok: false, code: 'network' });
    expect(seen).toEqual(['Start']);
  });

  it('counts a keep-alive comment as life, so a model that thinks for a while is not cut off', async () => {
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < 4; i++) { controller.enqueue(enc.encode(': OPENROUTER PROCESSING\n\n')); await new Promise(r => setTimeout(r, 30)); }
        controller.enqueue(enc.encode(delta('late answer') + 'data: [DONE]\n\n'));
        controller.close();
      },
    });
    const { result } = run(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }), { idleTimeoutMs: 80 });
    expect(await result).toEqual({ ok: true, text: 'late answer' });
  });

  it('refuses a URL that is not allowed, or that holds the key, or a missing model, before any request', async () => {
    const fetchImpl = vi.fn(async () => stream([delta('x')]));
    expect(await run(fetchImpl, { baseUrl: 'http://example.com/v1' }).result).toMatchObject({ ok: false, code: 'bad-url' });
    expect(await run(fetchImpl, { baseUrl: `https://tutor.test/${KEY}/v1` }).result).toMatchObject({ ok: false, code: 'bad-url' });
    expect(await run(fetchImpl, { baseUrl: 'https://tutor.test/v1', model: '' }).result).toMatchObject({ ok: false, code: 'no-model' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
