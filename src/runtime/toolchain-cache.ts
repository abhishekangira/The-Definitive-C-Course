// The compiler worker's cache-first fetch for the versioned toolchain URLs, kept apart from the worker so it can be unit-tested
// (see toolchain-cache.test.ts). The files are big (75 MB for the main wasm module), so a visit with a warm cache must need no network,
// and a failed load must not leave a file in the cache that would make every later attempt fail the same way.

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
  /** After a failed attempt: waits for in-flight puts, then deletes only what this attempt stored (a cache hit is never touched). */
  discardAttempt(): Promise<void>;
}

export function createToolchainFetch({ base, cacheName, fetch: realFetch, caches }: ToolchainFetchOptions): ToolchainFetch {
  const stats = { cacheHits: 0, networkFetches: 0 };
  const pendingPuts = new Set<Promise<unknown>>();
  let storedThisAttempt = new Set<string>();

  const cached: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), base);
    if (!url.href.startsWith(base.href) || !caches) return realFetch(input, init);
    try {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url.href);
      if (hit) { stats.cacheHits++; return hit; }
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
    beginAttempt() { storedThisAttempt = new Set(); },
    async discardAttempt() {
      if (!caches) return;
      await settled();
      const cache = await caches.open(cacheName);
      await Promise.all([...storedThisAttempt].map(u => cache.delete(u).catch(() => false)));
      storedThisAttempt = new Set();
    },
  };
}

export type LoadFailureKind = 'download' | 'startup';

/**
 * A failed fetch (TypeError), a corrupt module (WebAssembly.CompileError/LinkError) or our own size/status checks mean the
 * files are bad or missing: say "download" and drop what this attempt stored. Anything else (out of memory, a bug) says nothing about
 * the cache, so it is kept and the learner is told to reload instead of to check the connection.
 */
export function classifyLoadFailure(err: unknown): LoadFailureKind {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TypeError' || name === 'CompileError' || name === 'LinkError' || name === 'ToolchainDownloadError' ? 'download' : 'startup';
}

export class ToolchainDownloadError extends Error {
  override name = 'ToolchainDownloadError';
}

export function describeLoadFailure(kind: LoadFailureKind, detail: string): string {
  return kind === 'download'
    ? `The compiler could not be downloaded (${detail}). Check your internet connection and try again.`
    : `The compiler could not start (${detail}). Reload the page and try again; if it keeps happening, this device may be low on memory.`;
}

/**
 * bundle.js finds its wasm files with `new URL(name, import.meta.url)` (six places in the pinned build), which a blob: URL cannot
 * resolve, so each is pointed at the real bundle URL. The patch only knows that exact shape: if the bundle has none, uses
 * `import.meta.url` any other way, or uses another `import.meta` property, it is a new build the patch has not been checked
 * against, and failing here beats an obscure fetch error later.
 */
export function patchBundleSource(source: string, bundleUrl: string): string {
  const all = source.split('import.meta.url').length - 1;
  const asUrlBase = (source.match(/,\s*import\.meta\.url\)/g) ?? []).length;
  if (all === 0 || all !== asUrlBase || /import\.meta\.(?!url\b)/.test(source)) {
    throw new ToolchainDownloadError(`bundle.js uses import.meta in a way the patch does not know (${all} import.meta.url, ${asUrlBase} as new URL(x, import.meta.url)); new toolchain build? see toolchain-cache.ts`);
  }
  return source.replaceAll('import.meta.url', JSON.stringify(bundleUrl));
}
