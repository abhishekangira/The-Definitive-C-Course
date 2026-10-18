import { describe, expect, it, vi } from 'vitest';
import { requestTutorReply, statusToError, textFromChatBody, tutorPingMessages } from './client';
import { DEFAULT_TUTOR_BASE_URL } from './settings';

const KEY = 'sk-test-super-secret-value';
const messages = tutorPingMessages();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okBody(content: unknown) {
  return { choices: [{ message: { content } }] };
}

describe('statusToError', () => {
  it('maps 401, 402, 429 and 5xx to different messages, none of which contain a key', () => {
    const cases = [
      [401, 'unauthorized', '401'],
      [402, 'payment', '402'],
      [429, 'rate-limit', '429'],
      [500, 'provider', '500'],
      [503, 'provider', '503'],
    ] as const;
    for (const [status, code, snippet] of cases) {
      const result = statusToError(status);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(code);
        expect(result.message).toContain(snippet);
        expect(result.message).not.toContain(KEY);
      }
    }
  });
});

describe('textFromChatBody', () => {
  it('reads a string or an array of text parts, and rejects anything else', () => {
    expect(textFromChatBody(okBody('Hello'))).toBe('Hello');
    expect(textFromChatBody(okBody([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }]))).toBe('AB');
    for (const body of [null, {}, { choices: [] }, { choices: [{}] }, { choices: [{ message: {} }] }, { choices: [{ message: { content: 1 } }] }, { choices: [{ message: { content: null } }] }]) {
      expect(textFromChatBody(body)).toBeNull();
    }
  });
});

describe('requestTutorReply', () => {
  it('POSTs only to chat/completions, with the key in the Authorization header and not in the URL or body', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(String(input)).not.toContain(KEY);
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${KEY}`);
      expect(init?.body).not.toContain(KEY);
      const sent = JSON.parse(String(init?.body)) as { stream: boolean; messages: unknown };
      expect(sent.stream).toBe(false);
      expect(sent.messages).toEqual(messages);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse(200, okBody('ok'));
    });
    const logs = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = logs.map(name => vi.spyOn(console, name).mockImplementation(() => {}));
    const result = await requestTutorReply({
      baseUrl: DEFAULT_TUTOR_BASE_URL, apiKey: KEY, model: 'openai/gpt-4o-mini', messages, fetchImpl,
    });
    expect(result).toEqual({ ok: true, text: 'ok' });
    for (const spy of spies) {
      expect(spy.mock.calls.flat().join(' ')).not.toContain(KEY);
      spy.mockRestore();
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('caps a long reply and does not echo the key when the body contains it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody(`${'abcd'.repeat(2000)}${KEY}`)));
    const result = await requestTutorReply({
      baseUrl: DEFAULT_TUTOR_BASE_URL, apiKey: KEY, model: 'm', messages, maxOutputChars: 100, fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.length).toBeLessThan(150);
      expect(result.text).toContain('[Reply shortened.]');
      expect(result.text).not.toContain(KEY);
    }
  });

  it.each([
    [401, 'unauthorized'],
    [402, 'payment'],
    [429, 'rate-limit'],
    [500, 'provider'],
  ] as const)('status %s becomes %s and the message hides the key', async (status, code) => {
    const fetchImpl = vi.fn(async () => jsonResponse(status, { error: KEY }));
    const result = await requestTutorReply({ baseUrl: DEFAULT_TUTOR_BASE_URL, apiKey: KEY, model: 'm', messages, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
  });

  it('reports a network error when fetch rejects, including a timeout abort', async () => {
    const network = await requestTutorReply({
      baseUrl: DEFAULT_TUTOR_BASE_URL, apiKey: KEY, model: 'm', messages,
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
    });
    expect(network).toMatchObject({ ok: false, code: 'network' });

    const timed = await requestTutorReply({
      baseUrl: DEFAULT_TUTOR_BASE_URL, apiKey: KEY, model: 'm', messages, timeoutMs: 20,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) { reject(new Error('missing signal')); return; }
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
    });
    expect(timed).toMatchObject({ ok: false, code: 'network' });
    if (!timed.ok) expect(timed.message).not.toContain(KEY);
  });

  it('reports an empty or unparsable reply', async () => {
    for (const body of ['not-json', JSON.stringify({ choices: [] }), JSON.stringify(okBody('   ')), JSON.stringify(okBody(null))]) {
      const result = await requestTutorReply({
        baseUrl: DEFAULT_TUTOR_BASE_URL, apiKey: KEY, model: 'm', messages,
        fetchImpl: async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      });
      expect(result).toMatchObject({ ok: false, code: 'empty' });
    }
  });

  it('refuses a base URL that is not allowed, and a URL that contains the key, without calling fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody('no')));
    const http = await requestTutorReply({ baseUrl: 'http://evil.test/v1', apiKey: KEY, model: 'm', messages, fetchImpl });
    expect(http).toMatchObject({ ok: false, code: 'bad-url' });
    const leaked = await requestTutorReply({
      baseUrl: `https://example.com/v1?q=${KEY}`, apiKey: KEY, model: 'm', messages, fetchImpl,
    });
    expect(leaked).toMatchObject({ ok: false, code: 'bad-url' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
