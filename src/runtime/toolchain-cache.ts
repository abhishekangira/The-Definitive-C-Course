// The compiler worker's cache-first fetch for the versioned toolchain URLs, kept apart from the worker so it can be unit-tested
// (see toolchain-cache.test.ts). The files are big (75 MB for the main wasm module), so a visit with a warm cache must need no network,
// and a failed load must not leave a file in the cache that would make every later attempt fail the same way.

import type { RunClang } from './compile-core';

export interface ToolchainFetchOptions {
  base: URL;
  cacheName: string;
  fetch: typeof fetch;
  caches: CacheStorage | undefined;
}

export interface ToolchainFetch {
  fetch: typeof fetch;
  stats: { cacheHits: number; networkFetches: number };
  /** Resolves when every cache.put started so far has finished (stored or failed). The worker reports "ready" only after this. */
  settled(): Promise<void>;
  /** Starts a load attempt: forgets which URLs earlier attempts stored. */
  beginAttempt(): void;
  /**
   * After a failed attempt: waits for in-flight puts, then deletes what this attempt stored. With `'all'` it also deletes what
   * this attempt read from the cache, because a corrupt file that is already cached would otherwise fail every later attempt too.
   */
  discardAttempt(scope: 'stored' | 'all'): Promise<void>;
}

export function createToolchainFetch({ base, cacheName, fetch: realFetch, caches }: ToolchainFetchOptions): ToolchainFetch {
  const stats = { cacheHits: 0, networkFetches: 0 };
  const pendingPuts = new Set<Promise<unknown>>();
  let storedThisAttempt = new Set<string>();
  let hitThisAttempt = new Set<string>();

  const cached: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), base);
    if (!url.href.startsWith(base.href) || !caches) return realFetch(input, init);
    try {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url.href);
      if (hit) { stats.cacheHits++; hitThisAttempt.add(url.href); return hit; }
      const resp = await realFetch(url.href, init);
      stats.networkFetches++;
      if (resp.ok) {
        // Never await put() here: it drains its tee branch while the caller streams the other one (keeps progress live).
        // A body that errors mid-stream makes put() reject, so a truncated download is never stored.
        const put = cache.put(url.href, resp.clone()).then(() => { storedThisAttempt.add(url.href); }, () => {});
        pendingPuts.add(put);
        void put.finally(() => pendingPuts.delete(put));
      }
      return resp;
    } catch {
      stats.networkFetches++;
      return realFetch(input, init);
    }
  };

  const settled = async () => { await Promise.allSettled([...pendingPuts]); };
  return {
    fetch: cached,
    stats,
    settled,
    beginAttempt() { storedThisAttempt = new Set(); hitThisAttempt = new Set(); },
    async discardAttempt(scope) {
      if (!caches) return;
      await settled();
      const cache = await caches.open(cacheName);
      const doomed = scope === 'all' ? new Set([...storedThisAttempt, ...hitThisAttempt]) : storedThisAttempt;
      await Promise.all([...doomed].map(u => cache.delete(u).catch(() => false)));
      storedThisAttempt = new Set();
      hitThisAttempt = new Set();
    },
  };
}

/**
 * Why a load failed, which decides what is evicted and what the learner is told:
 * - `download`: the network failed (a fetch TypeError, or an HTTP error). What this attempt stored is dropped.
 * - `corrupt`: files that arrived or were cached are bad (WebAssembly.CompileError/LinkError, a bundle the patch rejects, or any
 *   other unexpected error while unpacking). Everything this attempt used, including cache hits, is dropped so Retry fetches it again.
 * - `startup`: the device ran out of memory (RangeError or a message about memory). The files are fine and are kept.
 * Unknown errors count as corrupt: deleting a good cache costs one download, keeping a bad one leaves the learner stuck.
 */
export type LoadFailureKind = 'download' | 'corrupt' | 'startup';

export class ToolchainDownloadError extends Error {
  override name = 'ToolchainDownloadError';
}
export class ToolchainCorruptError extends Error {
  override name = 'ToolchainCorruptError';
}

export function classifyLoadFailure(err: unknown): LoadFailureKind {
  const e = err as { name?: string; message?: string } | null;
  // fetch() and streams fail with a TypeError whose text names the network. Other TypeErrors (WebAssembly rejecting a cached
  // response with the wrong MIME type) mean the stored copy is bad.
  if (e?.name === 'TypeError' && /fetch|network|load failed|connection|abort|internet/i.test(String(e.message ?? ''))) return 'download';
  if (e?.name === 'ToolchainDownloadError') return 'download';
  if (e?.name === 'RangeError' || /memory/i.test(String(e?.message ?? ''))) return 'startup';
  return 'corrupt';
}

export function describeLoadFailure(kind: LoadFailureKind, detail: string): string {
  switch (kind) {
    case 'download': return `The compiler could not be downloaded (${detail}). Check your internet connection and try again.`;
    case 'corrupt': return `The saved copy of the compiler on this device is damaged (${detail}). It was removed: try again to download a fresh copy.`;
    case 'startup': return `The compiler could not start (${detail}). Reload the page and try again; if it keeps happening, this device may be low on memory.`;
  }
}

export class ToolchainLoadError extends Error {
  constructor(readonly kind: LoadFailureKind, readonly detail: string) { super(describeLoadFailure(kind, detail)); }
}

/**
 * One load attempt: import the bundle, fetch and compile the wasm modules (reporting progress), then wait until the cache is
 * complete before returning, so a learner who closes the tab right after the first Run does not lose the 75 MB file.
 * A failure evicts according to its kind and is rethrown as a ToolchainLoadError.
 */
export async function loadToolchain(o: {
  tf: ToolchainFetch;
  importBundle: () => Promise<{ runClang: RunClang }>;
  onProgress: (done: number, total: number) => void;
}): Promise<{ runClang: RunClang }> {
  o.tf.beginAttempt();
  try {
    const mod = await o.importBundle();
    // args=null: only fetch and compile the wasm modules and unpack the sysroot.
    await mod.runClang(null, {}, { fetchProgress: ({ doneLength, totalLength }: { doneLength: number; totalLength: number }) => o.onProgress(doneLength, totalLength) });
    await o.tf.settled();
    return mod;
  } catch (err) {
    const kind = classifyLoadFailure(err);
    if (kind === 'download') await o.tf.discardAttempt('stored');
    else if (kind === 'corrupt') await o.tf.discardAttempt('all');
    throw new ToolchainLoadError(kind, String((err as Error)?.message ?? err));
  }
}

/**
 * bundle.js finds its wasm files with `new URL(name, import.meta.url)` (six places in the pinned build), which a blob: URL cannot
 * resolve, so each is pointed at the real bundle URL. The patch only knows that exact shape: if the bundle has none, uses
 * `import.meta.url` any other way, or uses another `import.meta` property, it is a new build (or a damaged cached copy) the patch has not been checked
 * against, and failing here beats an obscure fetch error later.
 */
export function patchBundleSource(source: string, bundleUrl: string): string {
  const all = source.split('import.meta.url').length - 1;
  const asUrlBase = (source.match(/new URL\([^()]*,\s*import\.meta\.url\)/g) ?? []).length;
  if (all === 0 || all !== asUrlBase || /import\.meta\.(?!url\b)/.test(source)) {
    throw new ToolchainCorruptError(`bundle.js uses import.meta in a way the patch does not know (${all} import.meta.url, ${asUrlBase} as new URL(x, import.meta.url)); new toolchain build? see toolchain-cache.ts`);
  }
  return source.replaceAll('import.meta.url', JSON.stringify(bundleUrl));
}
