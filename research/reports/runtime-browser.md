# Browser execution layer for WASI C programs: design report and prototype

Everything below was verified by running it in Node 22.22.0 or in headless Chromium 141.0.7390.37 (Playwright-core 1.56.1, `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), unless it is tagged **[DOCS]** (read in documentation, not run) or **[UNVERIFIED]**. Firefox and Safari could not be tested here.

The prototype works end to end in Chromium: it loads `@yowasp/clang`, compiles C17, runs the program with `@bjorn3/browser_wasi_shim`, and handles interactive `scanf`, preset stdin, timeouts, Stop, output caps, traps and an in-memory filesystem. It was tested with the GitHub Pages base path, in the Vite build and in the Vite dev server.

Timings, on a localhost server that mimics GitHub Pages:

| Step | Time |
|---|---|
| Toolchain ready, first visit (unthrottled) | 1.1–2.8 s |
| First prompt after clicking Run, first visit, throttled to 5 MB/s | 8.0 s |
| Toolchain ready, repeat visit (new browser process) | 0.32 s, with 0 network requests |
| First prompt after clicking Run, repeat visit | 1.4 s |
| First compile after load | about 500 ms |
| Compile when warm (40 runs) | median 146 ms (min 106, p90 187) |
| Starting and running a program | 4–7 ms |

## 0. Where the code is
Everything is under `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/runtime/`:
- `app/` is the Vite 8.3.4 + React 19.3.1 + TS 5.9.3 prototype:
  - `app/src/runtime/{wasi-run.ts, run.worker.ts, compiler.worker.ts, CRuntime.ts, protocol.ts, course_rt.c}`
  - `app/src/App.tsx`, `app/vite.config.ts`, `app/scripts/copy-toolchain.mjs`
- `proto/` holds the plain-JS version of the runner and the Node test suites (`node-suite*.mjs`).
- `scripts/` holds:
  - `serve.mjs`: a static server mimicking GitHub Pages (gzip, ETag, `max-age=600`, `application/wasm`), with optional `--coi` and `--throttle=MBps`.
  - The Playwright tests: `browser-test.mjs`, `browser-ui.mjs`, `browser-depth*.mjs`, `browser-mem*.mjs`, `browser-coisw.mjs`.
- Screenshots: `shot-throttled.png`, `shot-dev.png`.
- `native/` holds the glibc comparison programs and `pty_probe.py`.

Commands that worked:
```
cd app && npm install --save-exact vite@8.3.4 @vitejs/plugin-react@6.1.2 react@19 react-dom@19 typescript@5 @types/react@19 @types/react-dom@19 @yowasp/clang@22.0.0-git20542-10 @bjorn3/browser_wasi_shim@0.4.2 playwright-core@1.56.1
STRIP_CXX=1 node scripts/copy-toolchain.mjs && npx tsc --noEmit && BASE=/the-definitive-c-course/ npx vite build
node ../scripts/serve.mjs dist 8701 /the-definitive-c-course/ [--coi] [--throttle=5]
node ../scripts/browser-test.mjs 8701 ../profiles/plain "label"
```

## 1. Compiler package facts (VERIFIED)
`@yowasp/clang@22.0.0-git20542-10` (ISC wrapper, LLVM Apache-2.0) is 105,501,358 B unpacked and was published 2026-03-12. It pulls in no npm dependencies; its runtime is inlined in `gen/bundle.js`. Files in `gen/`:

| File | Raw | gzip -6 | brotli q9 | Notes |
|---|---|---|---|---|
| `llvm.core.wasm` | 75,532,134 | 22,769,223 | 17,233,961 | No custom sections to strip (code 65.8 MB, data 9.47 MB) |
| `llvm-resources.tar` (sysroot) | 29,665,280 | 4,307,195 | 3,074,212 | 12.5 MB is libc++ headers, 3.5 MB is `libc++.a` |
| Stripped tar (my script) | 2,885,632 | 928,740 | — | C only; 305 entries kept, 2,161 dropped |
| `bundle.js` | 253,925 | 25,256 | — | |
| `llvm.core2/3/4.wasm` | 37,626 / 5,458 / 787 | | | |

API and behaviour:
- `runClang(args, files, {stdout, stderr, fetchProgress, decodeASCII})` resolves to an output file tree, or throws `Exit` with `.code` set (1 on compile errors).
- One compile is three instantiations of the same compiled module (`clang -###`, `cc1`, `wasm-ld`).
- Resources load via `fetch(new URL('./llvm.core.wasm', import.meta.url))` and `WebAssembly.compileStreaming`.
- The bundle captures `globalThis.fetch` when the module is first evaluated. To intercept its fetches, patch `fetch` before you import the bundle.
- **Gotcha:** the `-###` step does not pass `fetchProgress` along, so the progress callback is silently ignored and the default console logger runs. Prefetch with `runClang(null, {}, {fetchProgress})` first; args set to null means "fetch and compile resources only".
- Default target is `wasm32-wasip1`. Diagnostics follow clang's `file:line:col: severity: msg` format. `-fno-color-diagnostics` is plain text; colour is ANSI.
- Node: cold compile 1,207 ms (including load), warm 98 ms, compile error 56 ms.

## 2. WASI shim choice → **@bjorn3/browser_wasi_shim 0.4.2**, extended with custom `Fd` subclasses

| | browser_wasi_shim 0.4.2 | @runno/wasi 0.10.0 | @wasmer/sdk 0.19.1 | Custom preview1 |
|---|---|---|---|---|
| License | MIT OR Apache-2.0 | MIT | "Modified MIT" (must show "Wasmer" in the UI above 1M MAU or $1M/month revenue) | ours |
| Size | 114 KB unpacked; **whole run worker built = 25.5 KB, 6.7 KB gzip** | 130 KB unpacked (85 KB main.js) | 4.83 MB wasm (1.79 MB gzip) + 124 KB JS | ~600–800 LOC (estimate) |
| Last release | 2025-06-22, 27 releases, 78.9k downloads/week | 2025-05-18, 2.4k/week | 2026-10-07, 7k/week | — |
| stdout/stderr | Custom `Fd.fd_write(Uint8Array)`: bytes, you decode | Callback gets a **string decoded per chunk without `stream:true`** (splits multibyte UTF-8) | streams | — |
| stdin | Custom `Fd.fd_read(size)`, sync; easy to block or suspend | `() => string \| null`; its worker host needs COI | needs COI | — |
| Virtual FS | `PreopenDirectory`/`Directory`/`File` in memory; read back after run | path→file map | full WASIX | — |
| clock/random | `performance.now`/`Date`; `crypto.getRandomValues` | ok | ok | — |
| `proc_exit` | throws `WASIProcExit(code)` | throws | — | — |
| Quirks I hit | **debug logging is ON when the options arg is omitted** (`enable(undefined)` becomes true), so pass `{debug:false}`. `poll_oneoff` busy-waits (`sleep()` spins a CPU) and supports only one subscription. `proc_raise` throws a string. | `poll_oneoff` busy-waits; writes to fd 0 return ENOTSUP | heavy; requires COOP/COEP for workers | — |

Recommendation:
- Use browser_wasi_shim. All I/O policy lives in our own `Fd` subclasses:
  - `StdinFd`: sync, SharedArrayBuffer (SAB) or JSPI.
  - `OutFd`: character device, byte budget.
- It is small and well used. If upstream stalls, vendor it (the license allows that).
- Runno: its string-based stdin/stdout API and its worker host's COI requirement are a worse fit.
- Wasmer: overkill, with license and COI strings attached.

Imports a typical program needs (checked with `WebAssembly.Module.imports`): `args_get`, `args_sizes_get`, `clock_time_get`, `fd_close`, `fd_fdstat_get`, `fd_fdstat_set_flags`, `fd_prestat_get`, `fd_prestat_dir_name`, `fd_read`, `fd_seek`, `fd_write`, `path_open`, `proc_exit`.

## 3. Architecture (VERIFIED in Chromium)
```
Main thread (React) ── CRuntime
  ├─ compiler.worker (module worker, long-lived): owns the 75 MB clang module, Cache-API-backed fetch
  └─ run.worker (module worker, ONE PER RUN, pre-spawned): browser_wasi_shim + program
        stdout/stderr → batched postMessage (flush at >16 KB or >33 ms, and before every stdin wait)
        stdin → JSPI (await a postMessage) | SAB + Atomics.wait | preset text
  watchdog: CPU-time budget (paused while waiting for stdin) → worker.terminate()
```

Why two workers: `terminate()` on the run worker kills an infinite loop and leaves the warm compiler alive. Verified: after a 2 s timeout kill, the next compile took 159 ms.

Measured behaviour:
- **Infinite loop** `for(;;) i++;`: `{kind:'timeout'}` at 2,001 ms wall.
- **Stop button**: killed at 501 ms. Partial output `tick 0\ntick 1` had already streamed.
- **Time waiting on stdin is not charged**: 1 s budget, user typed after 1.5 s, program exited normally.
- **Output cap** (1 MiB across stdout and stderr): `{kind:'output-limit'}` after 883 ms, output streamed in about 4 KB batches. Throwing from `fd_write` unwinds the wasm.
- **Incremental streaming**: a program printing every 0.3 s produced separate `step 0`/`step 1`/`step 2` messages as they happened.
- **Traps → friendly hints**:

| Program | Wasm trap | Hint shown |
|---|---|---|
| `10/0` | `divide by zero` | SIGFPE |
| `abort()` / failed `assert` | `unreachable`; assert first prints `Assertion failed: x==2 (main.c: main: 2)` to stderr | — |
| Stack overflow | `memory access out of bounds` or `RangeError: Maximum call stack size exceeded` | — |

- **Exit codes**: `return 3` reports 3. `exit(7)` runs `atexit` handlers. `_Exit` skips the stdio flush (same as native). A trailing `printf` without `\n` is flushed at exit.
- **Memory**: page renderer is 121 MB when the page loads, 240 MB when the toolchain is ready, and 278 MB after 20 compile+run cycles. It was flat across 40 cycles, so no leak was seen.

## 4. Interactive stdin → **JSPI primary, SAB when cross-origin isolated, preset text box as fallback**
All three are implemented behind one `StdinMode` and auto-detected by `detectStdinMode()`.

**(c) JSPI** — verified in Chromium 141, with no COOP/COEP needed.
- Wrap `fd_read` in `new WebAssembly.Suspending(async …)` and call `WebAssembly.promising(_start)()`.
- The program binary is unmodified (no Asyncify).
- Browser support per webassembly.org `features.json` (fetched from raw.githubusercontent) **[DOCS]**: Chrome 137, Firefox 153 (about June 2026), Safari 27, Node 26.
- Learners on Safari 26 or older do not have it.

**(b) SAB + Atomics.wait** — verified with real COOP/COEP headers. Also verified on a server with no headers using `coi-serviceworker@0.1.7`, which is what GitHub Pages would need: MIT, 4.7 KB, last published 2023-07, one forced reload, isolated 241 ms after navigation.
- I do not recommend shipping COI by default. It forces a reload on the first visit, routes every fetch (including the 75 MB wasm) through a service worker, and COEP `require-corp` blocks cross-origin embeds and images that lack CORP **[DOCS]**.
- Use SAB only where the host can set headers, for example a Netlify/Cloudflare `_headers` file **[DOCS]**.

**(a) Preset stdin** — always works. When the input runs out, `scanf` gets EOF.
- **[UNVERIFIED idea]** A "replay" fallback for old Safari: when the program asks for more input than was given, abort, ask the user for a line, then re-run with the accumulated input and hide output already shown. This only works for deterministic programs.

**Libc finding (VERIFIED):** wasi-libc (musl) does not flush stdout before blocking on stdin.
- `printf("n? "); scanf(...)` leaves the prompt invisible. glibc on a real TTY shows it; I confirmed natively with a Python pty that `n? ` appears before input.
- Fix: link `course_rt.c` into every program. It exports `__course_flush_stdout()`, and the JS stdin hook calls it before waiting.
- Verified event order: `["out","n? "],["STDIN-REQUEST"],["out","got 5"]…`.

```c
/* course_rt.c — compiled and linked with every learner program */
#include <stdio.h>
__attribute__((export_name("__course_flush_stdout")))
void __course_flush_stdout(void) { fflush(stdout); }
```

Other stdio parity facts:
- `fdstat` reports a character device with no seek rights, so `isatty()` is true and stdout is line-buffered like a terminal.
- stdout/stderr interleaving matched TTY behaviour: `err1`, `out1 out2`, `err2`.
- **For the native verification pipeline:** run natively under a pty, or compare stdout and stderr separately. Piped glibc output is fully buffered and reorders streams.

## 5. Things the build-time verifier must flag (VERIFIED wasm vs native x86-64)
- **Type sizes:** `sizeof(void*)=4`, `sizeof(long)=4`, `size_t=4`, `long double=16`. Native is 8/8/8/16.
- **NULL dereference does not trap**: it reads 0 and the write succeeds silently.
  - `-fsanitize=undefined -fsanitize-trap=undefined` traps (`unreachable`) on null, signed overflow and OOB.
  - `-fsanitize=bounds -fsanitize-trap=bounds` traps on OOB array access.
  - No runtime library is needed for these. ASan is not available on wasm.
- **An uninitialised local printed 0** in wasm.
- **`clock()`** needs `-D_WASI_EMULATED_PROCESS_CLOCKS -lwasi-emulated-process-clocks`, and then `CLOCKS_PER_SEC` is **1000000000** (glibc: 1000000).
- **`signal`/`raise`** need `-D_WASI_EMULATED_SIGNAL -lwasi-emulated-signal`.
- **`setjmp`/`longjmp`** need `-mllvm -wasm-enable-sjlj -lsetjmp`. Verified working in Node 22 and in this toolchain.
- **Stack:**
  - Default stack is 64 KiB. The default layout is stack-first (a local was at 65532, below globals at 67976), so overflow traps instead of corrupting data.
  - I link with `-Wl,-z,stack-size=8388608`.
  - **But the browser's native call stack is the real limit for small frames.** Max recursion depth with a tiny frame:

| | Tiny frame, -O0 | Tiny frame, -O2 | 1 KB frames |
|---|---|---|---|
| Chromium, synchronous run | ~5,770 | ~7,960 | — |
| Chromium, under JSPI | ~10,900 | ~14,900 | ~8,050 (OOB trap) |
| Native gcc, 8 MiB stack | ~171,900 | — | ~7,770 |

  - Running under JSPI roughly doubles the depth, so consider always running under `promising()` when JSPI exists.
  - Lessons demonstrating stack overflow should use large frames so browser and native behave alike.
- **`malloc`:** `-Wl,--max-memory=268435456` gives NULL after 247 MiB instead of eating the tab.

## 6. Caching and loading the compiler
Verified:
- **Versioned immutable path** `toolchain/clang-<version>/`, plus a cache-first `fetch` wrapper inside the compiler worker using Cache Storage `toolchain-clang-<ver>`. Old caches are deleted.
  - Second visit in a new browser process: 5 cache hits, **0 network requests**, ready in 319–331 ms.
  - Storage used: 78.5 MB (bodies stored decompressed).
- **Don't `await cache.put`.** Awaiting it drained the whole response before returning, and progress sat at 0% until done. Without the await, progress advanced 16%→28%→…→99% every 0.5 s at 5 MB/s.
- **Lazy loading:** the toolchain downloads on the first Run (or a `prefetch()` you trigger yourself), with a progress bar computed against `totalSize`. `copy-toolchain.mjs` patches the baked-in `totalSize` after stripping. Progress counts decompressed bytes, so it is correct under gzip.
- **Stripping the sysroot:** dropping libc++, CUDA/HIP/OpenCL/HLSL, x86/ARM/PPC/Hexagon/RISC-V intrinsic headers, sanitizer headers and `libclang_rt.profile` gives 29.7 MB → 2.9 MB (gzip 4.31 → 0.93 MB). I compiled and ran a program including 36 headers at default, `-O2` and UBSan-trap:
  - all the C17 standard headers, including `threads.h`, `tgmath.h`, `complex.h`, `stdatomic.h`
  - POSIX `unistd.h`, `fcntl.h`, `dirent.h`
  - `wasm_simd128.h`

  `llvm.core.wasm` cannot be stripped after the fact. Shrinking it would mean rebuilding LLVM, which is the teammate's area.
- **Total first-visit download (gzip):** about 23.8 MB. The run worker is 6.7 KB gzip, the compiler worker 2.3 KB.

GitHub Pages:
- **Verified from live sites:** `.wasm` is served as `application/wasm`; binji's 31 MB octet-stream was served gzip-encoded; `cache-control: max-age=600` and an ETag on everything.
- **[DOCS]** (docs.github.com via curl): 1 GB published-site limit, **100 GB/month soft bandwidth**, 10-minute deploy timeout, no custom headers.
- At 23.8 MB per first visit, roughly 4,000 first-time toolchain downloads per month fit under the bandwidth limit. Plan for it.
- **[DOCS]** jsDelivr README: packages over 150 MB unsupported; the 20 MB per-file limit is stated for the GitHub endpoint. The npm endpoint was not testable here (blocked).
- **[DOCS]** V8 blog: the wasm code cache needs `compileStreaming` or `instantiateStreaming`, a module of at least 128 kB, and is written after TurboFan finishes; it works in workers. Whether it applies to Cache-API responses is unknown, but warm load was 0.32 s either way.
- Call `navigator.storage.persist()` after the first successful compile **[DOCS]**.

## 7. Vite + React + TS integration (VERIFIED build and dev, with `BASE=/the-definitive-c-course/`)
- Create workers with `new Worker(new URL('./compiler.worker.ts', import.meta.url), {type:'module'})` and set `worker.format: 'es'`.
- The build emitted `/the-definitive-c-course/assets/compiler.worker-*.js`; dev serves `…/src/runtime/compiler.worker.ts?worker_file&type=module`.
- Copy the toolchain into `public/toolchain/clang-<ver>/` in a prebuild step, then load it with `import(/* @vite-ignore */ new URL('bundle.js', BASE).href)`, where
  `BASE = new URL(`${import.meta.env.BASE_URL}toolchain/clang-${ver}/`, self.location.origin)`.
  Vite dev served the 75 MB file as `application/wasm`.
- `import courseRt from './course_rt.c?raw'` inlines the runtime source.
- **Alternative (verified, works):** `import { runClang } from '@yowasp/clang'` directly in the worker, with `optimizeDeps.exclude`.
  - Vite then emits hashed `llvm.core-*.wasm` and the full 29.7 MB tar.
  - It inlines the 787-byte `core4` as a data URL and externalises `node:fs`.
  - It worked in Chromium. It is less controllable: no stripping, no cache naming.
- **Quirk:** the first dev-server load hung my UI test once, most likely during Vite's dependency pre-bundling on first load (not confirmed); later runs worked.

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.BASE ?? '/', plugins: [react()], worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  server: { headers: process.env.COI ? isolation : {} }, preview: { headers: process.env.COI ? isolation : {} },
  optimizeDeps: { exclude: ['@yowasp/clang'] },
});
```

## 8. Key code (verified)
Compile flags (compiler worker):
```ts
const BASE_FLAGS = ['-std=c17','-Wall','-Wextra','-pedantic','-O0','-fno-color-diagnostics',
  '-D_WASI_EMULATED_PROCESS_CLOCKS','-D_WASI_EMULATED_SIGNAL'];
