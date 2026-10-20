// AI tutor settings, outside the progress document (PLAN.md §2.6).
//
// The API key belongs to the learner. This module never logs it, never puts it in a URL, and never
// writes it into the progress document. Export, import and "Reset all progress" use a different key.
//
// Egress. The site has no Content-Security-Policy (none in index.html, Vite, or the workflows). A
// connect-src allowlist cannot name every provider a learner might type, and `https:` would not stop
// a bug that posted the key to the wrong path. The check is this parser, applied again when the
// request is built: https only, or http on localhost / 127.0.0.1 / ::1, no username or password,
// and no query parameter whose name looks like a key. Callers must POST only to tutorChatUrl()
// and must not follow a redirect (the client does both).

import { useSyncExternalStore } from 'react';
import { STORAGE_PREFIX } from '../progress/store';

export const TUTOR_STORAGE_KEY = `${STORAGE_PREFIX}tutor`;

/** OpenRouter's OpenAI-compatible base. The learner can replace it. */
export const DEFAULT_TUTOR_BASE_URL = 'https://openrouter.ai/api/v1';

/** The host whose API understands the course's own `models` and `provider` request fields. */
export const OPENROUTER_HOST = 'openrouter.ai';

/** Examples for the "my own model id" box. The learner can type any id; these are not a promise that the provider still serves them. */
export const SUGGESTED_TUTOR_MODELS = [
  'openai/gpt-oss-120b',
  'google/gemini-3.5-flash-lite',
  'nvidia/nemotron-3.5-super-vl:free',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.3-70b-instruct',
  'anthropic/claude-haiku-5.5',
] as const;

const MAX_API_KEY = 2000;
const MAX_MODEL = 200;
const MAX_STORED_CHARS = 20_000;

export interface TutorSettings {
  /** Empty when the tutor is off. Never log this. */
  apiKey: string;
  /** Canonical base URL, no trailing slash. */
  baseUrl: string;
  /** The learner's own model id. Empty means the course default (several models through OpenRouter), which only OpenRouter understands. */
  model: string;
  /**
   * `url.host` the learner agreed to send exercise requests to (their code, the test results, a hidden copy of the
   * solution). Empty until they accept, and after the host or the key changes.
   */
  consentedHost: string;
  /**
   * The same for the lesson chat (the lesson text, their edits to its samples, highlights and the conversation). Kept
   * apart on purpose: agreeing to one notice does not cover what the other sends, and consent saved before the lesson
   * chat existed (only `consentedHost`) does not reach it.
   */
  lessonConsentedHost: string;
}

/** What a consent notice covers. `any` is the Settings notice, which names both uses. */
export type ConsentScope = 'exercise' | 'lesson' | 'any';

