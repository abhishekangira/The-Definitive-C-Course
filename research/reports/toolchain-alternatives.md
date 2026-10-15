# Real C in the browser: alternatives to @yowasp/clang (survey, October 2026)

## Summary and ranking

1. **@live-codes/clang-wasm 0.3.0** is the best alternative I tested. It runs Clang 22.1.8 targeting wasm32-wasi, with prebuilt assets from @wasm-idle/llvm-core 1.1.0.
   - **Works everywhere I tried:** Node, headless Chromium 141 and a classic Web Worker, all without COOP/COEP headers.
   - **Size:** about 29 MB gzip, or 23.4 MB brotli if you recompress the assets yourself.
   - **Speed:** a warm compile, link and run takes 0.17–0.34 s.
   - **Diagnostics:** for my test files, the text matches native clang 18 exactly.
   - **License:** MIT, plus Apache-2.0 WITH LLVM-exception for the bundled LLVM parts.
   - **Main risk:** it is three weeks old and has one maintainer. Mitigation: pin and self-host its four asset files and write our own thin driver around them.
2. **Wasmer SDK 0.19.1 with the `clang/clang` package (clang 16.0.0)** works in Node and in Chromium, but only on a cross-origin-isolated page. It is the only option that gave true interactive stdin out of the box.
   - **Cons:** the clang package is stale (one version, published 2024-10-03). It is a 110.7 MB uncompressed download from Wasmer's CDN. The SDK is alpha and changing fast, its workers broke when I bundled it with Vite, and the license adds an attribution clause.
3. **browsercc 0.1.1 (Clang 20.1.2)** works in Node and Chromium without COOP/COEP and returns full diagnostics, warnings included.
   - **Cons:** it reloads clang and lld on every compile, so each compile takes 1–2.5 s. It defaults to C++, so C needs `--driver-mode=gcc`. It has had no release since 2025-04-19. It would make a good codebase to fork.
4. **Emception 4.4.0 (gameguild fork, Clang 23 RC)** is not recommended now. It needs COOP/COEP, is very slow (compile 3–18 s plus link 14–26 s per program), and corrupted stdout in my runs. The full `emcc` path crashed in my headless Chromium runs.
5. **Runno 0.10.x** is not recommended. It uses binji's 2019 clang 8.0.1 with hard-coded `-Werror` and C11, and the sandbox never delivered EOF on stdin.
6. **Excluded:**
   - binji/wasm-clang: a superseded 2019 demo.
   - xeus-cpp in JupyterLite: a cell-by-cell REPL, not compile-and-run of a whole file.
   - TCC, xcc, picoc and JSCPP: not clang or gcc diagnostics.
   - Compiler Explorer, Sphere Engine and Judge0: all need a backend.
   - CheerpX/WebVM and v86: license limits, size, and 32-bit x86 emulation.
   - @ai-ecoverse/wasm-clang: needs the SLICC kernel to run.

Several findings apply to every wasm32 toolchain, @yowasp/clang included, and will shape the verification pipeline:
- `long`, pointers and `size_t` are 4 bytes in the browser, against 8 natively.
- Some warnings depend on the target. `1L << 40` warns on wasm32 and not on x86-64. A workaround works: a second in-browser `-fsyntax-only` pass with an x86-64 target.
- A null dereference at -O0 silently writes to address 0 instead of crashing.
- `assert` output and fault behaviour differ from native.
- None of the WASI options give AddressSanitizer (ASan). UndefinedBehaviorSanitizer (UBSan) in trap mode does work.

Details are in the "Issues common to all wasm32 options" section below.

## What I ran, and network notes

- **Native reference in this container:** gcc 13.3 and Ubuntu clang 18.1.3. Browser tests used Playwright 1.56.1 with headless Chromium 141.0.7390.37. All work is in `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/alternatives/`.
- **Test programs** are in `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/alternatives/samples/`. They cover hello, warnings, a syntax error, stdin with an EOF loop, `sizeof` output, heap overflow, exit codes, null dereference, signed overflow, `assert`, stack overflow, array bounds and a shift test.
- **Network:**
  - At 08:56 UTC, curl got no connection to `registry.wasmer.io`, `cdn.wasmer.io`, `runno.dev` or `godbolt.org`.
  - By about 09:45 UTC, `registry.wasmer.io/graphql`, `runno.dev/langs/clang.wasm` and `godbolt.org/api/compilers/c` returned 200; `cdn.wasmer.io/` returned 400 at the root, and the clang package file itself downloaded fine. So access is intermittent or the policy changed during the session.
  - `cdn.jsdelivr.net` stayed blocked.
  - GitHub's API is blocked per repository, but `raw.githubusercontent.com` works.