const LINK_FLAGS = ['-lwasi-emulated-process-clocks','-lwasi-emulated-signal',
  '-Wl,-z,stack-size=8388608','-Wl,--max-memory=268435456'];
runClang(['clang', ...BASE_FLAGS, ...extra, 'main.c', 'course_rt.c', '-o', 'main.wasm', ...LINK_FLAGS],
         { 'main.c': src, 'course_rt.c': courseRt }, { stdout: sink, stderr: sink, decodeASCII: false });
```

Cache-first fetch, installed before the bundle import:
```ts
const realFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
  if (!url.href.startsWith(BASE.href) || !('caches' in self)) return realFetch(input, init);
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url.href); if (hit) return hit;
  const resp = await realFetch(url.href, init);
  if (resp.ok) cache.put(url.href, resp.clone()).catch(() => {});   // NOT awaited
  return resp;
};
```

Runner core (`wasi-run.ts`, excerpt):
```ts
class StdinFd extends Fd {            // chardev; may block (SAB) or be pre-filled (JSPI)
  fd_read(size) { if (!this.pending.length) { this.beforeRead(); const c = this.readChunk(size);
      if (!c || !c.length) return { ret: 0, data: EMPTY }; this.pending = c; }
    const out = this.pending.slice(0, size); this.pending = this.pending.subarray(out.length); return { ret: 0, data: out }; } }
