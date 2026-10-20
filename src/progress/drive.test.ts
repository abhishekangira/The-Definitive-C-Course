import { describe, expect, it } from 'vitest';
import { DRIVE_FILE_NAME, DriveAuthError, canonical, driveSyncedWithin, reconcile, syncOnce, type SyncDeps } from './drive';
import { emptyProgress, migrate, type ProgressV1 } from './store';

const at = '2026-01-01T00:00:00.000Z';
const later = '2026-02-01T00:00:00.000Z';

function doc(seed: string, patch: Partial<ProgressV1> = {}): ProgressV1 {
  return { ...emptyProgress(), seed, createdAt: at, ...patch };
}

/** A tiny Drive v3 app-data folder: list, download, multipart create and media update. */
class FakeDrive {
  files = new Map<string, string>();
  calls: string[] = [];
  status: number | null = null;
  /** Requests ("METHOD /path") that fail like a blocked request: fetch rejects with a TypeError. */
  unreachable = new Set<string>();
  private next = 1;

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname}`);
    if (this.unreachable.has(`${method} ${url.pathname}`)) throw new TypeError('Failed to fetch');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
    if (this.status) return new Response('', { status: this.status });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    const m = /\/files\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      expect(url.searchParams.get('spaces')).toBe('appDataFolder');
      expect(url.searchParams.get('q')).toContain(DRIVE_FILE_NAME);
      return json({ files: [...this.files.keys()].map(id => ({ id })) });
    }
    if (method === 'GET' && m && url.searchParams.get('alt') === 'media') {
      const text = this.files.get(m[1]);
      return text === undefined ? new Response('', { status: 404 }) : new Response(text, { status: 200 });
    }
    if (method === 'PATCH' && m) {
      if (!this.files.has(m[1])) return new Response('', { status: 404 });
      this.files.set(m[1], String(init?.body));
      return json({ id: m[1] });
    }
    if (method === 'POST' && url.pathname === '/drive/v3/files') {
      expect(JSON.parse(String(init?.body))).toEqual({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
      const id = `f${this.next++}`;
      this.files.set(id, '');
      return json({ id });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
}

function deps(drive: FakeDrive, local: { doc: ProgressV1 }, patch: Partial<SyncDeps> = {}): SyncDeps {
  return { fetch: drive.fetch, token: 'tok', getLocal: () => local.doc, apply: next => { local.doc = next; }, ...patch };
}

describe('reconcile', () => {
  it('merges both documents, adopts the Drive seed and keeps this browser\'s settings', () => {
    const remote = doc('aaaaaaaaaaaaaaaa', { lessons: { a: { completedAt: at } }, settings: { platform: 'wsl' }, createdAt: at });
    const local = doc('bbbbbbbbbbbbbbbb', { lessons: { b: { completedAt: at } }, settings: { platform: 'mac-arm' }, createdAt: later, lastExportedAt: later });
    const r = reconcile(local, remote);
    expect(Object.keys(r.lessons).sort()).toEqual(['a', 'b']);
    expect(r.seed).toBe('aaaaaaaaaaaaaaaa');
    expect(r.settings).toEqual({ platform: 'mac-arm' });
    expect(r.createdAt).toBe(at);
    expect(r.lastExportedAt).toBe(later);
  });

  it('returns this browser\'s document when Drive has none', () => {
    const local = doc('bbbbbbbbbbbbbbbb');
    expect(reconcile(local, null)).toBe(local);
  });
});

describe('syncOnce', () => {
  it('creates the file in the app-data folder on the first sync', async () => {
    const drive = new FakeDrive();
    const local = { doc: doc('bbbbbbbbbbbbbbbb', { lessons: { b: { completedAt: at } } }) };
    const r = await syncOnce(deps(drive, local));
    expect(r).toMatchObject({ fileId: 'f1', uploaded: true, applied: false });
    const saved = JSON.parse(drive.files.get('f1')!);
    expect(saved.driveEpoch).toBe(r.epoch);
    // Still a valid progress file: migrate drops the epoch.
    expect(canonical(migrate(saved))).toBe(canonical(local.doc));
  });

  it('retrieves progress from Drive, applies the merge here and uploads it; a second sync changes nothing', async () => {
    const drive = new FakeDrive();
    drive.files.set('f9', JSON.stringify(doc('aaaaaaaaaaaaaaaa', { lessons: { a: { completedAt: at } } })));
    const local = { doc: doc('bbbbbbbbbbbbbbbb', { lessons: { b: { completedAt: at } } }) };
    const first = await syncOnce(deps(drive, local));
    expect(first).toMatchObject({ fileId: 'f9', applied: true, uploaded: true });
    expect(Object.keys(local.doc.lessons).sort()).toEqual(['a', 'b']);
    expect(Object.keys(JSON.parse(drive.files.get('f9')!).lessons).sort()).toEqual(['a', 'b']);

    drive.calls = [];
    const second = await syncOnce(deps(drive, local, { fileId: 'f9', epoch: first.epoch }));
    expect(second).toMatchObject({ applied: false, uploaded: false });
    expect(drive.calls).toEqual(['GET /drive/v3/files/f9']);
  });

  it('replace uploads this document without reading or merging the Drive copy (after a reset)', async () => {
    const drive = new FakeDrive();
    drive.files.set('f9', JSON.stringify(doc('aaaaaaaaaaaaaaaa', { lessons: { a: { completedAt: at } } })));
    const local = { doc: doc('bbbbbbbbbbbbbbbb') };
    const r = await syncOnce(deps(drive, local, { fileId: 'f9', replace: true }));
    expect(r).toMatchObject({ applied: false, uploaded: true });
    expect(drive.calls).toEqual(['PATCH /upload/drive/v3/files/f9']);
    expect(JSON.parse(drive.files.get('f9')!).lessons).toEqual({});
  });

  it('after another browser replaced the Drive copy, adopts it instead of merging old progress back', async () => {
    const drive = new FakeDrive();
    const a = { doc: doc('aaaaaaaaaaaaaaaa', { lessons: { a: { completedAt: at } }, settings: { platform: 'wsl' } }) };
    const first = await syncOnce(deps(drive, a));
    const b = { doc: doc('aaaaaaaaaaaaaaaa') };
    const reset = await syncOnce(deps(drive, b, { fileId: first.fileId, epoch: first.epoch, replace: true }));
    expect(reset.epoch).not.toBe(first.epoch);

    const again = await syncOnce(deps(drive, a, { fileId: first.fileId, epoch: first.epoch }));
    expect(again).toMatchObject({ applied: true, uploaded: false, epoch: reset.epoch });
    expect(a.doc.lessons).toEqual({});
    expect(a.doc.settings).toEqual({ platform: 'wsl' });
    expect(JSON.parse(drive.files.get(first.fileId!)!).lessons).toEqual({});
  });

  it('merges on the first sync after connecting, whatever the Drive epoch', async () => {
    const drive = new FakeDrive();
    const a = { doc: doc('aaaaaaaaaaaaaaaa', { lessons: { a: { completedAt: at } } }) };
    const first = await syncOnce(deps(drive, a));
    const c = { doc: doc('cccccccccccccccc', { lessons: { c: { completedAt: at } } }) };
    const joined = await syncOnce(deps(drive, c));
    expect(joined.epoch).toBe(first.epoch);
    expect(Object.keys(c.doc.lessons).sort()).toEqual(['a', 'c']);
  });

  it('never overwrites a Drive copy it cannot read', async () => {
    const drive = new FakeDrive();
    drive.files.set('f9', '{not json');
    const local = { doc: doc('bbbbbbbbbbbbbbbb') };
    await expect(syncOnce(deps(drive, local))).rejects.toThrow(/can't be read/);
    expect(drive.files.get('f9')).toBe('{not json');
  });

  it('finds the file again when the remembered id is gone', async () => {
    const drive = new FakeDrive();
    const local = { doc: doc('bbbbbbbbbbbbbbbb') };
    const r = await syncOnce(deps(drive, local, { fileId: 'gone' }));
    expect(r.fileId).toBe('f1');
    expect(drive.calls).toEqual(['GET /drive/v3/files/gone', 'GET /drive/v3/files', 'POST /drive/v3/files', 'PATCH /upload/drive/v3/files/f1']);
  });

  it('names the step when a request never gets a readable reply', async () => {
    const drive = new FakeDrive();
    drive.unreachable.add('POST /drive/v3/files');
    await expect(syncOnce(deps(drive, { doc: doc('bbbbbbbbbbbbbbbb') }))).rejects.toThrow(/while creating the Drive file \(Failed to fetch\)/);
  });

  it('reports a 403 (Drive access not granted) as an error with Google\'s reason, not as an expired sign-in', async () => {
    const drive = new FakeDrive();
    drive.status = 403;
    const err = await syncOnce(deps(drive, { doc: doc('bbbbbbbbbbbbbbbb') })).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DriveAuthError);
    expect(String(err)).toMatch(/refused listing the Drive folder.*allow Google Drive access/);
  });

  it('reports an expired sign-in as DriveAuthError', async () => {
    const drive = new FakeDrive();
    drive.status = 401;
    await expect(syncOnce(deps(drive, { doc: doc('bbbbbbbbbbbbbbbb') }))).rejects.toBeInstanceOf(DriveAuthError);
  });

  it('stops without changing anything when cancelled during the download', async () => {
    const drive = new FakeDrive();
    const remoteText = JSON.stringify(doc('aaaaaaaaaaaaaaaa', { lessons: { a: { completedAt: at } } }));
    drive.files.set('f9', remoteText);
    const local = { doc: doc('bbbbbbbbbbbbbbbb') };
    const r = await syncOnce(deps(drive, local, { fileId: 'f9', cancelled: () => true }));
    expect(r).toMatchObject({ cancelled: true, applied: false, uploaded: false });
    expect(local.doc.lessons).toEqual({});
    expect(drive.files.get('f9')).toBe(remoteText);
  });
});

describe('driveSyncedWithin', () => {
  const now = Date.parse(later);
  it('counts a recent sync of a connected browser only', () => {
    expect(driveSyncedWithin({ connected: true, lastSyncAt: '2026-01-30T00:00:00.000Z' }, 7, now)).toBe(true);
    expect(driveSyncedWithin({ connected: true, lastSyncAt: at }, 7, now)).toBe(false);
    expect(driveSyncedWithin({ connected: false, lastSyncAt: '2026-01-30T00:00:00.000Z' }, 7, now)).toBe(false);
    expect(driveSyncedWithin({ connected: true }, 7, now)).toBe(false);
  });
});
