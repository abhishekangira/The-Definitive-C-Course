# @yowasp/clang as the in-browser C compiler: hands-on evaluation

All work was done in `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/yowasp/`. Nothing was written to the repo.

**Labels.** **[V]** means I ran it and saw the result. **[D]** means I read it in the package's code or README. **[U]** means it comes from my own knowledge and I did not check it.

## Recommendation

**Use `@yowasp/clang@22.0.0-git20542-10` as the in-browser compiler.**

- **It is real clang.** It reports itself as clang 22.1.0. It compiles and links real C17 against wasi-libc (musl-based) into `wasm32-wasip1`. We run the result with `@bjorn3/browser_wasi_shim@0.4.2`.
- **Diagnostics match native clang** byte for byte, including carets and fix-its.
- **It worked in Chromium inside a module Web Worker** with no COOP/COEP headers and no SharedArrayBuffer.
- **It is fast once loaded.** A warm compile+link of a small program takes about 100 ms in Node and 130–210 ms in Chromium.
- **The cost is the download.** The full download is 105 MB raw, about 17 MB with brotli-11. If we repack the resource tar without the C++ and other-architecture headers, it drops to about 15.2 MB with brotli. I verified that the slimmed tar still compiles everything I tested.

**The CI pipeline should run the same yowasp clang in Node** as the "browser toolchain." The output is deterministic: the same sha256 across processes [V]. That means browser output equals CI output by construction. The native gcc/clang run is then only used to find wasm32-vs-x86_64 differences.

**Three things it cannot do:**
1. **No x86-64 or arm64 assembly.** The build only registers the wasm32 and wasm64 backends.
2. **No ASan.** Neither the full nor the minimal UBSan runtime is shipped either.
3. **No interactive stdin** without extra work. Stdin is a preset buffer.

All three have workarounds, listed further down.

---

## 1. What the package contains

### Package facts
- **Versions on npm [V]:** `0.0.0`, `21.1.4-1`, `21.1.4-3`, `22.0.0-git20542-10`. The current one was published about 7 months ago.
- **Maintainers:** whitequark, fossi-foundation-escrow, binwoes.
- **No dependencies.** `@yowasp/runtime` (ISC) and nanotar 0.2.1 (MIT) are bundled into `gen/bundle.js`.
- **Exports** (`type: module`, types in `lib/api.d.ts`):
  - `runClang` and `runLLVM`.
  - A `commands` object with `clang`, `clang++`, `wasm-ld`, `ar`, `ranlib`, `nm`, `objdump`, `objcopy`, `strip`, `size`, `addr2line`, `symbolizer`, `dwarfdump`, `readobj`, `c++filt`.
  - `Exit`, which has `.code` (always 1) and `.files`.
  - `version`.
- **What `clang --version` reports [V]:**
  ```
  clang version 22.1.0 (https://codeberg.org/YoWASP/llvm-project 9560ae0f2cc440e4fc891fddbc119da6f56daa59)
  Target: wasm32-unknown-wasip1 · Thread model: posix · Build config: +assertions
  ```
- **How it is built [D]:** LLVM is built as a WASI preview-2 component. It is converted to JS with `jco transpile --instantiation async`, and WASI is provided by a virtual implementation in pure JS (`wasi-virt.js`). Everything runs synchronously. There is no SharedArrayBuffer, no threads and no JSPI.
- **How `runClang` works [D, V]:** it first runs `clang -###`, parses the printed job list, then runs cc1 and then wasm-ld. Each step is a fresh instantiation of the 75 MB module, so one compile+link is three instantiations.

### File sizes [V]
Brotli was measured with Node's zlib, window 24.

