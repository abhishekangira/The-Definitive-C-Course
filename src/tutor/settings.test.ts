import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUTOR_BASE_URL, TUTOR_STORAGE_KEY, acceptTutorHost, cleanTutorKey, commitTutorDraft, consentCovers,
  emptyTutorSettings, getTutorSettings, loadTutorSettings, parseTutorBaseUrl, parseTutorSettings, removeTutorKey,
  replaceTutorSettings, saveTutorSettings, tutorChatUrl, tutorHost,
} from './settings';

function memory() {
  const bag = new Map<string, string>();
  return {
    bag,
    getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
    setItem: (k: string, v: string) => { bag.set(k, v); },
    removeItem: (k: string) => { bag.delete(k); },
  };
}

describe('tutor base URL', () => {
  it('canonicalises the OpenRouter default and appends chat/completions once', () => {
    expect(parseTutorBaseUrl('https://openrouter.ai/api/v1')).toBe(DEFAULT_TUTOR_BASE_URL);
    expect(parseTutorBaseUrl('https://openrouter.ai/api/v1/')).toBe(DEFAULT_TUTOR_BASE_URL);
    expect(parseTutorBaseUrl('https://openrouter.ai/api/v1/chat/completions')).toBe(DEFAULT_TUTOR_BASE_URL);
    expect(tutorChatUrl(DEFAULT_TUTOR_BASE_URL)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(tutorHost(DEFAULT_TUTOR_BASE_URL)).toBe('openrouter.ai');
  });

  it('allows http only on loopback, including a port and IPv6', () => {
    expect(parseTutorBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
    expect(tutorHost('http://127.0.0.1:11434/v1')).toBe('127.0.0.1:11434');
    expect(parseTutorBaseUrl('http://localhost:8080/v1')).toBe('http://localhost:8080/v1');
    expect(parseTutorBaseUrl('http://[::1]:8080/v1')).toBe('http://[::1]:8080/v1');
  });

  it('keeps an ordinary query and rejects secrets, userinfo, cleartext and other schemes', () => {
    expect(parseTutorBaseUrl('https://example.com/openai/v1?api-version=2024-10-01')).toBe('https://example.com/openai/v1?api-version=2024-10-01');
    for (const bad of [
      'http://example.com/v1',
      'http://openrouter.ai/api/v1',
      'https://user:secret@example.com/v1',
      'https://example.com/v1#key',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'https://example.com/v1?api_key=sk-live',
      'https://example.com/v1?token=abc',
      'https://example.com/v1?turkey=1&secret=no',
      'not a url',
      '',
    ]) expect(parseTutorBaseUrl(bad), bad).toBeNull();
    // `turkey` alone is not a key parameter.
    expect(parseTutorBaseUrl('https://example.com/v1?turkey=1')).toBe('https://example.com/v1?turkey=1');
  });

  it('will not build a chat URL whose host differs from the base', () => {
    expect(tutorChatUrl('http://evil.test/v1')).toBeNull();
    expect(tutorChatUrl(DEFAULT_TUTOR_BASE_URL)).toContain('openrouter.ai');
  });
});

describe('parseTutorSettings (untrusted storage)', () => {
  it('drops wrong types, unknown keys and a non-v1 document', () => {
    expect(parseTutorSettings(null)).toEqual(emptyTutorSettings());
    expect(parseTutorSettings([])).toEqual(emptyTutorSettings());
    expect(parseTutorSettings('sk-no')).toEqual(emptyTutorSettings());
    expect(parseTutorSettings({ version: 2, apiKey: 'sk-should-not-stick' }).apiKey).toBe('');
    const parsed = parseTutorSettings({
      version: 1,
      apiKey: 12,
      baseUrl: 'http://evil.test/v1',
      model: { id: 'x' },
      consentedHost: 'evil.test',
      extra: '<script>',
    });
    expect(parsed).toEqual(emptyTutorSettings());
    expect(JSON.stringify(parsed)).not.toContain('script');
  });

  it('does not let __proto__ pollute, and rejects a key with whitespace or control characters', () => {
    const raw = JSON.parse('{"version":1,"__proto__":{"polluted":1},"apiKey":"sk-ok","constructor":{"prototype":{"polluted":1}}}') as unknown;
    const parsed = parseTutorSettings(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parsed.apiKey).toBe('sk-ok');
    expect(cleanTutorKey('Bearer sk-ok')).toBe('sk-ok');
    expect(cleanTutorKey('sk-ok\nmore')).toBe('');
    expect(cleanTutorKey(`sk-${'a'.repeat(3000)}`)).toBe('');
    expect(cleanTutorKey('sk ok')).toBe('');
  });

  it('keeps consent only when it names the base URL host', () => {
    const ok = parseTutorSettings({
      version: 1, apiKey: 'sk-ok', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', consentedHost: 'openrouter.ai',
    });
    expect(consentCovers(ok)).toBe(true);
    const moved = parseTutorSettings({ ...ok, baseUrl: 'https://api.openai.com/v1' });
    expect(moved.baseUrl).toBe('https://api.openai.com/v1');
    expect(moved.consentedHost).toBe('');
    expect(consentCovers(moved)).toBe(false);
  });
});

describe('load and save', () => {
  it('round-trips a valid document and stores nothing but the tutor key', () => {
    const store = memory();
    const settings = parseTutorSettings({
      version: 1, apiKey: 'sk-test-value', baseUrl: DEFAULT_TUTOR_BASE_URL, model: 'openai/gpt-4o-mini', consentedHost: 'openrouter.ai',
    });
    expect(saveTutorSettings(settings, store)).toBe(true);
    expect([...store.bag.keys()]).toEqual([TUTOR_STORAGE_KEY]);
    expect(loadTutorSettings(store)).toEqual(settings);
    const text = store.bag.get(TUTOR_STORAGE_KEY)!;
    expect(text).toContain('sk-test-value');
    expect(text).not.toContain('progress');
  });

  it('returns defaults when storage throws, the text is huge, or it is not JSON', () => {
    expect(loadTutorSettings({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } })).toEqual(emptyTutorSettings());
    const huge = memory();
    huge.setItem(TUTOR_STORAGE_KEY, 'x'.repeat(20_001));
    expect(loadTutorSettings(huge)).toEqual(emptyTutorSettings());
    const bad = memory();
    bad.setItem(TUTOR_STORAGE_KEY, '{"version":1,');
    expect(loadTutorSettings(bad)).toEqual(emptyTutorSettings());
    expect(saveTutorSettings(emptyTutorSettings(), { getItem: () => null, setItem: () => { throw new Error('quota'); } })).toBe(false);
  });
});

describe('commitTutorDraft', () => {
  it('rejects an illegal URL without wiping a stored key, and a new host drops consent', () => {
    replaceTutorSettings(parseTutorSettings({
      version: 1, apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: 'm', consentedHost: 'openrouter.ai',
    }));
    const bad = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: 'http://evil.test/v1', model: 'm' });
    expect(bad.problems).toEqual(['url']);
    expect(bad.settings.baseUrl).toBe(DEFAULT_TUTOR_BASE_URL);
    expect(bad.settings.apiKey).toBe('sk-keep');
    expect(bad.settings.consentedHost).toBe('openrouter.ai');

    const moved = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: 'https://api.openai.com/v1', model: 'm' });
    expect(moved.problems).toEqual([]);
    expect(moved.settings.baseUrl).toBe('https://api.openai.com/v1');
    expect(moved.settings.consentedHost).toBe('');
    expect(consentCovers(getTutorSettings())).toBe(false);
  });

  it('rejects a broken key without replacing the stored one, and Remove key clears consent', () => {
    replaceTutorSettings(parseTutorSettings({
      version: 1, apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: 'm', consentedHost: 'openrouter.ai',
    }));
    const badKey = commitTutorDraft({ apiKey: 'has a space', baseUrl: DEFAULT_TUTOR_BASE_URL, model: 'm' });
    expect(badKey.problems).toEqual(['key']);
    expect(getTutorSettings().apiKey).toBe('sk-keep');
    acceptTutorHost('openrouter.ai');
    expect(consentCovers(getTutorSettings())).toBe(true);
    acceptTutorHost('evil.test');
    expect(getTutorSettings().consentedHost).toBe('openrouter.ai');
    removeTutorKey();
    expect(getTutorSettings().apiKey).toBe('');
    expect(getTutorSettings().consentedHost).toBe('');
    expect(getTutorSettings().baseUrl).toBe(DEFAULT_TUTOR_BASE_URL);
  });
});