- In the report, "Verified" means I ran it here. "Docs" means I only read it.

## Comparison table

| Candidate | Real compiler | Clang diagnostics | stdin | Download | Last release | License | Static self-host | COOP/COEP |
|---|---|---|---|---|---|---|---|---|
| **@live-codes/clang-wasm 0.3.0** (wraps @wasm-idle/llvm-core 1.1.0) | Yes, Clang 22.1.8, wasm32-wasi (V) | Yes, text matches native clang 18 (V) | Pre-supplied stdin with EOF (V). Interactive needs llvm-core's lower-level SharedArrayBuffer path (Docs) | 29.0 MB gzip / 23.4 MB br / 87.8 MB raw (V) | 2026-09-23; upstream 2026-10-10, 16 releases since July (V) | MIT + Apache-LLVM (V) | Yes, `clang-wasm-copy-assets` (V) | **Not needed** (V) |
| **Wasmer SDK 0.19.1 + `clang/clang` 0.160000.1** | Yes, clang 16.0.0, wasm32 (V) | Yes, older clang 16 format without the line-number column (V) | **Interactive**: `spawn({stdin:'pipe'})` (V, browser and Node) | 4.8 MB SDK wasm + 110.7 MB package served uncompressed (V); 26.5 MB br if self-hosted (V) | SDK 2026-10-07 (34 versions); clang package 2024-10-03, only version (V) | "Modified MIT": must show "Wasmer" if over 1M monthly users or $1M monthly revenue (V) | Yes, `wasmer.packages.load(bytes)` with a self-hosted file (V in Node and Chromium) | **Required** (V: refuses without it) |
| **browsercc 0.1.1** | Yes, Clang 20.1.2 (V) | Yes, full warnings (V) | Any, through @bjorn3/browser_wasi_shim (V, pre-supplied) | 23.96 MB br / 29.73 MB gzip / 94.5 MB raw (V) | 2025-04-19, both versions on that day (V) | MIT | Yes | Not needed (V) |
| **Emception 4.4.0** (gameguild) | Yes, Clang 23.1.0-rc3 + emcc 5.0.7 + CPython 3.13 (V) | Yes, coloured (V) | SharedArrayBuffer feeder (Docs); pre-supplied works (V) | About 41 MB br minimum for C; 108 MB full payload (V) | 2026-08-23 (V) | MIT | Yes, copy `emception/cdn/`; default points at jsDelivr (V) | **Required** per README; ships coi-serviceworker (V) |
| **Runno** (@runno/runtime, /wasi, /sandbox 0.10.x) | Yes, clang 8.0.1 from binji (V) | Yes, but forced `-Werror -ferror-limit 4` and C11 (V) | Pre-supplied, but **EOF never arrives** (V); interactive needs COOP/COEP (Docs) | 15.9 MB br (V) | 2025-05-18 (V) | MIT | Runtime hard-codes `https://runno.dev/langs` (V) | Required for stdin (Docs) |
| binji/wasm-clang | clang 8 (V, through Runno) | Yes | Yes | ~50 MB raw | 2019 demo, no releases (Docs) | Apache-2.0 | Yes | — |
| xeus-cpp in JupyterLite | clang-repl (REPL) | Yes | Unknown | Heavy (not measured) | Active (Docs) | BSD-3 | Yes | — |
| TCC / xcc in wasm | Yes, but not clang/gcc | Their own short messages | Varies | Small | Hobby projects | Varies | Yes | — |
| picoc-js 1.0.12 / JSCPP 2.0.9 | No, toy interpreters | No (V for picoc) | — | 0.8 MB / 20 MB | 2021 / 2022 | MIT | Yes | No |
| Compiler Explorer API | Yes (server) | Yes | Pre-supplied | — | — | — | **No, needs backend** | — |
| CheerpX 1.4.0 / v86 0.5.471 | Real gcc inside a 32-bit x86 virtual machine | gcc | Yes | Hundreds of MB disk image | 2026-10 | CheerpX: businesses may only evaluate (V); v86: BSD-2 | CheerpX runtime loads from Leaning Tech's CDN only (V) | CheerpX needs it |
| @yowasp/clang (reference row; teammate is evaluating) | clang 22 git, wasm32 | — | — | 105.5 MB unpacked on npm | 2026-03-12 | ISC | — | — |