| file | raw | gzip -9 | brotli q11 | brotli q9 |
|---|---:|---:|---:|---:|
| `gen/llvm.core.wasm` | 75,532,134 | 22,657,877 | 14,640,480 (took 208 s) | 16,917,886 |
| `gen/llvm-resources.tar` (sysroot + headers) | 29,665,280 | 4,246,429 | 2,480,747 | 2,849,518 |
| `gen/bundle.js` | 253,926 | 24,884 | 18,732 | 20,409 |
| `gen/llvm.core2.wasm` | 37,626 | 13,556 | 11,656 | – |
| `gen/llvm.core3.wasm` / `core4.wasm` | 5,458 / 787 | 1,606 / 483 | – | – |
| **Slimmed tar** (no `include/c++`, libc++, CUDA/HLSL/x86/ARM intrinsics) | 3,010,560 | 956,069 | 528,067 | – |

- **Memory section of `llvm.core.wasm` [V]:** min 278 pages, max 65536, not shared. The code section is 65.8 MB and the data section 9.5 MB.

### Sysroot [V]
- **Layout inside the tar:** `include/` (clang built-in headers), `include/wasm32-wasip1/` (wasi-libc), `lib/wasm32-wasip1/` and `lib/wasm32-unknown-wasip1/`.
  - `lib/wasm32-wasip1/` contains `crt1*.o`, `libc.a` (1.05 MB), libc++/libc++abi, `libc-printscan-long-double.a`, the `libwasi-emulated-{signal,mman,process-clocks,getpid}` libraries, and 8-byte stub archives for libm, libpthread, librt and others.
  - `lib/wasm32-unknown-wasip1/` contains `libclang_rt.builtins.a` and `libclang_rt.profile.a`.
- **wasi-libc version:** `wasi/version.h` defines `__wasip1__`. There is no wasi-sdk version macro.
- **Headers:**

| Headers | Status |
|---|---|
| `stdio.h`, `stdlib.h`, `string.h`, `stdint.h`, `stdbool.h`, `math.h`, `ctype.h`, `limits.h`, `assert.h`, `time.h`, `unistd.h`, `fcntl.h`, `pthread.h`, `threads.h`, `stdatomic.h`, `complex.h`, `fenv.h`, `wchar.h`, `uchar.h`, `locale.h`, `dirent.h`, `sys/stat.h` | Present |
| `signal.h` | `#error` unless you compile with `-D_WASI_EMULATED_SIGNAL` and link `-lwasi-emulated-signal`. With both, `raise(SIGINT)` ran the handler [V]. |
| `setjmp.h` | `#error` unless `-mllvm -wasm-enable-sjlj` and an engine with wasm exception handling. |
| `sys/mman.h` | `#error` unless emulation is enabled. |
| `stdbit.h` (C23) | Missing |

---

## 2. Compiling and running in Node [V]

Flags were `-std=c17 -Wall -Wextra -pedantic -O0` unless noted. Programs ran under browser_wasi_shim. node:wasi gave the same results for exit 300, abort, stdin and `exit()`. The native comparison is gcc 13.3 / clang 18.1.3 on glibc 2.39.