class OutFd extends Fd {              // chardev => isatty => line-buffered; byte budget
  fd_write(d) { if (!d.byteLength) return {ret:0,nwritten:0}; this.budget.used += d.byteLength;
    if (this.budget.used > this.budget.max) throw new OutputLimitExceeded(...); this.sink(d); return {ret:0,nwritten:d.byteLength}; } }
const w = new WASI(args, env, [stdin, out1, out2, new PreopenDirectory('/', toMap({tmp:{}, ...files}))], { debug: false });
const imports = { ...w.wasiImport };
if (stdinAsync) imports.fd_read = new WebAssembly.Suspending(async (fd, iovs, n, nread) => {
  if (fd === 0 && !stdin.pending.length) { instance.exports.__course_flush_stdout?.(); jspiChunk = await stdinAsync(4096); }
  return syncRead(fd, iovs, n, nread); });
instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: imports }); w.inst = instance;
try { stdinAsync ? await WebAssembly.promising(instance.exports._start)() : instance.exports._start(); }
catch (e) { /* WASIProcExit → exit code; OutputLimitExceeded; RuntimeError/RangeError → trap + hint */ }
```

SAB stdin, worker side (main thread writes bytes, sets `ctrl[1]=len`, `ctrl[0]=1` for data or `2` for EOF, then `Atomics.notify`):
```ts
stdinSync = () => { flush(); Atomics.store(ctrl, 0, 0); post({type:'stdin-request'});
  Atomics.wait(ctrl, 0, 0); if (Atomics.load(ctrl, 0) === 2) return null;
  return data.slice(0, Atomics.load(ctrl, 1)); };