V = verified here. Brotli figures are brotli quality 9 computed with `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/alternatives/scripts/csize.mjs`.

## Candidate details

### 1. @live-codes/clang-wasm 0.3.0 and @wasm-idle/llvm-core 1.1.0 (verified)

**Package facts (npm)**
- Created 2026-09-17; 3 versions; maintainer hatemhosny, the LiveCodes author. The GitHub repo has 0 stars (Docs).
- Depends on `@wasm-idle/llvm-core@^1.0.0` and `@bjorn3/browser_wasi_shim@^0.4.2`.

**Assets (byte counts)**

| File | Bytes |
|---|---|
| `clang.wasm.gz` | 15,721,977 |
| `lld.wasm.gz` | 7,837,837 |
| `memfs.wasm.gz` | 38,702 |
| `sysroot.tar.gz` | 5,401,380 |
| IIFE bundle `dist/clang-wasm.global.js` | 302,798 |

- The manifest reports `llvmorg-22.1.8`, revision `ca7933e4…`, `defaultTarget: wasm32-wasi`.
- Raw sizes: clang.wasm 44.16 MB, lld.wasm 20.80 MB, sysroot.tar 22.75 MB. The sysroot holds 1,418 entries, including libc++ headers, so a C-only build could be trimmed.

**Lineage (code reading):** the runtime drives `clang -cc1` and `wasm-ld` directly over binji's `memfs.wasm`. Its default resource directory in the code is still `/lib/clang/8.0.1`, so it descends from binji's 2019 demo, modernised.

**Behaviour I verified**

| Check | Result |
|---|---|
| Startup (Node) | `createCompiler` 2.3 s |
| Compile (Node) | 2.5 s first, then 60–500 ms |
| Startup (Chromium page, no COOP/COEP) | `crossOriginIsolated:false`; create 736 ms |
| Compile (Chromium page) | 23 ms–1.2 s; six programs in 3.4 s wall time |
| Classic Web Worker (`importScripts`) | First run 1.39 s including asset load from localhost; warm 171–338 ms |
| Language standard | The `std` option only accepts `gnu11/gnu17/gnu23`. Passing `std:null` with `compileArgs:['-std=c17']` gives `__STDC_VERSION__=201710` |
| Default optimisation | `-O2` (`opt = options.opt \|\| '2'`). User flags come after it, so `-O0` in `compileArgs` wins |
| Warnings | `run()` drops warnings when the compile succeeds (documented design). The toolchain API returns them, and they match native clang 18 for warn.c and err.c |
| Pre-supplied stdin | Works, and EOF is delivered: the getchar loop counted 5 remaining characters |
| Exit codes and stderr | `exit(3)` gives exitCode 3; stderr is separated |
| ASan | `-fsanitize=address` fails to link: `undefined symbol: __asan_init` |
| UBSan | `-fsanitize=undefined` is rejected at the `-cc1` level. Individual checks with trap mode work: `null,alignment,signed-integer-overflow,shift-base,shift-exponent,array-bounds,integer-divide-by-zero,return,vla-bound,pointer-overflow`. Null dereference, signed overflow and out-of-bounds index all trapped with `unreachable` |
| Output on trap | `run()` throws, and stdout the program had already flushed (`"before\n"`) is lost |
| Debugging (Docs only) | llvm-core includes a browser LLDB/DAP debug session using a WAMR worker with SharedArrayBuffer queues. That would need COOP/COEP |

Snippet that worked in Node, getting warnings through the lower-level toolchain API:
```js
import { createToolchain, compilerDiagnostics } from '@live-codes/clang-wasm/toolchain';
const tc = await createToolchain({});              // Node: uses packaged assets
const out = await tc.lock(() => tc.captureCompilerOutput(() =>
  tc.runtime.compileArtifact(code, { language: 'C', fileName: 'warn.c',
    compileArgs: ['-fgnuc-version=4.2.1','-std=c17','-Wall','-Wextra','-pedantic','-O0'] })));
console.log(compilerDiagnostics(out.raw).join('\n'));  // full clang warnings
if (!out.error) await tc.execute(out.result, { args: [] }); // {exitCode, stdout, stderr}
```