| Test | wasm32 result | Native x86_64 |
|---|---|---|
| hello | Correct, 17,840-byte .wasm | – |
| printf: `%d %i %u %x %o %c %s %zu %td %ld %lld %hhd %jd PRId64 %f %e %E %g %G %a %A %n`, widths, precision | Identical to glibc | Same |
| printf with `%p` | `0xfff8`, and `0` for NULL | `0x7ffe5ab52108`, `(nil)` |
| printf of `0.0/0.0` | `nan` | `-nan` |
| printf `%Lf` **without `-lc-printscan-long-double`** | stderr prints "Support for formatting long double values is currently disabled…", then **trap `unreachable`**, and later output is lost | Works |
| printf `%.25Lf` of `1.0L/3` | `0.3333333333333333333333333` (128-bit quad) | `…3423684` (80-bit x87) |
| scanf `"%d %d"`, `%31s`, fgets, getchar to EOF, scanf at EOF | All correct; `scanf` at EOF returns -1 | Same |
| malloc / realloc / calloc / strdup / free | Correct; calloc returns zeroed memory | Same |
| `malloc(3 GiB)` | NULL. A loop of 1 MiB mallocs got **4094 MiB** before failing, with memory grown to 65520 pages. With `-Wl,--max-memory=268435456` it stopped at 255 MiB. | – |
| Compile error (`err.c`) | `err.c:4:14: error: expected ';' at end of declaration`, then caret and fix-it `;`, then `1 error generated.` | Byte-identical with clang 18 |
| Warnings (`warn.c`) | The same 6 warnings as clang 18, plus one wasm32-only warning: `implicit conversion from 'long long' to 'long' changes value from 1234567890123 to 1912276171 [-Wconstant-conversion]` | – |
| `-fcolor-diagnostics` / `-fdiagnostics-color=always` | ANSI colour escape codes | – |
| `-fno-caret-diagnostics`, `-fno-show-column`, `-fdiagnostics-parseable-fixits`, `-fdiagnostics-format=sarif -Wno-sarif-format-unstable` | All work. SARIF gives JSON (`uri: file:///err.c`, line and column) that maps directly to editor markers. | – |
| `math.h` (sqrt, pow, sin, tgamma, erf, …) | Works **with or without `-lm`** (libm is a stub; the math is in libc) | gcc fails to link without `-lm` |
| `M_PI` under `-std=c17` | Undeclared | Undeclared (same) |
| `return 3` / `exit(42)` | 3 / 42, and `exit` flushes stdout | Same |
| `return 300` | 300 | The shell sees 44 |
| `abort()` | `RuntimeError: unreachable`, no message | SIGABRT, "Aborted", exit 134 |
| Failed `assert` | stderr `Assertion failed: x == 3 (assert.c: main: 3)`, then trap | `prog: assert.c:3: main: Assertion 'x == 3' failed.`, exit 134 |
| Integer `/0` | `RuntimeError: divide by zero` | SIGFPE. gcc folded `1/x` and printed 0. |
| `INT_MIN / -1` | `RuntimeError: divide result unrepresentable` | SIGFPE, 136 |
| Float `/0` | `inf` | `inf` |
| Stack out-of-bounds write `buf[4..8]` | **Silently clobbered** the neighbouring local (0x1234 became 0xbad) | Neighbour intact; segfault later |
| `strcpy` overflow of `char buf[8]` | **Overwrote a string literal.** Read-only data is writable and sits directly above the stack, so `puts("returned normally")` printed `an eight bytes`. | `*** stack smashing detected ***` |
| `-fstack-protector-strong` | Links (libc.a has `__stack_chk_fail`); detects the overflow and traps `unreachable`, no message | Message, exit 134 |
| Heap overflow, then free | No detection (dlmalloc) | No detection without ASan |
| Read past current memory size | `RuntimeError: memory access out of bounds` | SIGSEGV |
| **Read `*NULL`** | **Returns 0, no trap** | SIGSEGV |
| **Write `*NULL = 1234`** | **Succeeds; reading it back gives 1234** | – |
| `s->b[50]` with `s == NULL` | 0 | – |
| Call through NULL function pointer | `RuntimeError: null function or function signature mismatch` | SIGSEGV |
| Uninitialised local | 0 on fresh memory. 88 (stale data from a previous call) after a helper ran. Deterministic. | Garbage such as 32537, varies per run |
| Reused malloc block | Old contents visible (85 = 0x55) | Garbage |
| Stack overflow with default 64 KiB stack | About 200 frames of 288 B, then `memory access out of bounds`. The stack is first in memory: `&local=0xfff8`, `__global_base=0x10000`. | – |
| Stack overflow with `-Wl,-z,stack-size=8388608` | About 11,000 frames, then V8 `RangeError: Maximum call stack size exceeded` (engine stack limit hit first) | 8 MiB stack: more than 27,000 frames, then SIGSEGV |
| Infinite recursion `f(n){return f(n+1)+1;}` at `-O2` | Becomes an **infinite loop** (`loop; br 0`) | Same (`jmp .LBB0_1`) |
| Infinite loop | Running in a `worker_threads` Worker and calling `terminate()` after 2 s worked. In the browser, use `Worker.terminate()`. | – |
| `time()`, `timespec_get` | Work | – |
| `clock_gettime` | Needs `_POSIX_C_SOURCE`, as on native | Same |
| `localtime` | Always UTC | – |
| `clock()` | Link error unless `-D_WASI_EMULATED_PROCESS_CLOCKS -lwasi-emulated-process-clocks`. Then `CLOCKS_PER_SEC = 1000000000`. | 1000000 |
| File I/O (fopen/fgets/fwrite, `perror`) through the shim's `PreopenDirectory` | Works. Written files can be read back from JS (`deadbeef`). The ENOENT message matches glibc. | – |
| stdout buffering | Under the shim `isatty(1)=1`, so stdout is line-buffered and the stdout/stderr ordering matches native **under a pty** | When piped, native is fully buffered and the ordering differs |
| C23 (`-std=c23`: `constexpr`, `auto`, `typeof`, `nullptr`, digit separators) | Works. The default standard is gnu17 (`201710L`). | – |
| libcs50 (`cs50.c`/`cs50.h` from raw.githubusercontent, `main` branch) | Compiles; `get_string` and `get_int` work with preset stdin, and `get_int` re-prompts on "abc" | – |

