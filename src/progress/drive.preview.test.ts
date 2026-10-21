import { afterEach, describe, expect, it, vi } from 'vitest';

// While an unreleased module is previewed the progress document is the real progress plus the draft's, so Drive sync must send nothing
// (docs/adr/0004-unreleased-modules.md). Each test loads fresh copies of drive.ts and store.ts over an in-memory localStorage.
const DRIVE_KEY = 'tdcc:v1:drive';

async function loadDrive(previewed: string[]) {
  vi.resetModules();
  vi.doMock('../content-runtime/preview', () => ({ previewed }));
  const items = new Map<string, string>([[DRIVE_KEY, JSON.stringify({ connected: true, token: 'tok', tokenExpiresAt: Date.now() + 3_600_000 })]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => { items.set(k, String(v)); },
    removeItem: (k: string) => { items.delete(k); },
  } satisfies Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>);
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' });
  const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ files: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client');
  const store = await import('./store');
  const drive = await import('./drive');
  return { store, drive, fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('../content-runtime/preview');
});

describe('Drive sync while an unreleased module is previewed', () => {
  it('sends nothing: not at start-up, not when a button calls syncNow, and not when autosave would fire', async () => {
    vi.useFakeTimers();
    const { store, drive, fetchMock } = await loadDrive(['m03']);
    drive.startDriveSync();
    await drive.syncNow();
    store.update(p => { p.lessons['m03-l1'] = { completedAt: '2026-01-01T00:00:00.000Z' }; });
    await vi.advanceTimersByTimeAsync(drive.AUTOSAVE_DELAY_MS + 1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Drive sync on an ordinary page (the control: the same setup does send)', () => {
  it('starts a sync at start-up for a connected browser', async () => {
    vi.useFakeTimers();
    const { drive, fetchMock } = await loadDrive([]);
    drive.startDriveSync();
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('uploads again after a change, once the autosave delay has passed', async () => {
    vi.useFakeTimers();
    const { store, drive, fetchMock } = await loadDrive([]);
    drive.startDriveSync();
    await vi.advanceTimersByTimeAsync(50);
    const before = fetchMock.mock.calls.length;
    store.update(p => { p.lessons['m01-l1'] = { completedAt: '2026-01-01T00:00:00.000Z' }; });
    await vi.advanceTimersByTimeAsync(drive.AUTOSAVE_DELAY_MS + 1000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});