export function emptyTutorSettings(): TutorSettings {
  return { apiKey: '', baseUrl: DEFAULT_TUTOR_BASE_URL, model: '', consentedHost: '', lessonConsentedHost: '' };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function stripBearer(key: string): string {
  return /^bearer\s+/i.test(key) ? key.replace(/^bearer\s+/i, '').trim() : key;
}

/** A key we are willing to store and send. Control characters and absurd lengths are rejected, not truncated. */
export function cleanTutorKey(v: unknown): string {
  if (typeof v !== 'string') return '';
  const key = stripBearer(v.trim());
  if (!key || key.length > MAX_API_KEY || /\s/.test(key) || /[\u0000-\u001f\u007f]/.test(key)) return '';
  return key;
}

/** A model id we are willing to send. Control characters, spaces and absurd lengths are rejected, not truncated. */
export function cleanTutorModel(v: unknown): string {
  if (typeof v !== 'string') return '';
  const model = v.trim();
  if (!model || model.length > MAX_MODEL || /\s/.test(model) || /[\u0000-\u001f\u007f]/.test(model)) return '';
  return model;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Query names that would put a secret in the URL (and in logs). A name matches when a segment is
 * `key`, `token`, `secret`, `sk`, `auth`, `bearer`, or similar (`api.key`, `access_key`).
 * `turkey`, `ask`, `author`, `skill` and `api-version` do not match.
 */
const KEY_PARAM = /(^|[_\-.])(api[_\-.]?key|access[_\-.]?key|authorization|bearer|credential|password|secret|token|auth|key|sk)($|[_\-.])/i;

/**
 * Canonical tutor base URL, or null when the string must not be sent a key.
 * Accepts a pasted full `.../chat/completions` URL and strips that suffix so the client can append it once.
 */
export function parseTutorBaseUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.username || url.password || url.hash) return null;
  const loopback = isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  for (const [name, value] of url.searchParams) {
    if (KEY_PARAM.test(name) || value.length > 500) return null;
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) path = path.slice(0, -'/chat/completions'.length);
  url.pathname = path || '/';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/** Absolute chat-completions URL for a base, or null when the base is not allowed. Stays on the same host. */
export function tutorChatUrl(baseUrl: string): string | null {
  const base = parseTutorBaseUrl(baseUrl);
  if (!base) return null;
  // Append to the path. A slash joined onto the whole string would land inside the query
  // (`/v1?x=1` + `/` becomes a query of `x=1/`) and the last path segment would be replaced.
  const root = new URL(base);
  if (!root.pathname.endsWith('/')) root.pathname = `${root.pathname}/`;
  let endpoint: URL;
  try { endpoint = new URL('chat/completions', root); } catch { return null; }
  // A relative resolution drops the base query. Put it back so ?api-version= stays on the request.
  endpoint.search = root.search;
  if (endpoint.protocol !== root.protocol || endpoint.host !== root.host || endpoint.username || endpoint.password) return null;
  return endpoint.toString();
}

export function tutorHost(baseUrl: string): string | null {
  const base = parseTutorBaseUrl(baseUrl);
  if (!base) return null;
  return new URL(base).host;
}

export function isOpenRouter(baseUrl: string): boolean {
  return tutorHost(baseUrl) === OPENROUTER_HOST;
}

/** Rebuilds settings from untrusted JSON. Unknown keys are ignored. A bad document becomes the defaults. */
export function parseTutorSettings(raw: unknown): TutorSettings {
  const empty = emptyTutorSettings();
  if (!isRecord(raw)) return empty;
  if (raw.version !== undefined && raw.version !== 1) return empty;
  const baseUrl = typeof raw.baseUrl === 'string' ? (parseTutorBaseUrl(raw.baseUrl) ?? empty.baseUrl) : empty.baseUrl;
  const host = tutorHost(baseUrl);
  const forHost = (v: unknown) => {
    const consented = typeof v === 'string' ? v.trim() : '';
    return host && consented === host ? consented : '';
  };
  return {
    apiKey: cleanTutorKey(raw.apiKey),
    baseUrl,
    model: cleanTutorModel(raw.model),
    consentedHost: forHost(raw.consentedHost),
    lessonConsentedHost: forHost(raw.lessonConsentedHost),
  };
}

/** Whether the learner agreed to send this kind of request to the current host. */
export function consentCovers(s: TutorSettings, scope: Exclude<ConsentScope, 'any'> = 'exercise'): boolean {
  const host = tutorHost(s.baseUrl);
  const consented = scope === 'lesson' ? s.lessonConsentedHost : s.consentedHost;
  return Boolean(s.apiKey && host && consented === host);
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch { return null; }
}

/** Reads the saved settings. A throw, a huge string, or JSON that is not ours yields the defaults. */
export function loadTutorSettings(storage: StorageLike | null = browserStorage()): TutorSettings {
  if (!storage) return emptyTutorSettings();
  try {
    const text = storage.getItem(TUTOR_STORAGE_KEY);
    if (!text || text.length > MAX_STORED_CHARS) return emptyTutorSettings();
    return parseTutorSettings(JSON.parse(text));
  } catch { return emptyTutorSettings(); }
}

export function saveTutorSettings(settings: TutorSettings, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  const clean = parseTutorSettings({ version: 1, ...settings });
  try {
    storage.setItem(TUTOR_STORAGE_KEY, JSON.stringify({ version: 1, ...clean }));
    return true;
  } catch { return false; }
}

let current: TutorSettings = loadTutorSettings();
const listeners = new Set<() => void>();

function emit(): void { listeners.forEach(l => l()); }

function write(next: TutorSettings): void {
  const clean = parseTutorSettings({ version: 1, ...next });
  if (JSON.stringify(clean) === JSON.stringify(current)) return;
  current = clean;
  saveTutorSettings(clean);
  emit();
}

export function getTutorSettings(): TutorSettings { return current; }

export function replaceTutorSettings(next: TutorSettings): void { write(next); }

/** Drops the key and host consent. The next key asks for permission again. The URL and model stay. */
export function removeTutorKey(): void {
  write({ ...current, apiKey: '', consentedHost: '', lessonConsentedHost: '' });
}

/**
 * Remembers that this host may be sent the requests the accepted notice named: an exercise notice covers exercises,
 * the lesson notice the lesson chat, and the Settings notice (`any`) both. No-op when `host` is not the current base URL's host.
 */
export function acceptTutorHost(host: string, scope: ConsentScope = 'any'): void {
  if (tutorHost(current.baseUrl) !== host) return;
  write({
    ...current,
    ...(scope !== 'lesson' ? { consentedHost: host } : {}),
    ...(scope !== 'exercise' ? { lessonConsentedHost: host } : {}),
  });
}

export interface TutorDraft {
  apiKey: string;
  baseUrl: string;
  /** Used only when `useDefaultModel` is false. */
  model: string;
  /** The course default: several models through OpenRouter. Stored as an empty model. */
  useDefaultModel: boolean;
}

export interface DraftCommit { settings: TutorSettings; problems: Array<'key' | 'url' | 'model'> }

/**
 * Validates a form draft against the settings already stored. An illegal URL, key or model id is not
 * saved: the previous allowed value stays, and `problems` says which field was rejected. "My own model
 * id" with nothing typed, or the course default on a host other than OpenRouter, is a `model` problem
 * too (nothing is sent until a model is chosen).
 */
export function commitTutorDraft(draft: TutorDraft): DraftCommit {
  const prev = current;
  const problems: DraftCommit['problems'] = [];
  let apiKey = cleanTutorKey(draft.apiKey);
  // A rejected key must not wipe a key that was already stored. An empty field does clear it.
  if (draft.apiKey.trim() !== '' && apiKey === '') {
    problems.push('key');
    apiKey = prev.apiKey;
  }
  const canonical = parseTutorBaseUrl(draft.baseUrl);
  if (!canonical) problems.push('url');
  const baseUrl = canonical ?? prev.baseUrl;
  let model = '';
  if (!draft.useDefaultModel) {
    model = cleanTutorModel(draft.model);
    if (model === '') {
      // An empty or broken id changes nothing. An empty stored model means the course default, so writing one here
      // would silently move a learner who chose their own model onto the default models.
      problems.push('model');
      model = prev.model;
    }
  } else if (!isOpenRouter(baseUrl)) {
    problems.push('model');
  }
  const host = tutorHost(baseUrl);
  // Consent is for this key on this host. Clearing or replacing the key asks again.
  // A rejected key or URL keeps the previous value, and its consent.
  const sameKey = apiKey !== '' && apiKey === prev.apiKey;
  const kept = (consented: string) => (sameKey && host && consented === host ? consented : '');
  write({ apiKey, baseUrl, model, consentedHost: kept(prev.consentedHost), lessonConsentedHost: kept(prev.lessonConsentedHost) });
  return { settings: current, problems };
}

function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }

export function useTutorSettings(): TutorSettings {
  return useSyncExternalStore(subscribe, getTutorSettings, getTutorSettings);
}

/** How many times another tab changed the settings. A form that holds a draft starts it again from the store. */
let externalChanges = 0;

export function useExternalTutorChanges(): number {
  return useSyncExternalStore(subscribe, () => externalChanges, () => externalChanges);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== TUTOR_STORAGE_KEY) return;
    try {
      current = e.newValue ? parseTutorSettings(JSON.parse(e.newValue)) : emptyTutorSettings();
    } catch { current = emptyTutorSettings(); }
    externalChanges += 1;
    emit();
  });
}
