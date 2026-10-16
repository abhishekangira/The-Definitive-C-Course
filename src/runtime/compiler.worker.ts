/// <reference lib="webworker" />
// Long-lived worker that owns the ~75 MB clang/lld WebAssembly module. Never terminated between runs.
import courseRt from './c/course_rt.c?raw';
import ubsanRt from './c/ubsan_rt.c?raw';
import leakcheckC from './c/leakcheck.c?raw';
import leakcheckH from './c/leakcheck.h?raw';
import learncH from './c/learnc.h?raw';
import { compileC, compileStage, type RunClang, type SupportFiles } from './compile-core';
import type { CompilerIn, CompilerOut } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: CompilerOut, t: Transferable[] = []) => self.postMessage(m, t);

const SUPPORT: SupportFiles = {
  'course_rt.c': courseRt,
  'ubsan_rt.c': ubsanRt,
  'leakcheck.c': leakcheckC,
  'leakcheck.h': leakcheckH,
  'learnc.h': learncH,
};

let base: URL | null = null;
let cacheName = '';
let cacheHits = 0;
let networkFetches = 0;
// cache.put() calls still draining their body. A failed load waits for them, then deletes the cache (see loadClang).
const pendingPuts = new Set<Promise<unknown>>();
let initResolve!: () => void;
const initialised = new Promise<void>(r => (initResolve = r));

// Cache-first fetch for the versioned toolchain URLs. Installed BEFORE the yowasp bundle is imported,
// because the bundle captures `globalThis.fetch` when it is evaluated.
const realFetch = self.fetch.bind(self);
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
  if (!base || !url.href.startsWith(base.href) || !('caches' in self)) return realFetch(input, init);
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(url.href);
    if (hit) { cacheHits++; return hit; }
    const resp = await realFetch(url.href, init);
    networkFetches++;
    // Never await put(): it drains its tee branch while the caller streams the other (keeps progress live).
    if (resp.ok) {
      const put = cache.put(url.href, resp.clone()).catch(() => {}); // a body that errors mid-stream rejects here and is not stored
      pendingPuts.add(put);
      void put.finally(() => pendingPuts.delete(put));
    }
    return resp;
  } catch {
    networkFetches++;
    return realFetch(input, init);
  }
};

/**
 * Loads bundle.js (the yowasp JS that fetches the wasm files) through the cache-first fetch above, so a visit with a warm cache
 * needs no network at all. A plain import() of the URL would always ask the network (or the HTTP cache, which we don't control).
 * The bundle finds its wasm files with `new URL(name, import.meta.url)`, which a blob: URL cannot resolve, so that one
 * expression is replaced by the real bundle URL. Pinned toolchain only; if a new build uses import.meta.url differently,
 * the e2e tests in e2e/toolchain-download.spec.ts fail.
 */
async function importBundle(): Promise<{ runClang: RunClang }> {
  const url = new URL('bundle.js', base!).href;
  const resp = await self.fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for bundle.js`);
  const source = (await resp.text()).replaceAll('import.meta.url', JSON.stringify(url));
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ blobUrl)) as { runClang: RunClang };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

let clangP: Promise<RunClang> | null = null;
function loadClang(): Promise<RunClang> {
  return (clangP ??= (async () => {
    await initialised;
    const t0 = performance.now();
    if ('caches' in self) {
      for (const k of await caches.keys()) if (k.startsWith('tdcc-toolchain-') && k !== cacheName) await caches.delete(k);
    }
    const mod = await importBundle();
    let lastPost = 0;
    // args=null: only fetch and compile the wasm modules and unpack the sysroot.
    await mod.runClang(null, {}, {
      fetchProgress: ({ doneLength, totalLength }: { doneLength: number; totalLength: number }) => {
        const now = performance.now();
        if (now - lastPost > 100 || doneLength === totalLength) { lastPost = now; post({ type: 'progress', done: doneLength, total: totalLength }); }
      },
    });
    post({ type: 'ready', ms: performance.now() - t0, cacheHits, networkFetches });
    return mod.runClang;
  })().catch(async err => {
    // Nothing from a failed load is trusted: a file that was fully downloaded but is corrupt would otherwise be served from the
    // cache on every later attempt. The price is that files which did download are fetched again on Retry.
    if ('caches' in self) {
      await Promise.allSettled([...pendingPuts]);
      await caches.delete(cacheName).catch(() => false);
    }
    clangP = null;
    post({ type: 'load-error', message: String(err?.message ?? err) });
    throw err;
  }));
}

self.onmessage = async (e: MessageEvent<CompilerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    base = new URL(msg.baseUrl);
    cacheName = `tdcc-toolchain-${msg.version}`;
    initResolve();
    return;
  }
  if (msg.type === 'prefetch') { loadClang().catch(() => {}); return; }
  let runClang: RunClang;
  try { runClang = await loadClang(); } catch (err) {
    const raw = `The compiler could not be loaded (${String((err as Error)?.message ?? err)}). Check your internet connection and try again.`;
    if (msg.type === 'stage') post({ type: 'staged', id: msg.id, ok: false, text: '', diagnostics: [], raw, ms: 0 });
    else post({ type: 'compiled', id: msg.id, ok: false, diagnostics: [], raw, ms: 0 });
    return;
  }
  if (msg.type === 'stage') {
    const out = await compileStage(runClang, SUPPORT, msg.files, msg.stage, msg.source, msg.opt);
    post({ type: 'staged', id: msg.id, ...out });
    return;
  }
  const out = await compileC(runClang, SUPPORT, msg);
  const transfer = out.wasm ? [out.wasm.buffer as ArrayBuffer] : [];
  post({ type: 'compiled', id: msg.id, ok: out.ok, wasm: out.wasm, diagnostics: out.diagnostics, raw: out.raw, ms: out.ms }, transfer);
};