---

## 3. sizeof and the wasm32 vs native 64-bit differences [V]

| type | wasm32 size/align | x86_64 size/align |
|---|---|---|
| char / short / int | 1/1, 2/2, 4/4 | same |
| **long** | **4/4** | 8/8 |
| long long | 8/8 | 8/8 |
| **void\*, size_t, ptrdiff_t, intptr_t** | **4/4** | 8/8 |
| float / double | 4/4, 8/8 | same |
| long double | 16/16, but **IEEE quad** (LDBL_MANT_DIG 113, LDBL_DIG 33) | 16/16, x87 80-bit (64, 18) |
| bool / wchar_t / time_t / intmax_t / max_align_t | 1, 4, 8, 8, 32 (align 16) | same |
| `struct {char; long; char}` | **12/4** (offsets 4, 8) | 24/8 (offsets 8, 16) |
| `struct {char*; char}` | **8/4** | 16/8 |
| `{char; int}`, `{char; double}`, `{char; long double}`, `{char; short; char; long long}`, union, bitfields, flexible array member | identical | identical |
| Limits | `LONG_MAX=2147483647`, `SIZE_MAX=4294967295`, `PTRDIFF_MAX=2147483647` | 64-bit values |

Plain `char` is signed and both targets are little-endian. `__wasm__` and `__wasi__` are defined. `__STDC_IEC_559__` is **not** defined on wasm.

**Every category of output difference found** (the pipeline must normalise these or teach them):
1. **Type sizes and limits** as in the table. A side effect is extra or different `-Wformat`/`-Wconstant-conversion` warnings, since `long` is 32-bit.
2. **`%p`.** Small, **deterministic** addresses with no ASLR (`&local=0xfff8`, globals `0x10a64`, heap `0x11120`, identical across runs). **A function pointer prints as a table index (`0x1`)**, not a code address. NULL prints as `0`, not `(nil)`.
3. **NaN sign:** `nan` vs `-nan`.
4. **long double:** quad vs x87 precision. Formatting it also needs the `-lc-printscan-long-double` link flag.
5. **rand():** musl's sequence differs completely. **The first `rand()` without `srand` is 0.** `srand(42)` gives `311430560 131117839…` vs glibc's `71876166 708592740…`. `RAND_MAX` is the same. Never use libc `rand()` output as a prediction answer; ship our own PRNG, or label it.
6. **qsort stability:** musl was unstable on the test input (stable=0); glibc 2.39 was stable on the same input.
7. **Crash behaviour:** wasm traps instead of signals, and messages differ (assert format, no "Aborted"/"Segmentation fault" text, exit 300 vs 44). **NULL reads and writes do not trap.**
8. **Memory layout:** stack first, 64 KiB default stack, writable read-only data right above the stack. Stack smashing therefore corrupts string literals or globals instead of return addresses.
9. **Uninitialised values:** deterministic zeros or stale data instead of varying garbage.
10. **Time:** `CLOCKS_PER_SEC` is 1e9, `clock()` needs emulation, local time is always UTC.
11. **Recursion depth:** the stack size must be set; the engine stack limit is hit at about 11k frames even with an 8 MiB shadow stack.
12. **Buffering:** wasm stdout reports as a tty, so run native samples under a pty (`script -qc ./prog /dev/null`, then strip `\r`).
13. **Linking:** `-lm` is optional on wasm but required on native gcc.
14. **Diagnostics:** the compiler versions differ (clang 22 vs native clang 18 vs gcc 13). Wording and identical text were the same on the tests I ran, but gcc's text is entirely different.
15. **Malloc failure point:** about 4 GiB on wasm unless capped. Allocation patterns also differ.

