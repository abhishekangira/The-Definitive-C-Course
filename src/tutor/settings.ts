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

const MAX_API_KEY = 2000;
const MAX_STORED_CHARS = 20_000;

export interface TutorSettings {
  /** Empty when the tutor is off. Never log this. */
  apiKey: string;
  /** Canonical base URL, no trailing slash. */
  baseUrl: string;
  /** `url.host` the learner agreed to send requests to. Empty until they accept, and after the host or the key changes. */
  consentedHost: string;
}

export function emptyTutorSettings(): TutorSettings {
  return { apiKey: '', baseUrl: DEFAULT_TUTOR_BASE_URL, consentedHost: '' };
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

/** Rebuilds settings from untrusted JSON. Unknown keys are ignored. A bad document becomes the defaults. */
export function parseTutorSettings(raw: unknown): TutorSettings {
  const empty = emptyTutorSettings();
  if (!isRecord(raw)) return empty;
  if (raw.version !== undefined && raw.version !== 1) return empty;
  const baseUrl = typeof raw.baseUrl === 'string' ? (parseTutorBaseUrl(raw.baseUrl) ?? empty.baseUrl) : empty.baseUrl;
  const host = tutorHost(baseUrl);
  const consented = typeof raw.consentedHost === 'string' ? raw.consentedHost.trim() : '';
  return {
    apiKey: cleanTutorKey(raw.apiKey),
    baseUrl,
    consentedHost: host && consented === host ? consented : '',
  };
}

export function consentCovers(s: TutorSettings): boolean {
  const host = tutorHost(s.baseUrl);
  return Boolean(s.apiKey && host && s.consentedHost === host);
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

/** Drops the key and host consent. The next key asks for permission again. The URL stays. */
export function removeTutorKey(): void {
  write({ ...current, apiKey: '', consentedHost: '' });
}

/** Remembers that this host may be sent requests. No-op when `host` is not the current base URL's host. */
export function acceptTutorHost(host: string): void {
  if (tutorHost(current.baseUrl) !== host) return;
  write({ ...current, consentedHost: host });
}

export interface TutorDraft { apiKey: string; baseUrl: string }

export interface DraftCommit { settings: TutorSettings; problems: Array<'key' | 'url'> }

/**
 * Validates a form draft against the settings already stored. An illegal URL or key is not saved:
 * the previous allowed value stays, and `problems` says which field was rejected.
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
  const host = tutorHost(baseUrl);
  // Consent is for this key on this host. Clearing or replacing the key asks again.
  // A rejected key or URL keeps the previous value, and its consent.
  const sameKey = apiKey !== '' && apiKey === prev.apiKey;
  const consentedHost = sameKey && host && prev.consentedHost === host ? prev.consentedHost : '';
  write({ apiKey, baseUrl, consentedHost });
  return { settings: current, problems };
}

function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }

export function useTutorSettings(): TutorSettings {
  return useSyncExternalStore(subscribe, getTutorSettings, getTutorSettings);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== TUTOR_STORAGE_KEY) return;
    try {
      current = e.newValue ? parseTutorSettings(JSON.parse(e.newValue)) : emptyTutorSettings();
    } catch { current = emptyTutorSettings(); }
    emit();
  });
}
