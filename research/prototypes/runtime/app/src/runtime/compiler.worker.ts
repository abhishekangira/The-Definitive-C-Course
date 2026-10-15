/// <reference lib="webworker" />
// Long-lived worker that owns the ~75 MB clang/lld WebAssembly module. Never terminated between runs.
import tc from './toolchain-version.json';
import courseRt from './course_rt.c?raw';
import type { CompileRequest, CompilerOut, PrefetchRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: CompilerOut, t: Transferable[] = []) => self.postMessage(m, t);

const BASE = new URL(`${import.meta.env.BASE_URL}toolchain/clang-${tc.version}/`, self.location.origin);
const CACHE_NAME = `toolchain-clang-${tc.version}`;
let cacheHits = 0, networkFetches = 0;

// Cache-first fetch for the versioned toolchain URLs. Must be installed BEFORE the yowasp bundle is
// imported, because the bundle captures `globalThis.fetch` at module-evaluation time.
const realFetch = self.fetch.bind(self);
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
  if (!url.href.startsWith(BASE.href) || !('caches' in self)) return realFetch(input, init);
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url.href);
    if (hit) { cacheHits++; return hit; }
    const resp = await realFetch(url.href, init);
    networkFetches++;
    // Don't await: put() drains its tee branch while the caller streams the other one (keeps progress events live).
    if (resp.ok) cache.put(url.href, resp.clone()).catch(() => {}); // quota errors => just don't cache
    return resp;
  } catch { networkFetches++; return realFetch(input, init); }
};

type Clang = { runClang: (args: string[] | null, files?: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<Record<string, any>> };
let clangP: Promise<Clang> | null = null;
function loadClang(): Promise<Clang> {
  return clangP ??= (async () => {
    const t0 = performance.now();
    if ('caches' in self) for (const k of await caches.keys()) if (k.startsWith('toolchain-clang-') && k !== CACHE_NAME) await caches.delete(k);
    const mod: Clang = await import(/* @vite-ignore */ new URL('bundle.js', BASE).href);
    let lastPost = 0;
    await mod.runClang(null, {}, {               // args=null => only fetch + compile the wasm modules and unpack the sysroot
      fetchProgress: ({ doneLength, totalLength }: { doneLength: number; totalLength: number }) => {
        const now = performance.now();
        if (now - lastPost > 100 || doneLength === totalLength) { lastPost = now; post({ type: 'progress', done: doneLength, total: totalLength }); }
      },
    });
    post({ type: 'ready', ms: performance.now() - t0, cacheHits, networkFetches });
    return mod;
  })();
}

const BASE_FLAGS = [
  '-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0', '-fno-color-diagnostics',
  '-D_WASI_EMULATED_PROCESS_CLOCKS', '-D_WASI_EMULATED_SIGNAL',   // clock(), signal()/raise()
];
const LINK_FLAGS = [
  '-lwasi-emulated-process-clocks', '-lwasi-emulated-signal',
  '-Wl,-z,stack-size=8388608',       // 8 MiB stack like Linux (wasm-ld default is 64 KiB); stack-first layout => overflow traps
  '-Wl,--max-memory=268435456',      // 256 MiB cap => malloc() returns NULL instead of eating the tab
];

self.onmessage = async (e: MessageEvent<CompileRequest | PrefetchRequest>) => {
  const msg = e.data;
  if (msg.type === 'prefetch') { loadClang().catch(err => console.error(err)); return; }
  const { runClang } = await loadClang();
  const t0 = performance.now();
  let diagnostics = '';
  const dec = new TextDecoder();
  const sink = (b: Uint8Array | null) => { if (b) diagnostics += dec.decode(b, { stream: true }); };
  try {
    const out = await runClang(
      ['clang', ...BASE_FLAGS, ...(msg.extraFlags ?? []), 'main.c', 'course_rt.c', '-o', 'main.wasm', ...LINK_FLAGS],
      { 'main.c': msg.source, 'course_rt.c': courseRt },
      { stdout: sink, stderr: sink, decodeASCII: false },
    );
    const wasm = out['main.wasm'] as Uint8Array;
    post({ type: 'compiled', id: msg.id, ok: true, exitCode: 0, wasm, diagnostics, ms: performance.now() - t0 }, [wasm.buffer]);
  } catch (err: any) {
    if (typeof err?.code !== 'number') throw err;   // not a yowasp Exit
    post({ type: 'compiled', id: msg.id, ok: false, exitCode: err.code, diagnostics, ms: performance.now() - t0 });
  }
};