---

## 4. Latency and memory [V]

Measured in Node 22.22.0 on the 4-CPU container (`scripts/bench.mjs`).

**Cold start:**
- Prefetch (read 105 MB, `WebAssembly.compile` of 75 MB, untar 29 MB): **463–477 ms** in two runs, and 1033–1061 ms in a later run.
- First compile+link of hello: **359–417 ms.** V8 compiles wasm functions lazily, so the first use pays extra.

**Warm compile+link, median of 5:**

| program | -O0 | -O1 | -O2 |
|---|---:|---:|---:|
| hello | 100 ms | 101 ms | 97 ms |
| printf | 93 ms | 105 ms | 124 ms |
| malloc | 96 ms | 108 ms | 124 ms |
| sizeof | 109 ms | 117 ms | 131 ms |

**Other steps:**
- `-fsyntax-only`: 45 ms. Fast enough for debounced lint-as-you-type in a worker.
- `-c` only: 52 ms.
- The `-###` driver step alone: 21 ms. A bare instantiation: 17 ms.
- Synchronous API (`synchronously: true`): about 160 ms.
- A 406-line, 47 KB generated program: -O0 0.8–1.5 s, -O2 1.9–2.1 s warm. Native clang-18 -O2 took 1.13 s.

**Memory:**
- RSS was 470 MiB right after prefetch, with ArrayBuffers at 173 MiB.
- Over 150 consecutive compiles it stayed flat at 349–390 MiB, so there is no leak.
- The slimmed tar saved about 45 MiB of RSS.

---

## 5. Browser use [V unless marked]

**Test setup.** Playwright Chromium (build 1194, headless), a local static server, files copied from `gen/`, a module Web Worker that does `await import('./clang/bundle.js')` lazily, and the shim to run the program. Sources are in `web/site/worker.js` and `web/pwtest.cjs`.

**Results:**
- **No isolation needed:** `crossOriginIsolated=false` and `typeof SharedArrayBuffer === 'undefined'`, and everything worked.
- **Lazy loading works.** Before the first Run, no compiler files were requested. On first Run it fetched `bundle.js`, `llvm.core.wasm`, `llvm-resources.tar` and `core2`–`core4`.
- **How it fetches [D]:** `fetch(new URL("./x", import.meta.url))`, with wasm compiled via `WebAssembly.compileStreaming`. **The server must send `Content-Type: application/wasm`.**
- **Timings on loopback:**
  - Import: 8–60 ms.
  - Prefetch: 1034 ms uncompressed, 673–773 ms brotli-served.
  - First compile: 405–496 ms. Warm compile: 128–213 ms.
- **Brotli serving works.** `Content-Encoding: br` sent 16.9 MB for the core wasm.
- **The main thread also works** with the async API. The worker's instance is not shared, so it downloaded everything again (1613 ms total).
- **Caching:**
  - **HTTP cache:** with `Cache-Control: public, max-age=31536000, immutable` and a **persistent profile**, a reload made **zero requests**; prefetch was then 728–734 ms. An ephemeral/incognito context re-downloaded the 75 MB file.
  - **Cache API:** patch `globalThis.fetch` **before** importing `bundle.js`, because the runtime captures `globalThis.fetch` when the module loads. After a reload, every asset came from cache and there were no network requests (prefetch 798 ms; usage 105 MB of a 1 GB quota). **Do not `await cache.put()` inside the patched fetch.** Waiting on it pushed the first load to 3.8 s.
  - The same fetch hook can rebuild **split files**, which helps on hosts with a per-file size limit (I believe Cloudflare Pages caps files at 25 MiB [U]) or with git LFS.
