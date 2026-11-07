/// <reference lib="webworker" />
// Long-lived worker that owns the ~75 MB clang/lld WebAssembly module. Never terminated between runs.
import courseRt from './c/course_rt.c?raw';
import ubsanRt from './c/ubsan_rt.c?raw';
import leakcheckC from './c/leakcheck.c?raw';
import leakcheckH from './c/leakcheck.h?raw';
import learncH from './c/learnc.h?raw';
import { compileC, compileStage, type RunClang, type RunLLVM, type SupportFiles } from './compile-core';
import type { CompilerIn, CompilerOut } from './protocol';
import { classifyLoadFailure, createToolchainFetch, describeLoadFailure, loadToolchain, patchBundleSource, ToolchainDownloadError, ToolchainLoadError, type ToolchainFetch } from './toolchain-cache';

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
 * The same module exports runLLVM (nm, objdump, size), so the object views share this one import and its cache.
 */
type ToolBundle = { runClang: RunClang; runLLVM: RunLLVM };
let runLLVMFn: RunLLVM | null = null;

async function importBundle(): Promise<ToolBundle> {
  const url = new URL('bundle.js', base!).href;
  const resp = await self.fetch(url);
  if (!resp.ok) throw new ToolchainDownloadError(`HTTP ${resp.status} for bundle.js`);
  const blobUrl = URL.createObjectURL(new Blob([patchBundleSource(await resp.text(), url)], { type: 'text/javascript' }));
  try {
    const mod = (await import(/* @vite-ignore */ blobUrl)) as ToolBundle;
    runLLVMFn = mod.runLLVM;
    return mod;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

let clangP: Promise<RunClang> | null = null;
let loadFailure: ToolchainLoadError | null = null;
function loadClang(): Promise<RunClang> {
  return (clangP ??= (async () => {
    await initialised;
    const t0 = performance.now();
    if ('caches' in self) {
      for (const k of await caches.keys()) if (k.startsWith('tdcc-toolchain-') && k !== cacheName) await caches.delete(k);
    }
    let lastPost = 0;
    const { runClang } = await loadToolchain({
      tf: tf!,
      importBundle,
      onProgress: (done, total) => {
        const now = performance.now();
        if (now - lastPost > 100 || done === total) { lastPost = now; post({ type: 'progress', done, total }); }
      },
    });
    post({ type: 'ready', ms: performance.now() - t0, cacheHits: tf!.stats.cacheHits, networkFetches: tf!.stats.networkFetches });
    return runClang;
  })().catch(err => {
    clangP = null;
    loadFailure = err instanceof ToolchainLoadError ? err : new ToolchainLoadError(classifyLoadFailure(err), String(err?.message ?? err));
    post({ type: 'load-error', kind: loadFailure.kind, message: loadFailure.detail });
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
    const raw = loadFailure?.message ?? describeLoadFailure('download', String((err as Error)?.message ?? err));
    if (msg.type === 'stage') post({ type: 'staged', id: msg.id, ok: false, text: '', diagnostics: [], raw, ms: 0 });
    else post({ type: 'compiled', id: msg.id, ok: false, diagnostics: [], raw, ms: 0 });
    return;
  }
  if (msg.type === 'stage') {
    if (!runLLVMFn) {
      post({ type: 'staged', id: msg.id, ok: false, text: '', diagnostics: [], raw: 'The toolchain did not provide runLLVM.', ms: 0 });
      return;
    }
    const out = await compileStage(runClang, runLLVMFn, SUPPORT, msg.files, msg.stage, msg.source, msg.opt);
    post({ type: 'staged', id: msg.id, ...out });
    return;
  }
  const out = await compileC(runClang, SUPPORT, msg);
  const transfer = out.wasm ? [out.wasm.buffer as ArrayBuffer] : [];
  post({ type: 'compiled', id: msg.id, ok: out.ok, wasm: out.wasm, diagnostics: out.diagnostics, raw: out.raw, ms: out.ms }, transfer);
};
