I found 26 problems in §0–§4, §7 and §11. Most of the serious ones I reproduced with the pinned @yowasp/clang in Node, native gcc 13 / clang 18, or a curl / yt-dlp call. Test files are in /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/review/, and no repo files were edited. "Checked" means I ran it here. "Reasoned" means I did not run it.

## High severity

**1. §1.2 / §2.3: guardrail mode fails to link ordinary code, and it keeps running after errors.**
- **Checked (ub_all.c, ub_common.c, nd.c):** with `-fsanitize=undefined` + `ubsan_rt.c`, `int r = (int)avg;` fails to link (`undefined symbol: __ubsan_handle_float_cast_overflow`).
  - VLAs, `__builtin_clz` and `bool` loads also fail: `vla_bound_not_positive`, `invalid_builtin`, `load_invalid_value` are missing.
- **Checked:** the handlers return and carry on. One overflow plus a NULL write gave 5 reports, the NULL write succeeded, and the program printed `after null write: 42`.
  - The native verifier uses `-fno-sanitize-recover=all` and stops at the first error (gcc: one report, exit 1).
  - Adding `-fno-sanitize-recover` in the browser fails to link, because no `*_abort` handlers exist.
- **Why it matters:** learners get linker errors unrelated to their code, and browser guardrail output can't match the stored native UBSan answers that §5 uses.
- **Fix:**
  - Implement every handler in the `undefined` group, plus the `_abort` variants. Each should flush stdout, print, then `_Exit(1)` or trap.
  - Compile guardrail with `-fno-sanitize-recover=all`.
  - Add a CI test that links a program exercising every check.
  - Add a `guardrail` fence key so `tools/verify` stores that mode's output.
  - Compare runtime-error reports by (line, kind), not column. gcc reports `7:9`, clang `7:15`.

