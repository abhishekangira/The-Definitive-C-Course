import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUTOR_BASE_URL, TUTOR_STORAGE_KEY, acceptTutorHost, cleanTutorKey, cleanTutorModel, commitTutorDraft, consentCovers,
  emptyTutorSettings, getTutorSettings, isOpenRouter, loadTutorSettings, parseTutorBaseUrl, parseTutorSettings, removeTutorKey,
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
    expect(tutorChatUrl('https://example.com/openai/v1?api-version=2024-10-01')).toBe('https://example.com/openai/v1/chat/completions?api-version=2024-10-01');
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
      'https://example.com/v1?sk=abc',
      'https://example.com/v1?SK=abc',
      'https://example.com/v1?auth=abc',
      'https://example.com/v1?bearer=abc',
      'https://example.com/v1?authorization=abc',
      'https://example.com/v1?accesskey=abc',
      'https://example.com/v1?access_key=abc',
      'https://example.com/v1?api.key=abc',
      'https://example.com/v1?my-sk=abc',
      'not a url',
      '',
    ]) expect(parseTutorBaseUrl(bad), bad).toBeNull();
    // Ordinary names that merely contain those letters stay. `api-version` is a date, not a key.
    expect(parseTutorBaseUrl('https://example.com/v1?turkey=1')).toBe('https://example.com/v1?turkey=1');
    expect(parseTutorBaseUrl('https://example.com/v1?ask=1')).toBe('https://example.com/v1?ask=1');
    expect(parseTutorBaseUrl('https://example.com/v1?author=ada')).toBe('https://example.com/v1?author=ada');
    expect(parseTutorBaseUrl('https://example.com/v1?skill=1')).toBe('https://example.com/v1?skill=1');
    expect(parseTutorBaseUrl('https://example.com/v1?monkey=1')).toBe('https://example.com/v1?monkey=1');
  });

  it('rejects loopback lookalikes that a prefix check would allow', () => {
    // isLoopback is an exact host match. startsWith('localhost') / startsWith('127.0.0.1') would accept these.
    for (const bad of [
      'http://localhost.evil.com/v1',
      'http://127.0.0.1.evil.com/v1',
      'http://localhost./v1',
      'http://localhost.localdomain/v1',
      'http://127.0.0.10/v1',
      'http://localhostextra/v1',
      'http://evil.localhost/v1',
    ]) expect(parseTutorBaseUrl(bad), bad).toBeNull();
    expect(parseTutorBaseUrl('http://LOCALHOST/v1')).toBe('http://localhost/v1');
    expect(parseTutorBaseUrl('http://127.0.0.1./v1')).toBe('http://127.0.0.1/v1');
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
      version: 1, apiKey: 'sk-ok', baseUrl: 'https://openrouter.ai/api/v1', consentedHost: 'openrouter.ai',
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
      version: 1, apiKey: 'sk-test-value', baseUrl: DEFAULT_TUTOR_BASE_URL, consentedHost: 'openrouter.ai',
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
      version: 1, apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, consentedHost: 'openrouter.ai',
    }));
    const bad = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: 'http://evil.test/v1', model: '', useDefaultModel: true });
    expect(bad.problems).toEqual(['url']);
    expect(bad.settings.baseUrl).toBe(DEFAULT_TUTOR_BASE_URL);
    expect(bad.settings.apiKey).toBe('sk-keep');
    expect(bad.settings.consentedHost).toBe('openrouter.ai');

    const moved = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', useDefaultModel: false });
    expect(moved.problems).toEqual([]);
    expect(moved.settings.baseUrl).toBe('https://api.openai.com/v1');
    expect(moved.settings.consentedHost).toBe('');
    expect(consentCovers(getTutorSettings())).toBe(false);
  });

  it('rejects a broken key without replacing the stored one, and Remove key clears consent', () => {
    replaceTutorSettings(parseTutorSettings({
      version: 1, apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, consentedHost: 'openrouter.ai',
    }));
    const badKey = commitTutorDraft({ apiKey: 'has a space', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '', useDefaultModel: true });
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

  it('clears host consent when the key is cleared or replaced, and keeps it when the key is unchanged', () => {
    replaceTutorSettings(parseTutorSettings({
      version: 1, apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, consentedHost: 'openrouter.ai',
    }));
    const same = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '', useDefaultModel: true });
    expect(same.problems).toEqual([]);
    expect(same.settings.consentedHost).toBe('openrouter.ai');
    expect(consentCovers(same.settings)).toBe(true);

    const replaced = commitTutorDraft({ apiKey: 'sk-new-value', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '', useDefaultModel: true });
    expect(replaced.problems).toEqual([]);
    expect(replaced.settings.apiKey).toBe('sk-new-value');
    expect(replaced.settings.consentedHost).toBe('');
    expect(consentCovers(replaced.settings)).toBe(false);

    acceptTutorHost('openrouter.ai');
    expect(consentCovers(getTutorSettings())).toBe(true);
    const cleared = commitTutorDraft({ apiKey: '', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '', useDefaultModel: true });
    expect(cleared.problems).toEqual([]);
    expect(cleared.settings.apiKey).toBe('');
    expect(cleared.settings.consentedHost).toBe('');
    expect(consentCovers(cleared.settings)).toBe(false);
  });
});