```

CPU-time watchdog (`CRuntime.run`):
```ts
const resumeClock = () => { sliceStart = performance.now();
  timer = setTimeout(() => { worker.terminate(); finish({ kind: 'timeout', ... }); }, budget - used); };
const pauseClock = () => { clearTimeout(timer); used += performance.now() - sliceStart; };
// stdin-request → pauseClock(); input delivered → resumeClock(); the next run worker is pre-spawned after each run
```

Main thread decodes output with one streaming `TextDecoder` per fd. Diagnostics are parsed with `/^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/gm` for editor markers.

## 9. Open items
- Firefox 153+ and Safari 27 were not tested: JSPI behaviour, memory use of the 75 MB module on iOS, and recursion depth.
- Brotli on GitHub Pages was not checked; I only saw gzip. Precompressing with brotli would save about 5.6 MB.
- The UI terminal should be virtualised (for example xterm.js) so a 1 MiB output dump doesn't stall the DOM.
- Program-level `sleep()`/`nanosleep` spins a CPU in browser_wasi_shim's `poll_oneoff`. Override it with `Atomics.wait` on a private SAB when isolated, or with a JSPI-suspended `setTimeout`. Not yet implemented.

Sources:
- [GitHub Pages limits (docs.github.com)](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [V8: Code caching for WebAssembly developers](https://v8.dev/blog/wasm-code-caching)
- [WebAssembly features table (webassembly.org; read from raw.githubusercontent.com/WebAssembly/website/main/features.json)](https://webassembly.org/features/)
- [OpenReplay: JSPI JavaScript–Wasm bridge](https://blog.openreplay.com/jspi-javascript-wasm-bridge/)
- [Wasmer docs: COOP/COEP headers](https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers)
- [GitHub community discussion #13309: COOP/COEP headers on Pages](https://github.com/orgs/community/discussions/13309)
- [W3C TAG review #995: Document-Isolation-Policy](https://tag-github-bot.w3.org/review/995)
- [jsDelivr README (raw.githubusercontent.com/jsdelivr/jsdelivr/master/README.md)](https://github.com/jsdelivr/jsdelivr)