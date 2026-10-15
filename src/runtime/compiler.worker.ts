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
    if (resp.ok) cache.put(url.href, resp.clone()).catch(() => {});
    return resp;
  } catch {
    networkFetches++;
    return realFetch(input, init);
  }
};

let clangP: Promise<RunClang> | null = null;
function loadClang(): Promise<RunClang> {
  return (clangP ??= (async () => {
    await initialised;
    const t0 = performance.now();
    if ('caches' in self) {
      for (const k of await caches.keys()) if (k.startsWith('tdcc-toolchain-') && k !== cacheName) await caches.delete(k);
    }
    const mod = (await import(/* @vite-ignore */ new URL('bundle.js', base!).href)) as { runClang: RunClang };
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
  })().catch(err => {
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
    const raw = `The compiler could not be loaded: ${String((err as Error)?.message ?? err)}`;
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