- **Vite 7.3.7:**
  - `vite build` turned `new URL(..., import.meta.url)` into hashed assets automatically, which suits immutable caching.
  - `core4` (787 B) was inlined as a data URI.
  - The compiler is a lazy chunk of 113,859 bytes.
  - A harmless warning: "node:fs/promises externalized".
  - The dev server works with `optimizeDeps: { exclude: ['@yowasp/clang'] }` and `worker: { format: 'es' }`. Both build and dev compiled and ran in Chromium.
- **Wasm features:**
  - User programs need: bulk-memory, extended-const, multivalue, mutable-globals, nontrapping-fptoint, reference-types, sign-ext, call-indirect-overlong.
  - These come from libc.a, so `-mcpu=mvp` does not remove them.
  - Fine in current Chrome and Firefox. Safari support for extended-const and support for clang.wasm itself are **[U]**: only Chromium was available here.
- **Licensing:**
  - `package.json` says **ISC**, but the README says Apache-2 "LICENSE.txt", and **no license file is shipped** in the tarball [V].
  - LLVM/clang/lld/libc++ are Apache-2.0 WITH LLVM-exception. wasi-libc is Apache-2.0 WITH LLVM-exception / Apache-2.0 / MIT, including musl's MIT [U]. `@yowasp/runtime` is ISC [V]. browser_wasi_shim is MIT OR Apache-2.0 [V]. nanotar is MIT [V].
  - If we self-host, we should ship a NOTICE page with the LLVM and wasi-libc texts.
  - **libcs50 is ambiguous:** the `cs50.c` header says BSD-3-Clause but the repo's `LICENSE` file is GPL-3.0 [V]. Safer to write our own small compatible header.

---

## 6. Sanitizers, assembly, targets [V]

**Sanitizers:**
- `-fsanitize=address`: instrumentation compiles, but linking fails (`undefined symbol: __asan_report_load4`, `__asan_init`, …). **No ASan runtime.**
- `-fsanitize=undefined`, with or without `-fsanitize-minimal-runtime`: linking fails on the missing `__ubsan_handle_*` symbols.
- `-fsanitize=undefined -fsanitize-trap=undefined`, and `-fsanitize=signed-integer-overflow,shift,bounds -fsanitize-trap=all`: work, and trap as `RuntimeError: unreachable` with no message.
- `-fsanitize=memory` and `safe-stack`: "unsupported option for target".
- **A UBSan runtime of our own works.** I wrote a 60-line `c/ubsan_rt.c`, compiled it once and linked it in. It produces native-format messages, for example:
  ```
  ub2.c:7:41: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
  ub2.c:9:35: runtime error: shift exponent 32 is too large for 32-bit type 'int'
  ub2.c:12:29: runtime error: index 4 out of bounds for type 'int[4]'
  ub2.c:17:30: runtime error: member access within null pointer of type 'struct P'
  ub2.c:18:33: runtime error: division by zero
  ```
  These match gcc's libubsan wording. That gives UBSan in the browser, and it even catches NULL dereferences that wasm itself does not trap.
- **Native side:** the container's clang 18 has **no** sanitizer runtimes (`libclang_rt.ubsan_standalone-x86_64.a` missing). gcc's `-fsanitize=address,undefined` does work, so the native ASan stage should use gcc or a full LLVM install.

