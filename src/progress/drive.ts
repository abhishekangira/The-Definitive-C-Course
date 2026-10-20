// Optional Google Drive sync: the progress document is mirrored to one file in the learner's Drive
// app-data folder (hidden from their Drive, readable only by this app's OAuth client).
//
// - No backend. The token comes from Google Identity Services (the browser token flow) and lasts about an hour.
//   It is kept in tdcc:v1:drive with its expiry, so autosave survives a reload; after it expires the learner
//   clicks "Sign in again". The token only reaches the app-data folder (drive.appdata scope).
// - Every sync is pull, merge, push: download the Drive copy, merge it with this browser's document
//   (mergeProgress keeps the furthest progress from both), apply the result here, upload it if Drive differs.
//   The Drive copy's seed wins, so every device converges on one learner seed; this browser keeps its own settings.
// - "Reset all progress" and "Replace my progress" must not be undone by the next merge: they call
//   replaceDriveOnNextSync(), which uploads this document without merging and with a new `driveEpoch`. Another
//   browser that sees an epoch it has not synced with adopts the Drive copy instead of merging its old progress back.
// - The client id comes from VITE_GOOGLE_CLIENT_ID at build time. Without it the feature is hidden.
// - tdcc:v1:drive is outside the progress document, so export, import and reset never touch it.
import { useSyncExternalStore } from 'react';
import { STORAGE_PREFIX, getProgress, mergeProgress, parseProgressFile, replaceProgress, subscribeProgress, type ProgressV1 } from './store';

export const DRIVE_STORAGE_KEY = `${STORAGE_PREFIX}drive`;
export const DRIVE_FILE_NAME = 'tdcc-progress.json';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
/** Wait this long after the last change before uploading, so a burst of card clicks is one request. */
export const AUTOSAVE_DELAY_MS = 4000;
/** Pull other devices' changes when the tab regains focus, at most this often. */
const FOCUS_PULL_MS = 60_000;

export function driveClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

export interface DriveSettings {
  connected: boolean;
  token?: string;
  /** ms since the epoch. */
  tokenExpiresAt?: number;
  fileId?: string;
  lastSyncAt?: string;
  /** Upload this browser's document without merging on the next sync (after a reset or a replace). */
  replaceNext?: boolean;
  /** The Drive copy's `driveEpoch` at this browser's last sync. */
  epoch?: string;
}

export type DriveStatus =
  | { state: 'off' }
  | { state: 'idle' }
  | { state: 'syncing' }
  | { state: 'signed-out' }
  | { state: 'error'; message: string };

export interface DriveView { settings: DriveSettings; status: DriveStatus }

function readSettings(): DriveSettings {
  try {
    const raw = localStorage.getItem(DRIVE_STORAGE_KEY);
    if (!raw) return { connected: false };
    const o: unknown = JSON.parse(raw);
    if (typeof o !== 'object' || o === null) return { connected: false };
    const r = o as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' && v.length < 4096 ? v : undefined);
    return {
      connected: r.connected === true,
      token: s(r.token),
      tokenExpiresAt: typeof r.tokenExpiresAt === 'number' ? r.tokenExpiresAt : undefined,
      fileId: typeof r.fileId === 'string' && /^[\w-]{1,200}$/.test(r.fileId) ? r.fileId : undefined,
      lastSyncAt: s(r.lastSyncAt),
      replaceNext: r.replaceNext === true || undefined,
      epoch: typeof r.epoch === 'string' && /^[0-9a-f]{1,64}$/.test(r.epoch) ? r.epoch : undefined,
    };
  } catch { return { connected: false }; }
}

let view: DriveView = { settings: readSettings(), status: { state: 'off' } };
view = { ...view, status: initialStatus(view.settings) };
const listeners = new Set<() => void>();

function initialStatus(s: DriveSettings): DriveStatus {
  if (!s.connected) return { state: 'off' };
  return tokenValid(s) ? { state: 'idle' } : { state: 'signed-out' };
}

function tokenValid(s: DriveSettings, now = Date.now()): s is DriveSettings & { token: string } {
  // A minute of slack, so a request does not start with a token that expires on the way.
  return Boolean(s.token) && (s.tokenExpiresAt ?? 0) > now + 60_000;
}