**2. §1.2 / §2.3 stack size, §3.1 step 4, lesson 4.3: recursion-limit results depend on the browser engine, and CI measures the wrong engine.**
- With an 8 MiB stack, small frames hit the JS engine's stack limit before the wasm stack runs out.
- **Checked in Node 22:** tiny frames reached about 15,500 levels, then `RangeError`. 1 KB frames reached 8,000, then `memory access out of bounds`.
- runtime-browser.md gives Chromium about 5,770 levels without JSPI and about 10,900 with it. So Chromium without JSPI very likely throws `RangeError` near 5.8k even for 1 KB frames (reasoned).
- **Why it matters:** the "browser" result §3.1 stores from Node isn't what learners see. It also changes with JSPI support. Lesson 4.3's "PR [both] depth limits" answers would be wrong. And the M4 analogy row ("the limit is bytes, not frames") is contradicted by the `RangeError` learners will actually see.
- **Fix:** choose one of:
  - set stack-size to 1 MiB (toolchain-yowasp.md's recommendation);
  - or require overflow demos to use frames of at least 4 KB.

  In either case:
  - never print depth counts;
  - always run under `WebAssembly.promising` when JSPI exists;
  - map both `RangeError` and the out-of-bounds trap to "stack overflow";
  - record depth-sensitive samples in Playwright Chromium, not Node.

**3. §3.1 steps 2/4/6, §3.2, §0 "byte-identical diagnostics": the browser compile is never checked for warnings, and the native compilers disagree.**
- **Checked:** these compile clean with gcc 13 and clang 18, but warn in the browser's clang 22:
  - `long big = 3000000000;` (`-Wconstant-conversion`);
  - `printf("%ld", int64_t)` (`-Wformat`);
  - `char s[5] = "hello";` (`-Wunterminated-string-initialization`, which is new in clang 22).
- §3.1 only adds `-Werror` natively, and §3.2 only compares output. The spec's "everything compiles cleanly" isn't enforced for what the learner actually compiles.
- **Checked:** gcc and clang diagnostics differ on core samples:
  - gcc -O0 says nothing for the "used uninitialised when `if` is false" case, which clang flags;
  - `0b101`: gcc gives no flag, clang 18 gives `-Wgnu-binary-literal`, clang 22 gives `-Wc23-extensions`.

  So "gcc and clang must agree", if it includes (line, severity, flag), can't be met.
- **Fix:**
  - Treat browser-compile diagnostics as part of the result: zero warnings unless `expect=warning`.
  - Allow expectations per compiler (`expect.gcc=`, `warn.clang=`).
  - Pin native clang to 22 (apt.llvm.org), as toolchain-alternatives.md recommends.
  - Scope the §0 "byte-identical" claim to clang 22.

**4. §3.3 traces, §2.4, M1.4 / M4.3 / M5 MD/SP items, V3 / V4 / V10: the stepper shows a different machine from the one the learner is using.**
- Traces come from x86-64 gdb on glibc: 8-byte pointers, `0x7ffc…` stack addresses, heap above code, return values read from `$rax`.
- Lessons M1–M5 run wasm32: 4-byte pointers, stack at `0x7ffff8`, below globals.
- Diagrams and stepper predictions will contradict what learners see with `%p` and `sizeof`. Lesson 5.5's "native vs wasm32 layout order" has no wasm32 trace at all.
- Nothing says what happens when a learner edits a `trace` sample.
- The source of the arm64 register traces in V10 is unspecified, and the tracer is x86-only.
- **Fix:**
  - Label every trace view "64-bit Linux".
  - Ban size and address questions in MD/SP items unless platform-tagged.
  - Mark the stepper stale on edit, using the same check as §3.2.
  - Generate arm64 traces on a macOS (lldb) or ubuntu-24.04-arm (gdb) runner.
  - State which platform's values the animations show (§8 note).

**5. §2.4 / §4.2 unit-test harnesses: renaming `main` breaks valid learner code, and multi-file projects can't be tested.**
- **Checked (learner.c, harness*.c):**
  - With `-Dmain=learner_main`, C's implicit `return 0` is lost. Valid C17 that ends `main` without `return` gets `-Wreturn-type`; gcc with `-Werror` makes it an error, and the harness reads a junk return value (6 in my run).
  - A harness prototype `int learner_main(void)` won't compile against `main(int, char**)`.
  - One `runClang` call applies `-D` to every file, renaming the harness's own `main` too.
- §2.4 says `-Dmain`, but the check.mjs prototype uses `#define main` + `#include LEARNER_SRC` of `sources[0]` only. It also builds with its own flags and ignores the project Makefile.
  - So M6+ multi-file projects can't be tested as designed: P8's "unit tests for each module", P11's `make -n` dependency check, and .so/.dylib builds.
- **Fix:**
  - Use one harness scheme in both runners: `#pragma GCC diagnostic ignored "-Wreturn-type"` around the include, never trust the return value, and no prototype for `learner_main`.
  - Run the clean-build test on the unmodified sources.
  - For multi-file projects, have check.mjs drive `make` targets from check.json, and rename `main` only in the file that defines it.

**6. §1.2 / §2.3 `-include leakcheck.h`: the macro design gives false reports and can corrupt the heap.**
- **Checked (a.c + b.c):** its state is `static` in each file, so freeing in another file reports `INVALID FREE` plus a false `LEAK`. This affects P5 and any harness compiled separately.
- **Checked (fp.c):** passing `free` as a function pointer skips the macro, so the real `free` gets an offset pointer. That is heap corruption, and it reported 3 false leaks.
- It always prints a summary line to stderr, which pollutes stderr assertions.
- **Checked:** wasm-ld supports `-Wl,--wrap=malloc`.
- **Fix:** replace it with a linked `leakcheck.c`: one global table using `--wrap` for malloc/calloc/realloc/free, like the native `heap_shim`. Report only when errors exist, or through a separate channel.

**7. §2.2 vs §4.7: the routing and base-path settings contradict each other.**
- §4.7 says "relative base path"; §2.2 uses React Router with a `404.html` copy of `index.html`.
- With Vite `base:'./'`, the 404 fallback at `/repo/m/x/y` loads `./assets/*.js` relative to `/repo/m/x/`, which gives a blank page.
- The prototype's toolchain URL (`BASE_URL` resolved against the origin) would also point to the site root on project pages (reasoned).
- **Fix:** choose one:
  - an absolute `--base=/the-definitive-c-course/` plus `404.html`;
  - or HashRouter with a relative base. This also works under plain static servers, which fits the spec's "works locally".

  Then add an e2e deep-link test against a Pages-like server, not `vite preview`.

**8. §0 Hosting: "the whole site works offline after the first visit" is false as designed.**
- Only the toolchain goes into Cache Storage. Pages sends `max-age=600`, and there is no service worker, so after 10 minutes offline navigation fails (reasoned).
- **Fix:** add a service worker (for example Workbox) that precaches the app shell, content and generated JSON and caches animations as they are viewed. Otherwise drop the claim.

## Medium severity

**9. §3.1 step 5: the normaliser causes false platform flags.**
- **Checked (nullp.c):** musl prints a NULL `%p` as `0`, so native `p=<NULL>` vs wasm `p=0` gets flagged. The prototype's comment saying musl prints `0x0` is wrong.
- Function pointers print `0x1`.
- The default mode also turns any 5+-digit hex output, such as `%#x` of `0xdeadbeef` in M2, into `<addrN>`, which corrupts the stored answer.
- **Fix:** only normalise when the source uses `%p`; treat `0`, `(nil)` and `0x0` as the same token on `%p` lines; default to `norm=none` otherwise.

**10. §3.2: the "derivable 64-bit value" detection and the browser half of the verifier are only designed, not prototyped.**
- `toolchains.mjs` holds only a comment for `wasm-clang`.
- "Tags diff lines from known patterns" can't tell from output alone whether `8` is a `sizeof`.
- The edit check hashes only the source; changing stdin, args or guardrail mode also makes the stored 64-bit output wrong.
- **Fix:**
  - Every flagged sample must declare `predict64=<spec>` or `predict64=none reason=…`; lint fails otherwise.
  - Use pattern heuristics only to suggest a value to the author.
  - Hash (source + stdin + args + mode).
  - Build the browser half in Node, with browser_wasi_shim rather than node:wasi.

**11. §1.2, §3.2, §3.3, V2, M10: arm64 output can't be produced as planned.**
- **Checked (sq.c):** `clang -target aarch64-linux-gnu` and `-target arm64-apple-macos` both fail on `#include <stdio.h>` (no target sysroot).
  - aarch64-linux needs `libc6-dev-arm64-cross`.
  - The Apple SDK can't legally be used on Linux, so Apple listings and outputs must come from the macOS runner.
- The macOS job re-runs only `platform` samples, so differences that exist only between Linux and macOS are missed.
- aarch64-Linux `char` signedness needs an arm64 Linux runner; macOS arm64 `char` is signed.
- How macOS-generated outputs get into the committed `src/generated/` (which "CI fails if stale") isn't specified. Each module's done-check therefore needs a push and a CI round trip.
- **Fix:**
  - Run all samples on macOS and on ubuntu-24.04-arm.
  - Keep their outputs in `src/generated/{macos,arm64}/`, filled by a fetch-artifacts script or a bot commit, and excluded from the Linux staleness check.
  - Note that private repos pay 10× for macOS minutes (ties to §12 Q1).

**12. §2.5 / §4.1: the completion token can't be computed as specified, and "hidden" tests aren't hidden.**
- Downloads are built once for everyone, so check.mjs can't know the learner's seed. Nothing says how it gets it, for example `make test SEED=…` or a `.learner` file pasted from the app.
- Tokens aren't prototyped. The app needs a list of accepted runner versions.
- There's no shared implementation or test vectors between check.mjs and `src/progress`.
- The "hidden harness" in P4 ships inside the static bundle, so anyone can read it.
- **Fix:** define the seed hand-off, use one shared token module with fixed test vectors in both test suites, and call those tests "not shown by default".

**13. §3.1 step 3: running native samples under a pty isn't prototyped, and the details matter.**
- `verify.mjs` uses `spawnSync` with pipes.
- **Checked:** native `deep.c` with piped stdout lost all output on SIGSEGV; under a pty it would print.
- A pty on stdin echoes input and applies line editing (including EOF handling). One pty for both streams merges stdout and stderr, and the output has `\r`.
- **Fix:** stdin as a pipe; stdout on a pty, plus stderr on a pty or merged in arrival order on both sides; strip `\r`.

**14. §4.6 / §12 Q2: the animation size estimate leaves out WebM.**
- hyperframes.md measured WebM at about 2.1× the MP4 size (486 KB vs 227 KB) and 65 s to render vs 17.7 s.
- For 23 clips averaging about 62 s, that is roughly 100–130 MB committed, not 40–60 MB. Every re-render also grows git history permanently.
- **Fix:** transcode WebM from the master with ffmpeg (no alpha) instead of a second browser render. Or drop WebM and run video e2e with Playwright's branded Chrome, which plays H.264. Re-estimate, and offer Git LFS or render-in-CI in §12.

**15. §2.2 / §2.5 / §2.3: browser storage and memory assumptions don't hold everywhere.**
- Safari's tracking prevention deletes script-written storage (localStorage, Cache Storage) after 7 days without a visit. A self-paced learner can lose all progress and the 78 MB toolchain cache.
- All `*.github.io/<repo>` sites share one origin, so localStorage keys and cache names need a namespace.
- `navigator.deviceMemory` doesn't exist in Safari or Firefox, so "low memory" detection fails exactly on iOS.
- **Fix:**
  - Prompt for export and show "last exported N days ago".
  - Use namespaced keys like `c-course:v1:`.
  - Detect low memory by catching compile or instantiate failures and falling back to stored output, plus a manual toggle.

**16. §2.3: toolchain chunking is unverified.**
- **Checked (cs.mjs):** `compileStreaming` on a re-joined `Response` throws `TypeError … MIME type 'null'` unless `Content-Type: application/wasm` is set.
- A built `Response` has `url === ""`, which likely defeats V8's wasm code cache (reasoned).
- The "0.32 s warm, 0 requests" figure was measured without chunks.
- **Checked:** GitHub Pages already gzips large octet-stream files (binji's clang came gzip-encoded) and has no 25 MiB per-file limit.
- **Fix:** stream-join chunks with the correct `Content-Type`, `cache.put` under the canonical URL, then re-measure warm load in Playwright. Or chunk only for Cloudflare.

**17. §1.1 / §2.3 / §12 Q1: download sizes are misquoted.**
- "≈17 MB brotli" uses the full sysroot at brotli q11, while "≈24 MB gzip" already uses the slimmed one. "Saves a further ≈2 MB" applies only to the brotli figure.
- Consistent figures:

  | Sysroot | brotli q11 | gzip |
  |---|---|---|
  | Full | ≈17.2 MB | ≈27 MB |
  | Slim | ≈15.2 MB | ≈23.7 MB |

- Hosts that compress on the fly don't use q11.
- §2.2 marks "virtualized terminal [V]", but runtime-browser.md lists it as not done.
- **Fix:** restate the numbers so §12 Q1 is decided on correct data.

**18. §3.5 step 5 / §4.5: `videos:check` with yt-dlp will be flaky in GitHub Actions.**
- YouTube bot-checks data-centre IPs; research needed a client workaround and saw 429s.
- **Fix:** commit transcript files, have CI check only oEmbed plus anchor quotes against those files, and refresh transcripts manually.
- **The L1/L2 timestamp claim (checked):** I fetched the YouTube transcripts for L1 `SlqjA04_dpk` and L2 `h5Gc1n8ZuU8`. Their timings match the CDN captions exactly: Boeing 02:22:14.860, imprecision 02:27:44.852; debugger 00:26:17.390, preprocessing 00:50:46.159, null character 01:38:42.790. Y1, Y3, Y4 and Y8 can be marked verified; only L5 still needs re-timing.

**19. §4.1 WSL setup is missing Node.**
- `make test` runs `node check.mjs`, but the apt line has no `nodejs`.
- Windows Node isn't on WSL's PATH as `node`. Ubuntu 22.04's apt nodejs is v12, which is below the Node 18 that check.mjs needs (from knowledge).
- `unzip` is also missing, and there is no "work in ~, not /mnt/c" guidance.
- **Fix:** install Node 18+ (nvm or NodeSource), have `doctor.sh` check `node --version`, and add `unzip` and the location guidance.

**20. Conventions for POSIX code (§2.4 / CLAUDE.md, affecting M9.5, M13 and the capstone).**
- **Checked (fk.c):** strict `-std=c17` hides `clock_gettime`, `CLOCK_MONOTONIC` and `fileno`, giving implicit-declaration errors.
- From knowledge: macOS hides `MAP_ANONYMOUS` under `_POSIX_C_SOURCE` without `_DARWIN_C_SOURCE`, which affects the capstone's `memlib`.
- **Fix:** require `#define _POSIX_C_SOURCE 200809L` (plus `_DARWIN_C_SOURCE` / `_DEFAULT_SOURCE` where needed) and add a `posix` fence key that the verifier checks.

**21. §3.1 step 8: the content-hash cache key is incomplete.**
- It omits `course_rt.c`, `ubsan_rt.c`, `leakcheck.h`, `learnc.h` and the slimmed sysroot. Editing `learnc.h` would leave stale "verified" outputs.
- CI also compiles with the full tar from `node_modules`, not the slimmed one that ships.
- **Fix:** hash all runtime files and the shipped toolchain files, and verify with the exact `dist/toolchain` copy.

## Lower severity

**22. M12.5 tools aren't available to most learners.**
- `perf stat` effectively isn't available on WSL2: no perf build matches the Microsoft kernel, and hardware counters usually aren't exposed (from knowledge).
- Instruments needs full Xcode, not the Command Line Tools.
- **Fix:** use `getrusage` / `clock_gettime`, `valgrind --tool=cachegrind` on Linux/WSL, and the course's own simulator; keep perf optional.

**23. Capstone integration mixes allocators.**
- Rebuilding Speller, eventloop and msh on `mm_malloc` breaks if a `#define malloc` / `free` macro routes memory that libc allocated (`getline`, `strdup`, stdio, `opendir`) into `mm_free`.
- On macOS, defining `malloc` in your own program doesn't replace the C library's internal calls (from knowledge).
- **Fix:** have programs call `mm_*` explicitly, only for their own data. Forbid passing libc-allocated memory to `mm_free`, and have `mm_check` catch it.

**24. P10's "per-learner seeded phases.o" can't be built on a static site.**
- **Fix:** ship N pre-built variants chosen by seed, or read the seed at run time.

**25. P2's "identical output on wasm32 and native" check can't run in M2.**
- There's no local toolchain until M6, and the browser can't run native code.
- **Fix:** rephrase it as "passes in-browser tests, where `long` is 32-bit".

**26. Runtime and browser-coverage items left out of the plan.**
- `sleep()` busy-waits in browser_wasi_shim's `poll_oneoff`, so the CPU watchdog kills legitimate programs. This open item from runtime-browser.md isn't in the plan.
- **Fix:** suspend with JSPI plus `setTimeout` and pause the watchdog clock.
- Playwright WebKit on Linux isn't Safari or iOS, and Safari stack traces lack the wasm byte offsets that trap symbolisation needs.
- **Fix:** run a manual Safari/iOS check before Stage 2 sign-off and fall back to messages without a line number.

**27. §11 Stage 2 says "every interaction type", but M1 only plans 7 of the 12 in §5.**
- NP is only a teaser; TT, AS, BENCH and LT are absent. LT also needs the token flow from item 12 built in Stage 2.
- **Fix:** align the wording with the spec's list.