**Assembly and IR:**
- `-S` gives readable WebAssembly assembly (`local.get`, `i32.mul`, …). `-S -emit-llvm` gives LLVM IR.
- `runLLVM(['objdump','-d','-l','a.o'])` gives a disassembly annotated with source lines.
- `clang -print-targets` lists **only `wasm32` and `wasm64`.**
- `-target x86_64-linux-gnu -S` fails with `unable to create target: 'No available targets are compatible with triple "x86_64-unknown-linux-gnu"'`. **An in-browser x86-64/arm64 assembly view is not possible with this package.**
- What does work for x86_64 is the front end only: `-target x86_64-linux-gnu -S -emit-llvm` produced x86_64 IR (`i64` long, `f80`). Using `-fsyntax-only -target x86_64-linux-gnu -isystem /usr/include/wasm32-wasip1 -D__wasi__` reproduced native clang's 6 warnings for `warn.c` exactly. With wasi headers it gives false `-Wformat` warnings because the `int64_t`/`SIZE_MAX` typedefs are wasm32's, so a small x86_64 musl header set would be needed. This is experimental.
- **Recommendation for real assembly:** generate x86-64/arm64 assembly for course samples at build time with native compilers. For code the learner edits, show wasm assembly or LLVM IR.

**Mapping a crash to a source line:**
- Compile with `-g`. V8's stack gives entries like `a.wasm.divide (…wasm-function[10]:0x2b5)`.
- Subtract the CODE section offset (0x1d2 here, from `objdump -h`) and pass it to `runLLVM(['symbolizer','--obj=a.wasm',…])`.
- The result was `/crash.c:4:14`: the exact column of `/`, and `main` at `10:12`.
- That is enough for a crash report like "Floating point exception at crash.c:4:14 in divide()".

---

## 7. Multi-file programs [V] (`scripts/multi.mjs`)

Files are passed as a nested tree, and the returned tree contains every output file:
```js
const tree = { 'main.c': s1, 'vec.h': s2, 'vec.c': s3, util: { 'strutil.h': s4, 'strutil.c': s5 } };
await runClang(['clang','-std=c17','-Wall','main.c','vec.c','util/strutil.c','-o','prog.wasm'], tree); // 537 ms one-shot
// make-style: each '-c x.c -o x.o' adds x.o to the returned tree; then link: ['clang','main.o','vec.o','util/strutil.o','-o','prog.wasm'] (55 ms)
// static library: runLLVM(['ar','rcs','libvec.a','vec.o','util/strutil.o'], files) then ['clang','main.o','-L.','-lvec',...]  — works
```
An error in a nested file reports its path, for example `util/strutil.c:3:54: error: call to undeclared function 'to_upper'… did you mean 'toupper'?`, with a note pointing to `/usr/include/wasm32-wasip1/ctype.h:23:7`.

---

## Recommended flags
```
-std=c17 -Wall -Wextra -pedantic -O0 -g -lm -lc-printscan-long-double
-Wl,-z,stack-size=1048576        # default is 64 KiB (~200 frames); 8 MiB hits the V8 engine stack limit at ~11k frames
-Wl,--max-memory=268435456       # otherwise a malloc loop grows memory to ~4 GiB
[-D_WASI_EMULATED_SIGNAL -lwasi-emulated-signal] [-D_WASI_EMULATED_PROCESS_CLOCKS -lwasi-emulated-process-clocks]
[-fdiagnostics-format=sarif -Wno-sarif-format-unstable | -fcolor-diagnostics]
```

## Quirks to work around [V]
1. **`runClang` drops `fetchProgress` on its first internal step** (the `-###` call), so the default logger floods the console with "yowasp-llvm: fetched N%". Call `await runClang(null, {}, { fetchProgress })` once to prefetch.
2. **`new WASI(args, env, fds)` without a 4th argument turns on the shim's debug logging** (`debug.enable(undefined)` means on). Always pass `{ debug: false }`.
3. **Always pass `decodeASCII: false`,** or output files that happen to be pure text come back as strings.
4. **`Exit.code` is always 1.**
5. **`-print-*` options also print the version banner,** because of how the wrapper parses `-###` output.
6. **The hard-coded `totalSize` for progress (105,241,285) is wrong once the tar is slimmed.** Patch it or compute progress yourself.