describe('exercise and lesson consent', () => {
  it('are kept apart: old documents and exercise notices do not cover the lesson chat; Settings covers both; both clear together', () => {
    const old = parseTutorSettings({ version: 1, apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, consentedHost: 'openrouter.ai' });
    expect(consentCovers(old, 'exercise')).toBe(true);
    expect(consentCovers(old, 'lesson'), 'consent saved before the lesson chat does not carry over').toBe(false);
    expect(parseTutorSettings({ version: 1, apiKey: 'k', baseUrl: DEFAULT_TUTOR_BASE_URL, lessonConsentedHost: 'evil.test' }).lessonConsentedHost).toBe('');

    replaceTutorSettings({ ...old, consentedHost: '' });
    acceptTutorHost('openrouter.ai', 'exercise');
    expect([consentCovers(getTutorSettings(), 'exercise'), consentCovers(getTutorSettings(), 'lesson')]).toEqual([true, false]);
    replaceTutorSettings({ ...old, consentedHost: '' });
    acceptTutorHost('openrouter.ai', 'lesson');
    expect([consentCovers(getTutorSettings(), 'exercise'), consentCovers(getTutorSettings(), 'lesson')]).toEqual([false, true]);
    acceptTutorHost('openrouter.ai');
    expect([consentCovers(getTutorSettings(), 'exercise'), consentCovers(getTutorSettings(), 'lesson')]).toEqual([true, true]);

    expect(commitTutorDraft({ apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '', useDefaultModel: true }).settings.lessonConsentedHost).toBe('openrouter.ai');
    expect(commitTutorDraft({ apiKey: 'sk-other', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '', useDefaultModel: true }).settings.lessonConsentedHost).toBe('');
    acceptTutorHost('openrouter.ai');
    removeTutorKey();
    expect(getTutorSettings().lessonConsentedHost).toBe('');
  });
});

describe('the model choice', () => {
  const stored = (extra: Record<string, unknown> = {}) => parseTutorSettings({
    version: 1, apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, consentedHost: 'openrouter.ai', ...extra,
  });

  it('keeps a valid model id and drops spaces, control characters, wrong types and absurd lengths', () => {
    expect(stored({ model: 'openai/gpt-oss-120b' }).model).toBe('openai/gpt-oss-120b');
    expect(stored({ model: '  nvidia/nemotron-3.5-super-vl:free  ' }).model).toBe('nvidia/nemotron-3.5-super-vl:free');
    for (const bad of ['two words', 'tab\there', 'new\nline', 'x'.repeat(201), 12, { id: 'x' }, null, '']) {
      expect(stored({ model: bad }).model, JSON.stringify(bad)).toBe('');
    }
    expect(cleanTutorModel('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    expect(cleanTutorModel('a b')).toBe('');
  });

  it('knows which hosts understand the course default', () => {
    expect(isOpenRouter('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouter('https://api.openai.com/v1')).toBe(false);
    expect(isOpenRouter('https://openrouter.ai.evil.test/v1')).toBe(false);
    expect(isOpenRouter('http://localhost:11434/v1')).toBe(false);
    expect(isOpenRouter('not a url')).toBe(false);
  });

  it('stores the course default as an empty model and a chosen id as that id, and a model change keeps consent', () => {
    replaceTutorSettings(stored());
    const own = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: 'openai/gpt-4o-mini', useDefaultModel: false });
    expect(own.problems).toEqual([]);
    expect(own.settings.model).toBe('openai/gpt-4o-mini');
    expect(own.settings.consentedHost, 'same key, same host: consent stays').toBe('openrouter.ai');
    const back = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: 'ignored', useDefaultModel: true });
    expect(back.problems).toEqual([]);
    expect(back.settings.model).toBe('');
  });

  it('rejects a broken id without wiping the stored one, and an empty "my own model" box changes nothing (an empty model would mean the course default)', () => {
    replaceTutorSettings(stored({ model: 'openai/gpt-4o-mini' }));
    const broken = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: 'two words', useDefaultModel: false });
    expect(broken.problems).toEqual(['model']);
    expect(broken.settings.model).toBe('openai/gpt-4o-mini');
    const empty = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '  ', useDefaultModel: false });
    expect(empty.problems).toEqual(['model']);
    expect(empty.settings.model, 'a learner who chose a model is not moved onto the default models').toBe('openai/gpt-4o-mini');
  });

  it('flags the course default on a host that is not OpenRouter', () => {
    replaceTutorSettings(stored());
    const result = commitTutorDraft({ apiKey: 'sk-keep', baseUrl: 'https://api.openai.com/v1', model: '', useDefaultModel: true });
    expect(result.problems).toEqual(['model']);
    expect(result.settings.baseUrl).toBe('https://api.openai.com/v1');
    expect(result.settings.model).toBe('');
  });
});
