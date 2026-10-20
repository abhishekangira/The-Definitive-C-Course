import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressV1 } from './store';

// The store reads `previewed` when it loads, so each test loads a fresh copy of it over an in-memory localStorage.
const REAL = 'tdcc:v1:progress';
const PREVIEW = 'tdcc:v1:progress-preview';
const SEED = '0123456789abcdef';
const OTHER_SEED = 'fedcba9876543210';
const at = '2026-01-01T00:00:00.000Z';

function memoryStorage(initial: Record<string, string>) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => { items.set(k, String(v)); },
    removeItem: (k: string) => { items.delete(k); },
  } satisfies Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { items: Map<string, string> };
}

async function loadStore(previewed: string[], initial: Record<string, string> = {}) {
  vi.resetModules();
  vi.doMock('../content-runtime/preview', () => ({ previewed }));
  const storage = memoryStorage(initial);
  vi.stubGlobal('localStorage', storage);
  const store = await import('./store');
  return { store, storage };
}

const doc = (patch: Partial<ProgressV1>): string => JSON.stringify({ version: 1, seed: SEED, createdAt: at, ...patch });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../content-runtime/preview');
});

describe('progress while an unreleased module is previewed', () => {
  const real = doc({ lessons: { 'm01-l1': { completedAt: at } } });

  it('starts from the real progress, so the earlier modules count as done', async () => {
    const { store } = await loadStore(['m03'], { [REAL]: real });
    expect(Object.keys(store.getProgress().lessons)).toEqual(['m01-l1']);
    expect(store.getProgress().seed).toBe(SEED);
  });

  it('writes what the learner does to the preview document and never to the real one', async () => {
    const { store, storage } = await loadStore(['m03'], { [REAL]: real });
    store.markCard('m03-l1', 0);
    store.update(p => { p.lessons['m03-l1'] = { completedAt: at }; });
    expect(storage.items.get(REAL)).toBe(real);
    const saved = JSON.parse(storage.items.get(PREVIEW)!) as ProgressV1;
    expect(Object.keys(saved.lessons).sort()).toEqual(['m01-l1', 'm03-l1']);
    expect(saved.cards['m03-l1']).toEqual([0]);
  });

  it('keeps the preview progress across a reload and adds to it what the real document gained meanwhile', async () => {
    const first = await loadStore(['m03'], { [REAL]: real });
    first.store.update(p => { p.lessons['m03-l1'] = { completedAt: at }; });
    const later = doc({ lessons: { 'm01-l1': { completedAt: at }, 'm02-l1': { completedAt: at } } });
    const { store } = await loadStore(['m03'], { [REAL]: later, [PREVIEW]: first.storage.items.get(PREVIEW)! });
    expect(Object.keys(store.getProgress().lessons).sort()).toEqual(['m01-l1', 'm02-l1', 'm03-l1']);
    expect(store.getProgress().seed).toBe(SEED);
  });

  it('keeps a setting chosen in the preview across a reload (the real document is a copy underneath, not the last word)', async () => {
    const first = await loadStore(['m03'], { [REAL]: real });
    first.store.update(p => { p.settings.platform = 'linux-x86'; p.settings.storedOutputMode = true; });
    const { store } = await loadStore(['m03'], { [REAL]: real, [PREVIEW]: first.storage.items.get(PREVIEW)! });
    expect(store.getProgress().settings).toEqual({ platform: 'linux-x86', storedOutputMode: true });
  });

  it('keeps the later of the two export dates, so the export reminder is not reset by a reload', async () => {
    const older = '2026-02-01T00:00:00.000Z';
    const newer = '2026-03-01T00:00:00.000Z';
    const previewNewer = await loadStore(['m03'], { [REAL]: doc({ lastExportedAt: older }), [PREVIEW]: doc({ lastExportedAt: newer }) });
    expect(previewNewer.store.getProgress().lastExportedAt).toBe(newer);
    const realNewer = await loadStore(['m03'], { [REAL]: doc({ lastExportedAt: newer }), [PREVIEW]: doc({ lastExportedAt: older }) });
    expect(realNewer.store.getProgress().lastExportedAt).toBe(newer);
  });

  it('uses the real learner seed, so a completion token made for it stays valid in the preview', async () => {
    const { store } = await loadStore(['m03'], { [REAL]: real, [PREVIEW]: doc({ seed: OTHER_SEED }) });
    expect(store.getProgress().seed).toBe(SEED);
  });

  it('does not create a real document for a browser that has none', async () => {
    const { store, storage } = await loadStore(['m03']);
    store.update(p => { p.lessons['m03-l1'] = { completedAt: at }; });
    expect(storage.items.has(REAL)).toBe(false);
    expect(storage.items.has(PREVIEW)).toBe(true);
  });

  it('replacing or resetting progress in the preview leaves the real document alone too', async () => {
    const { store, storage } = await loadStore(['m03'], { [REAL]: real });
    store.replaceProgress(store.emptyProgress());
    expect(storage.items.get(REAL)).toBe(real);
  });
});

describe('resetting progress on an ordinary page', () => {
  const copy = doc({ lessons: { 'm01-l1': { completedAt: at }, 'm03-l1': { completedAt: at } } });

  it('also deletes the preview document, which holds a copy of the old progress', async () => {
    const { store, storage } = await loadStore([], { [REAL]: doc({ lessons: { 'm01-l1': { completedAt: at } } }), [PREVIEW]: copy });
    store.replaceProgress(store.emptyProgress());
    expect(storage.items.has(PREVIEW)).toBe(false);
  });

  it('so the next preview starts from the reset progress, not from the old copy', async () => {
    const reset = await loadStore([], { [REAL]: doc({ lessons: { 'm01-l1': { completedAt: at } } }), [PREVIEW]: copy });
    reset.store.replaceProgress(reset.store.emptyProgress());
    const { store } = await loadStore(['m03'], Object.fromEntries(reset.storage.items));
    expect(store.getProgress().lessons).toEqual({});
  });
});

describe('the previewing flag (what export and any sync check before sending the document out of the page)', () => {
  it('is true while a draft is previewed, and false on an ordinary page', async () => {
    expect((await loadStore(['m03'])).store.previewing).toBe(true);
    expect((await loadStore([])).store.previewing).toBe(false);
  });
});

describe('progress on an ordinary page', () => {
  it('writes the real document and never the preview one', async () => {
    const { store, storage } = await loadStore([], { [REAL]: doc({}) });
    store.update(p => { p.lessons['m01-l1'] = { completedAt: at }; });
    expect(Object.keys((JSON.parse(storage.items.get(REAL)!) as ProgressV1).lessons)).toEqual(['m01-l1']);
    expect(storage.items.has(PREVIEW)).toBe(false);
  });

  it('ignores a preview document left behind by an earlier preview', async () => {
    const { store } = await loadStore([], { [REAL]: doc({}), [PREVIEW]: doc({ lessons: { 'm03-l1': { completedAt: at } } }) });
    expect(store.getProgress().lessons).toEqual({});
  });

  it('creates the real document for a new learner', async () => {
    const { storage } = await loadStore([]);
    expect(JSON.parse(storage.items.get(REAL)!)).toMatchObject({ version: 1 });
  });
});