function setView(settings: DriveSettings, status: DriveStatus = view.status) {
  view = { settings, status };
  try { localStorage.setItem(DRIVE_STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage blocked: memory only */ }
  listeners.forEach(l => l());
}
const setStatus = (status: DriveStatus) => setView(view.settings, status);

/** True when this browser is connected and last synced less than `days` days ago (the export reminder counts that as a backup). */
export function driveSyncedWithin(s: DriveSettings, days: number, now = Date.now()): boolean {
  if (!s.connected || !s.lastSyncAt) return false;
  const t = Date.parse(s.lastSyncAt);
  return Number.isFinite(t) && now - t < days * 86_400_000;
}

export function getDriveView(): DriveView { return view; }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export function useDrive(): DriveView { return useSyncExternalStore(subscribe, getDriveView, getDriveView); }

// ---------- pure parts (tested in drive.test.ts) ----------

/** JSON with sorted object keys, so two documents that differ only in key order compare equal. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : x));
}

/** The document both sides should hold after a sync. */
export function reconcile(local: ProgressV1, remote: ProgressV1 | null): ProgressV1 {
  if (!remote) return local;
  const merged = mergeProgress(remote, local);
  merged.settings = structuredClone(local.settings);
  merged.createdAt = remote.createdAt < local.createdAt ? remote.createdAt : local.createdAt;
  const exported = [remote.lastExportedAt, local.lastExportedAt].filter((x): x is string => Boolean(x)).sort();
  if (exported.length) merged.lastExportedAt = exported[exported.length - 1];
  else delete merged.lastExportedAt;
  return merged;
}

/** The Drive copy after another browser replaced it: its progress as it is, with this browser's settings. */
function adopt(local: ProgressV1, remote: ProgressV1): ProgressV1 {
  return { ...structuredClone(remote), settings: structuredClone(local.settings) };
}

function newEpoch(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** The Drive file is a progress document plus `driveEpoch`, so it still imports as a progress file (migrate drops the extra key). */
function epochOf(text: string): string | undefined {
  const e = (JSON.parse(text) as { driveEpoch?: unknown }).driveEpoch;
  return typeof e === 'string' && /^[0-9a-f]{1,64}$/.test(e) ? e : undefined;
}

export class DriveAuthError extends Error {}

export interface SyncDeps {
  fetch: typeof fetch;
  token: string;
  fileId?: string;
  /** Upload `local` as it is, without reading or merging the Drive copy, under a new epoch. */
  replace?: boolean;
  /** The epoch of this browser's last sync; undefined on the first sync after connecting (which always merges). */
  epoch?: string;
  /** Read at the moment of merging, so a change made while the download ran is not lost. */
  getLocal: () => ProgressV1;
  apply: (next: ProgressV1) => void;
  /** True when the round must stop before it changes anything (a reset happened while it downloaded). */
  cancelled?: () => boolean;
}

export interface SyncResult { fileId: string | undefined; epoch?: string; applied: boolean; uploaded: boolean; cancelled?: true }

/** `step` names the request in error messages ("listing the Drive folder"), so a learner's report says which one failed. */
async function call(deps: SyncDeps, step: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await deps.fetch(url, { ...init, redirect: 'error', headers: { ...init.headers, Authorization: `Bearer ${deps.token}` } });
  } catch (e) {
    // fetch rejects without a status when the request never got a readable reply: offline, a blocker, or an error without CORS headers.
    throw new Error(`Couldn't reach Google Drive while ${step} (${e instanceof Error ? e.message : String(e)}). Check your connection, and that no extension or shield blocks www.googleapis.com.`);
  }
  if (res.status === 401) throw new DriveAuthError('Google Drive refused the sign-in.');
  if (res.status === 403) {
    // Not an expired sign-in: the Drive box was unticked on Google's consent screen, or the API is off or over quota.
    let reason = '';
    try { reason = String(((await res.json()) as { error?: { message?: unknown } }).error?.message ?? ''); } catch { /* no JSON body */ }
    throw new Error(`Google Drive refused ${step}${reason ? `: ${reason.slice(0, 300)}` : ''}. Disconnect, connect again and allow Google Drive access.`);
  }
  return res;
}

async function findFile(deps: SyncDeps): Promise<string | undefined> {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const res = await call(deps, 'listing the Drive folder', `${API}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime%20desc`);
  if (!res.ok) throw new Error(`Couldn't list the Drive folder (HTTP ${res.status}).`);
  const body = (await res.json()) as { files?: Array<{ id?: unknown }> };
  const id = body.files?.[0]?.id;
  return typeof id === 'string' ? id : undefined;
}

async function upload(deps: SyncDeps, fileId: string | undefined, doc: ProgressV1, epoch: string): Promise<string> {
  const text = JSON.stringify({ ...doc, driveEpoch: epoch });
  const save = (id: string) => call(deps, 'saving to Drive', `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text,
  });
  if (fileId) {
    const res = await save(fileId);
    if (res.ok) return fileId;
    if (res.status !== 404) throw new Error(`Couldn't save to Drive (HTTP ${res.status}).`);
    // The file was deleted from Drive: create it again.
  }
  // Two plain requests (create the empty file, then upload into it) instead of one multipart upload: the PATCH is the
  // same request every later save makes, and nothing depends on a hand-built multipart body.
  const res = await call(deps, 'creating the Drive file', `${API}?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' }),
  });
  if (!res.ok) throw new Error(`Couldn't create the Drive file (HTTP ${res.status}).`);
  const id = ((await res.json()) as { id?: unknown }).id;
  if (typeof id !== 'string') throw new Error('Drive did not return a file id.');
  const saved = await save(id);
  if (!saved.ok) throw new Error(`Couldn't save to Drive (HTTP ${saved.status}).`);
  return id;
}

/** One pull-merge-push round. Throws DriveAuthError when the token no longer works. */
export async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  let fileId = deps.fileId ?? await findFile(deps);
  let remote: ProgressV1 | null = null;
  let remoteEpoch: string | undefined;
  if (fileId && !deps.replace) {
    const download = (id: string) => call(deps, 'reading the Drive copy', `${API}/${encodeURIComponent(id)}?alt=media`);
    let res: Response | undefined = await download(fileId);
    if (res.status === 404) {
      // The remembered file was deleted (or this is another account's id): look for the current one.
      fileId = await findFile(deps);
      res = fileId ? await download(fileId) : undefined;
    }
    if (res) {
      if (!res.ok) throw new Error(`Couldn't read the Drive copy (HTTP ${res.status}).`);
      const text = await res.text();
      try { remote = parseProgressFile(text); remoteEpoch = epochOf(text); } catch (e) {
        // Never overwrite a Drive copy we cannot read: it may hold progress this browser lacks.
        throw new Error(`The progress file in Drive can't be read (${(e as Error).message}) Nothing was changed.`);
      }
    }
  }
  if (deps.cancelled?.()) return { fileId, applied: false, uploaded: false, cancelled: true };
  const local = deps.getLocal();
  let next: ProgressV1;
  let epoch: string;
  if (deps.replace) { next = local; epoch = newEpoch(); }
  else if (remote && remoteEpoch && deps.epoch && remoteEpoch !== deps.epoch) { next = adopt(local, remote); epoch = remoteEpoch; }
  else { next = reconcile(local, remote); epoch = remoteEpoch ?? deps.epoch ?? newEpoch(); }
  const applied = canonical(next) !== canonical(local);
  if (applied) deps.apply(next);
  // Settings stay per browser, so a Drive copy that differs only in them is not re-uploaded (two browsers would take turns).
  const progressOnly = (p: ProgressV1) => canonical({ ...p, settings: {} });
  const uploaded = !remote || epoch !== remoteEpoch || progressOnly(next) !== progressOnly(remote);
  if (uploaded) fileId = await upload(deps, fileId, next, epoch);
  return { fileId, epoch, applied, uploaded };
}

// ---------- sign-in (Google Identity Services) ----------

interface TokenResponse { access_token?: string; expires_in?: number | string; scope?: string; error?: string }
interface GoogleOAuth2 {
  initTokenClient(c: {
    client_id: string; scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): { requestAccessToken(o?: { prompt?: string }): void };
  revoke(token: string, done?: () => void): void;
}
declare global { interface Window { google?: { accounts?: { oauth2?: GoogleOAuth2 } } } }

let gisLoading: Promise<GoogleOAuth2> | null = null;

/** Loads Google's sign-in script. Called when the learner points at or focuses the button, so the click that follows can open the popup. */
export function loadGoogleSignIn(): Promise<GoogleOAuth2> {
  const ready = window.google?.accounts?.oauth2;
  if (ready) return Promise.resolve(ready);
  gisLoading ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => { const g = window.google?.accounts?.oauth2; if (g) resolve(g); else reject(new Error('Google sign-in did not load.')); };
    s.onerror = () => { gisLoading = null; s.remove(); reject(new Error('Google sign-in could not be loaded (offline, or blocked by an extension).')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

async function requestToken(): Promise<{ token: string; expiresAt: number }> {
  const oauth = await loadGoogleSignIn();
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: driveClientId(),
      scope: DRIVE_SCOPE,
      callback: r => {
        if (!r.access_token) { reject(new Error(r.error ? `Google sign-in failed: ${r.error}.` : 'Google sign-in failed.')); return; }
        // Google's consent screen lets the learner untick the Drive box and still returns a token.
        if (r.scope !== undefined && !r.scope.split(' ').includes(DRIVE_SCOPE)) {
          reject(new Error('Google Drive access was not allowed. Connect again and tick the box that lets the course use its Drive folder.'));
          return;
        }
        resolve({ token: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3599) * 1000 });
      },
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'The Google sign-in window was closed.' : e.type === 'popup_failed_to_open'
        ? 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.' : 'Google sign-in failed.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// ---------- the running sync ----------

let running: Promise<void> | null = null;
let again = false;
let applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastPull = 0;
/** Bumped by replaceDriveOnNextSync, so a round that started before a reset neither merges the old copy back nor clears the flag. */
let replaceGen = 0;

/** Pull, merge and push now. Concurrent calls share one round, plus one more if a change arrived meanwhile. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      const s = view.settings;
      if (!s.connected) { setStatus({ state: 'off' }); return; }
      if (!tokenValid(s)) { setStatus({ state: 'signed-out' }); return; }
      setStatus({ state: 'syncing' });
      const gen = replaceGen;
      try {
        const r = await syncOnce({
          fetch: (...a) => fetch(...a), token: s.token, fileId: s.fileId, replace: s.replaceNext, epoch: s.epoch,
          getLocal: getProgress,
          apply: next => { applying = true; try { replaceProgress(next); } finally { applying = false; } },
          cancelled: () => gen !== replaceGen,
        });
        if (r.cancelled) { again = true; continue; }
        // Disconnected while this round ran: leave the cleared settings alone.
        if (!view.settings.connected) return;
        lastPull = Date.now();
        const replaceNext = gen === replaceGen ? undefined : view.settings.replaceNext;
        setView({ ...view.settings, fileId: r.fileId, epoch: r.epoch, lastSyncAt: new Date().toISOString(), replaceNext }, { state: 'idle' });
        if (replaceNext) again = true;
      } catch (e) {
        if (e instanceof DriveAuthError) setView({ ...view.settings, token: undefined, tokenExpiresAt: undefined }, { state: 'signed-out' });
        else setStatus({ state: 'error', message: e instanceof Error ? e.message : 'Sync failed.' });
        return;
      }
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

function scheduleSync() {
  if (applying || !view.settings.connected) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void syncNow(); }, AUTOSAVE_DELAY_MS);
}

/** Sign in (a popup, so call it from a click) and sync. The first sync merges Drive's copy into this browser. */
export async function connectDrive(): Promise<void> {
  const { token, expiresAt } = await requestToken();
  setView({ ...view.settings, connected: true, token, tokenExpiresAt: expiresAt }, { state: 'idle' });
  await syncNow();
}

/** Stop syncing here. The Drive copy stays; the learner can remove it under Drive's "Manage apps". */
export function disconnectDrive(): void {
  clearTimeout(timer);
  const token = view.settings.token;
  if (token) window.google?.accounts?.oauth2?.revoke(token);
  setView({ connected: false }, { state: 'off' });
}

/** After "Reset all progress" or "Replace my progress": the next sync uploads this document instead of merging Drive's copy back in. */
export function replaceDriveOnNextSync(): void {
  if (!view.settings.connected) return;
  replaceGen++;
  setView({ ...view.settings, replaceNext: true });
  scheduleSync();
}

let started = false;
/** Called once at start-up: pulls Drive's copy if signed in, then autosaves every change. */
export function startDriveSync(): void {
  if (started || typeof window === 'undefined' || !driveClientId()) return;
  started = true;
  subscribeProgress(scheduleSync);
  window.addEventListener('storage', e => {
    if (e.key === DRIVE_STORAGE_KEY) { const s = readSettings(); view = { settings: s, status: initialStatus(s) }; listeners.forEach(l => l()); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!view.settings.connected) return;
    if (document.visibilityState === 'hidden' && timer !== undefined) { clearTimeout(timer); timer = undefined; void syncNow(); }
    else if (document.visibilityState === 'visible' && Date.now() - lastPull > FOCUS_PULL_MS) void syncNow();
  });
  if (view.settings.connected) void syncNow();
}