## Risks
- **First-use download:** about 17 MB brotli, 27 MB gzip, 105 MB uncompressed, plus 1–4 s on a fast connection. Mitigate with self-hosting, brotli, immutable hashed URLs, a Cache API or service worker, and a progress bar.
- **Memory:** about 400 MB of process memory while the compiler is loaded [V Node]. This may be a problem on low-end mobile devices [U]. Terminate the worker when idle.
- **Young, single-maintainer-led package:** 4 releases; the current one is an LLVM snapshot built with assertions on. Pin the exact version and vendor the files.
- **Semantic gaps for the course:** no ASan, no traps on NULL, writable literals, 32-bit `long` and pointers. Teach these explicitly and use native outputs (stored at build time) as the reference for any 64-bit-specific prediction answer.
- **Interactive stdin is not supported out of the box.** Preset stdin works [V]; echoing consumed input into the transcript would make it look like a terminal. True interactivity needs SharedArrayBuffer plus `Atomics.wait`, which needs COOP/COEP headers (or a coi-serviceworker on hosts that cannot set headers), a service-worker sync-XHR bridge, or JSPI [all U].
- **Firefox and Safari are untested;** only Chromium was available here.

## Working minimal Node script [V]
`scripts/minimal.mjs` prints `{ compiled: true, stdout: 'hello, Ada! sizeof(void*)=4\n…', exitCode: 7, trap: null }`. The same code works in a module Web Worker.
```js
// npm i @yowasp/clang@22.0.0-git20542-10 @bjorn3/browser_wasi_shim@0.4.2
import { runClang, Exit } from '@yowasp/clang';
import { WASI, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';

const FLAGS = ['-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0', '-g', '-lm', '-lc-printscan-long-double',
  '-Wl,-z,stack-size=1048576', '-Wl,--max-memory=268435456'];

export async function compileAndRun(source, stdin = '') {
  const dec = new TextDecoder();
  let diagnostics = '';
  const sink = (b) => { if (b) diagnostics += dec.decode(b, { stream: true }); };
  await runClang(null, {}, { fetchProgress: () => {} });           // prefetch; silences default logger
  let files;
  try {
    files = await runClang(['clang', ...FLAGS, 'main.c', '-o', 'main.wasm'], { 'main.c': source },
                           { stdout: sink, stderr: sink, decodeASCII: false });
  } catch (e) { if (e instanceof Exit) return { compiled: false, diagnostics }; throw e; }
  let stdout = '', stderr = '';
  const wasi = new WASI(['main'], [], [
    new OpenFile(new File(new TextEncoder().encode(stdin))),
    new ConsoleStdout((b) => { stdout += dec.decode(b, { stream: true }); }),
    new ConsoleStdout((b) => { stderr += dec.decode(b, { stream: true }); }),
  ], { debug: false });
  const { instance } = await WebAssembly.instantiate(files['main.wasm'], { wasi_snapshot_preview1: wasi.wasiImport });
  let exitCode = null, trap = null;
  try { exitCode = wasi.start(instance); } catch (e) { trap = e.message; }  // 'unreachable' | 'divide by zero' | ...
  return { compiled: true, diagnostics, stdout, stderr, exitCode, trap };
}
console.log(await compileAndRun('#include <stdio.h>\nint main(void){ int n; scanf("%d",&n); printf("%d\\n", n*2); return 0; }', '21\n'));
```

Everything is in `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/yowasp/`. The ones to open first:
- `scripts/minimal.mjs` — the compile-and-run example above
- `scripts/lib.mjs` — compile/run helpers
- `c/ubsan_rt.c` — the UBSan runtime
- `web/site/worker2.js` — Web Worker with the Cache API fetch hook
- `vitetest/` — Vite 7 setup
- `slim/gen/llvm-resources.tar` — the 3 MB C-only sysroot

Other scripts:
- `scripts/runall.mjs` — runs the test programs
- `scripts/bench.mjs` — latency benchmark
- `scripts/symbolize.mjs` — crash-to-source-line mapping
- `scripts/multi.mjs` — multi-file builds
- `scripts/packslim.mjs` — repacks the slimmed tar

Test programs are in `c/` (`c/multi/` for the multi-file example) and native builds are in `native/`.