Snippet that worked in the browser worker:
```js
importScripts('/clang-wasm.global.js');
const c = await self.clangWasm.createCompiler('c', { baseUrl: '/clang/', std: null,
  compileArgs: ['-std=c17','-Wall','-Wextra','-pedantic','-O0'] });
const r = await c.run(code, 'stdin text\n');
```

### 2. Wasmer SDK 0.19.1 with clang/clang (verified)

**Registry**
- A GraphQL query to the Wasmer registry shows `clang/clang` has a single version, `0.160000.1`, created 2024-10-03.
- It points to `cdn.wasmer.io/webcimages/c127b7bf….webc`: 110,713,421 bytes, `access-control-allow-origin: *`.
- The CDN sent no `Content-Encoding` even when asked for `br, gzip`, so users would download the full 110.7 MB. Self-hosted with brotli it is 26.48 MB.
- `syrusakbary/clang` 0.1.1 (2025-05-15) is 109,418,872 bytes.
- The binary reports `clang 16.0.0 (/home/amin/projects/llvm-project-16.0.0.src/...)`, which looks like a personal build.

**SDK**
- Very active and alpha: versions 0.14 through 0.19 shipped between 2026-09-17 and 2026-10-07, and the API was redesigned (`Wasmer.fromRegistry` became `wasmer.sandboxes.create`).
- Its core is a 4,828,234-byte wasm file.
- The registry address `https://registry.wasmer.io/graphql` is compiled into the SDK.

**Behaviour I verified**

| Check | Result |
|---|---|
| Node, file loaded locally with `packages.load(readFileSync('clang.webc'))` | Package load 3.2 s; compile 105–1,246 ms. Warnings and errors match clang 16 output. Running the compiled program works, including EOF on stdin |
| Chromium with COOP/COEP, SDK served unbundled from `node_modules` | Load 3.8 s; compiles 105–291 ms; all five programs correct |
| Chromium, **Vite-bundled** build | Broken: `clang` exits 1 with no output, then `Scheduler is dead`. The SDK resolves its worker files at runtime, and Vite's rewrite breaks that. This needs care in our React build (copy the SDK files unbundled) |
| Chromium **without** COOP/COEP | Console prints "You can only run packages from 'Cross-Origin Isolated' websites", then the call returns exit 0 with empty output: a silent failure |
| Interactive stdin in Chromium | `spawn({stdin:'pipe'})`: the process waited for input, then printed `"name? Hello, carol!…"`. With `terminal:{…}` the input is echoed as a terminal would |
| Prompt flushing | Prompts without a newline did not appear before input, because stdout is buffered. We would need to make stdout unbuffered (for example a `setvbuf` prelude) |

```js
import { Wasmer } from '/nm/@wasmer/sdk/dist/index.js'; // unbundled; page must be COOP/COEP
const wasmer = new Wasmer();
const clang = await wasmer.packages.load(new Uint8Array(await (await fetch('/clang.webc')).arrayBuffer()));
const sb = await wasmer.sandboxes.create({ packages: [clang], files: { 'main.c': src } });
const r = await sb.command(clang, ['/workspace/main.c','-std=c17','-Wall','-Wextra','-pedantic','-o','/workspace/main.wasm']).run({ check: false });
const prog = await wasmer.packages.load(await sb.fs.readFile('/workspace/main.wasm'));
const p = await (await wasmer.sandboxes.create({ packages: [prog] })).command(prog).spawn({ stdin: 'pipe' });
await p.stdin.write('alice 41\n'); await p.stdin.close(); await p.wait();
```

### 3. browsercc 0.1.1 (verified)

- **Files:**

  | File | Bytes |
  |---|---|
  | `clang.wasm` | 42,553,880 |
  | `lld.wasm` | 23,202,572 |
  | `sysroot.tar` | 28,620,800 |
  | `stdc++.h.pch` (optional, C++ only) | 19,359,928 |

- **How it works:** clang and lld are compiled with Emscripten and use its in-memory filesystem. The output is a standard WASI module, which you run yourself with `@bjorn3/browser_wasi_shim`.
- **C needs a flag:** the driver is named `clang++`, so plain `-std=c17` fails with "invalid argument '-std=c17' not allowed with 'C++'". Adding `--driver-mode=gcc` fixes it.
- **Results:** diagnostics include all warnings. It runs in Node (with a small `fetch` shim for `file:` URLs) and in Chromium without COOP/COEP.
- **Speed:** 1.0–2.5 s per compile, because every `compile()` re-creates the clang and lld instances and re-extracts the 28.6 MB sysroot (from reading the code).
- **Better crash behaviour:** because you run the module yourself, already-flushed output survives a trap (`"before\n"`), and the `assert` message survives too: `Assertion failed: n == 4 (abort.c: main: 3)`.

