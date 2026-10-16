/// <reference lib="webworker" />
// Long-lived worker that owns the ~75 MB clang/lld WebAssembly module. Never terminated between runs.
import courseRt from './c/course_rt.c?raw';
import ubsanRt from './c/ubsan_rt.c?raw';
import leakcheckC from './c/leakcheck.c?raw';
import leakcheckH from './c/leakcheck.h?raw';
import learncH from './c/learnc.h?raw';
import { compileC, compileStage, type RunClang, type SupportFiles } from './compile-core';
import type { CompilerIn, CompilerOut } from './protocol';
import { classifyLoadFailure, createToolchainFetch, describeLoadFailure, patchBundleSource, ToolchainDownloadError, type LoadFailureKind, type ToolchainFetch } from './toolchain-cache';

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
let tf: ToolchainFetch | null = null;
let initResolve!: () => void;
const initialised = new Promise<void>(r => (initResolve = r));

// Cache-first fetch for the versioned toolchain URLs. Installed BEFORE the yowasp bundle is imported,
// because the bundle captures `globalThis.fetch` when it is evaluated.
const realFetch = self.fetch.bind(self);
self.fetch = (input: RequestInfo | URL, init?: RequestInit) => (tf ? tf.fetch(input, init) : realFetch(input, init));

/**
 * Loads bundle.js (the yowasp JS that fetches the wasm files) through the cache-first fetch, so a visit with a warm cache
 * needs no network at all. A plain import() of the URL would always ask the network. See patchBundleSource for the blob: URL.
 */
async function importBundle(): Promise<{ runClang: RunClang }> {
  const url = new URL('bundle.js', base!).href;
  const resp = await self.fetch(url);
  if (!resp.ok) throw new ToolchainDownloadError(`HTTP ${resp.status} for bundle.js`);
  const blobUrl = URL.createObjectURL(new Blob([patchBundleSource(await resp.text(), url)], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ blobUrl)) as { runClang: RunClang };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

let clangP: Promise<RunClang> | null = null;
let loadFailure: { kind: LoadFailureKind; detail: string } | null = null;
function loadClang(): Promise<RunClang> {
  return (clangP ??= (async () => {
    await initialised;
    tf!.beginAttempt();
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
    // "Ready" means the cache is complete too: a learner who closes the tab right after the first Run must not lose the 75 MB file.
    await tf!.settled();
    post({ type: 'ready', ms: performance.now() - t0, cacheHits: tf!.stats.cacheHits, networkFetches: tf!.stats.networkFetches });
    return mod.runClang;
  })().catch(async err => {
    const kind = classifyLoadFailure(err);
    if (kind === 'download') await tf!.discardAttempt(); // files stored by this attempt are not trusted; earlier good ones are kept
    clangP = null;
    loadFailure = { kind, detail: String(err?.message ?? err) };
    post({ type: 'load-error', kind, message: loadFailure.detail });
    throw err;
  }));
}

self.onmessage = async (e: MessageEvent<CompilerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    base = new URL(msg.baseUrl);
    cacheName = `tdcc-toolchain-${msg.version}`;
    tf = createToolchainFetch({ base, cacheName, fetch: realFetch, caches: 'caches' in self ? self.caches : undefined });
    initResolve();
    return;
  }
  if (msg.type === 'prefetch') { loadClang().catch(() => {}); return; }
  let runClang: RunClang;
  try { runClang = await loadClang(); } catch (err) {
    const raw = describeLoadFailure(loadFailure?.kind ?? 'download', loadFailure?.detail ?? String((err as Error)?.message ?? err));
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