### 4. Emception 4.4.0 / @gameguild/emception-browser 4.4.0 (verified in Chromium with COOP/COEP)

- **Packaging:** the `emception` npm package is 109,713,095 bytes compressed. It ships 29 brotli bundles, for example `clang.tar.br` at 22,722,627 bytes, which expands to 111.1 MB. The adapter needs a bundler (it uses Vite's `?raw` import). There is no Node adapter (`@gameguild/emception-node` returns 404).
- **Speed (four programs took 106.8 s in total):**
  - `-cc1` compile: 3.4–18.1 s
  - `wasm-ld` link: 14.4–25.6 s
  - run: 0.7–2.1 s
  - Chromium has no built-in brotli decompression, so it falls back to a bundled brotli wasm.
- **Output corruption:** extra newlines appeared, including one in the middle of a line: `"42\n\n\nassign in if\n\n"` and `"…you'll be 42\n.\n"`.
- **Full emcc path:** `python3 --version` took 28.5 s and `emcc --version` took 26.5 s (emcc 5.0.7). Every `emcc` compile, including `-fsanitize=address -sSTANDALONE_WASM`, failed with "table index is out of bounds" and never finished within 580 s (tried twice). The manifest does include `libasan_rt.a` and the UBSan libraries for wasm32-emscripten, so in-browser ASan remains unverified.

### 5. Runno (verified)

- **Compiler:** the sandbox hard-codes these `-cc1` arguments: `-Werror -ferror-limit 4 -fmessage-length 80 -fcolor-diagnostics -O2 -triple wasm32-unknown-wasi` with resource directory `8.0.1`.
- **Results:**
  - `__clang_version__` is 8.0.1 and `__STDC_VERSION__` is 201112 (C11). There is no way to pass `-std` through `runCode`.
  - warn.c failed to compile, because `-Werror` turns warnings into errors.
  - A program reading stdin until EOF hit the 60 s timeout. A program using only `scanf` worked.
- **Hosting:** `@runno/runtime` fetches binaries from `dt = "https://runno.dev/langs"`, hard-coded in `dist/main.js`. The README's mention of the Wasmer package registry is out of date.
- **Size:** `clang.wasm` 31,214,472 bytes and `wasm-ld.wasm` 19,490,094 bytes. Each `runCode` took 2.8–4.2 s in Node.

### 6. Other options

- **binji/wasm-clang (Docs):** the CppCon 2019 demo, described by its author as "alpha demoware"; clang 8, 45 commits, 341 stars, 40 forks, no releases. The npm name `wasm-clang` was unpublished in 2021. Its descendants are Runno, @chriskoch/cpp-wasm 1.0.2 (clang 8.0.1, 2022, 60 MB, which LiveCodes currently uses), and @wasm-idle/llvm-core.
- **xeus-cpp (Docs, from its build files on GitHub):** the WebAssembly build includes C kernels `xc11`, `xc17` and `xc23`; `xc17` runs `-xc -std=c17`. It is clang-repl (incremental, one cell at a time) on the JupyterLite stack (`@jupyterlite/xeus` 5.1.0 is 23 MB of JS alone). It could serve a future scratchpad, not lesson widgets.
- **TCC (Docs):** upstream TCC has no wasm backend. The browser projects compile TCC itself to wasm and emit RISC-V or x86 code that runs under an emulator (lupyuen's tcc-riscv32-wasm, webc86, v86 with TCC). Its messages are short TCC errors with no `-Wall`-class warnings.
- **picoc-js (verified):** no warnings at all; reports "can't read file stdint.h"; printed nothing for the syntax-error file.
- **@ai-ecoverse/wasm-clang 24.0.0-13 (verified only that it starts):** a single `llvm.wasm` of 74,790,404 bytes. `node bin/clang --version` prints clang 24.0.0git, but the compiler wrappers are `/bin/sh` scripts that need the SLICC kernel and a separate WASIX sysroot package.
- **CheerpX (verified from its package files):** its `index.js` loads `https://cxrtnc.leaningtech.com/1.4.0/cx.esm.js`. Its license (section 1.4) allows businesses only "technical evaluation and testing".
- **Compiler Explorer (Docs):** a third-party backend. Its API docs say requests are queued like interactive ones and that rate limiting or authentication may come later. Using it would break the static, no-backend requirement and send students' code to a third party.

## Issues common to all wasm32 options (these apply to @yowasp/clang too)

1. **Type sizes differ from native.** All five toolchains I ran printed `char=1 short=2 int=4 long=4 llong=8 ptr=4 size_t=4` and `LONG_MAX=2147483647`. Native x86-64 prints `long=8 ptr=8 size_t=8`.
   - The clang frontend does accept `-triple wasm64-unknown-wasi` and then gives 8-byte `long` and pointers: I checked this with `_Static_assert`.
   - Chromium 141 accepts wasm64 memory (`memory64`).
   - But no candidate ships a wasm64 C library. Emception's manifest has only `struct_info_generated_wasm64.json`. Running real 64-bit code in the browser would be a research project.
2. **Some warnings depend on the target.** For `long big = 1L << 40;`, wasm32 warns `shift count >= width of type [-Wshift-count-overflow]` and x86-64 (native clang 18) does not.
   - Workaround that worked: run the in-browser clang a second time with `-cc1 -triple x86_64-unknown-linux-gnu -fsyntax-only -internal-isystem /lib/clang/22/include -internal-isystem /include/wasm32-wasi -internal-isystem /include`.
   - That gave 0 warnings for shift.c and the same warnings as native for warn.c. Then compile for wasm32 only to execute.
   - Caveat: these are WASI libc headers, not glibc.
3. **Crashes behave differently.**
   - **Null dereference:** natively it is a segmentation fault (exit 139). In wasm at `-O0` it **silently writes to address 0 and prints "after 42"**. At `-O2` it traps with `unreachable`.
   - **`assert`:** glibc prints `prog: file:3: main: Assertion 'n == 4' failed.` and aborts. WASI libc prints `Assertion failed: n == 4 (abort.c: main: 3)` and traps.
   - **Stack overflow:** shows up as the JavaScript error "Maximum call stack size exceeded" (in Node).
   - UBSan trap mode makes undefined behaviour trap, but with no message, so the app would need to explain each trap. Lessons about crashes and undefined behaviour should show the stored native output.
4. **Sanitizers:** no WASI option gives ASan (verified for live-codes). Keep ASan in the native build pipeline only, and use UBSan trap mode in the browser.
5. **stdin:**
   - Pre-supplied stdin with EOF works everywhere without COOP/COEP.
   - True interactive input needs SharedArrayBuffer with Atomics, which needs COOP/COEP. Chromium 141 leaves `SharedArrayBuffer` undefined on a page without those headers (verified). The alternatives are JSPI (`WebAssembly.Suspending` exists in Chromium 141; other browsers unverified) or Asyncify.
   - Hosting: GitHub Pages cannot set these headers, so it needs coi-serviceworker (Emception ships one). Netlify and Cloudflare Pages can set them with a `_headers` file.
   - Prompts printed without a newline stay buffered until we inject an unbuffered-stdout prelude.
6. **Clang versions drift.** Native here is clang 18; the browser options are 16, 20, 22 and 23. The message text matched across 18, 20, 22 and 23 for my tests. Clang 16 lacks the line-number column, and Emception's clang 23 adds syntax colouring. Two recommendations:
   - Pin the native pipeline to the same clang major version as the browser compiler (for example clang-22 from apt.llvm.org).
   - Compare diagnostics by (line, column, severity, `[-Wflag]`) rather than raw text.

## What popular C-learning sites do

- **CS50 (cs50.dev):** VS Code in GitHub Codespaces. Its image builds on `cs50/cli`, which is Ubuntu 24.04. I checked `cs50/cli` `etc/profile.d/cli.sh` on GitHub:
  - `CC="clang"`
  - `CFLAGS="-ferror-limit=1 -gdwarf-4 -ggdb3 -O0 -std=c23 -Wall -Werror -Wextra -Wno-gnu-folding-constant -Wno-sign-compare -Wno-unused-parameter -Wno-unused-variable -Wno-unused-but-set-variable -Wshadow"`
  - `LDLIBS="-lcrypt -lcs50 -lm"`

  CS50 now compiles as **C23** with `-Werror`.
- **learn-c.org:** runs code on a backend. Its open-source `ronreiter/interactive-tutorials` repo calls the IDEOne/Sphere Engine API (`api_url='http://ronreiter.compilers.sphere-engine.com/api/1/service.wsdl'`).
- **Programiz, Coddy and similar sites:** run code on a server (Docs; Coddy uses gcc on Alpine/musl). Compiler Explorer runs its own server farm.
- **LiveCodes:** runs code in the browser with @chriskoch/cpp-wasm (clang 8.0.1). It built @live-codes/clang-wasm to test replacing it with Clang 22 (Docs). Runno-based sites run binji's clang 8.

## Recommended plan, with fallbacks

- **Primary:** use the wasm-idle/wasm-llvm Clang 22 assets (`clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar`).
  - Vendor them on our own static host, checked against their SHA-256 receipts.
  - Drive them through our own thin layer modelled on browsercc: `-cc1` then `wasm-ld`, then run with browser_wasi_shim. That gives us warnings, output kept on traps, and our own trap classification.
  - Run the same code in Node for the build-time pipeline. Add the x86-64 `-fsyntax-only` diagnostics pass.
  - Hide all of this behind a `CompilerBackend` interface so @yowasp/clang, browsercc or this one can be swapped in.
- **Fallback A:** @yowasp/clang (teammate's evaluation) or browsercc, patched to keep the clang and lld instances between compiles.
- **Fallback B, for interactive stdin:** offer it only when the page is cross-origin isolated, using either llvm-core's SharedArrayBuffer stdin buffer or Wasmer SDK as the program runner, served unbundled. Otherwise default to a pre-supplied stdin box.

## Files

Everything is under `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/alternatives/`:

- **Node test scripts** (in `try/`): `livecodes.mjs`, `livecodes-warn.mjs`, `lc-x64diag.mjs`, `lc-ubsan.mjs`, `lc-null.mjs`, `lc-wasm64.mjs`, `browsercc-test.mjs`, `bcc-trap.mjs`, `runno-test.mjs`, `wasmer-clang.mjs`, `wasmer-raw2.mjs`
- **Server, browser drivers and size script** (in `scripts/`): `serve.mjs` (static server that can add COOP/COEP), `drive.mjs`, `drive-emc.mjs`, `drive-int.mjs`, `csize.mjs`
- **Browser test pages:**
  - `web/livecodes.html`, `web/lc-worker.html`, `web/browsercc.html`
  - `wsdk/raw/main.js` (Wasmer, unbundled)
  - `emc/main.js` (Emception through Vite)
- **Emception logs:** `emc-run2.log`, `emc-run4.log`, `emc-run5.log`
- **Downloaded clang package:** `webc/clang.webc` (sha256 `c127b7bfc0041d02c94045f40be7fb4b3eeb98cede25fad96261b7b90a82f405`)

Sources (web): [Wasmer clang-in-browser post](https://wasmer.io/posts/clang-in-browser), [browsercc](https://github.com/BertalanD/browsercc), [binji/wasm-clang](https://github.com/binji/wasm-clang), [live-codes/clang-wasm](https://github.com/live-codes/clang-wasm), [xeus-cpp](https://github.com/compiler-research/xeus-cpp), [FOSDEM 2026 xeus-cpp talk](https://fosdem.org/2026/schedule/event/building_interactive_cc_workflows_in_jupyter_through_clang-repl), [lupyuen tcc-riscv32-wasm](https://github.com/lupyuen/tcc-riscv32-wasm), [HN: compiling C in the browser](https://news.ycombinator.com/item?id=41767644), [v86 + TCC article](https://ja.nsommer.dk/articles/linux-and-tiny-c-compiler-in-the-browser-part-one.html), [V8 JSPI blog](https://v8.dev/blog/jspi), [OpenReplay JSPI status](https://blog.openreplay.com/jspi-javascript-wasm-bridge/), [Compiler Explorer API docs](https://github.com/compiler-explorer/compiler-explorer/blob/main/docs/API.md), [interactive-tutorials (learn-c.org)](https://github.com/ronreiter/interactive-tutorials), [cs50/cli](https://github.com/cs50/cli), [CS50 notes](https://cs50.harvard.edu/college/2022/spring/notes/2), [Coddy playground](https://coddy.tech/playground/c).