# The Definitive C Course: Plan

This is a self-paced, interactive web app that teaches C17 and low-level computer fundamentals to experienced front-end engineers. It is a static site with no backend. Learners write and run real C in the browser from the first lesson, and move to their own toolchain once the browser stops being enough.

> **Status:** Stage 1 (plan) is ready for review. Nothing here is built yet. Every technical claim marked **[V]** was verified by running it in this repo's container during research. Raw reports and working prototypes are in `research/reports/` and `research/prototypes/`.

---

## 0. Key decisions at a glance

| Question | Decision | Why (short) |
|---|---|---|
| In-browser C compiler | **`@yowasp/clang` 22.0.0-git20542-10**, pinned and self-hosted | It is real clang 22. Diagnostics are byte-identical to native clang, warm compile+link takes about 100–150 ms, and it needs no COOP/COEP headers. It is deterministic, so the same binary runs in Node for CI **[V]**. |
| Running the compiled program | `@bjorn3/browser_wasi_shim` 0.4.2 in a per-run Web Worker, with our own stdin/stdout file descriptors | Small (6.7 KB gzip worker); supports stdin, an in-memory filesystem and streaming output; MIT/Apache **[V]** |
| Interactive `scanf` | **JSPI** where supported (Chrome/Edge 137+, Firefox 153+, Safari 27). Elsewhere a pre-filled stdin box. SharedArrayBuffer only when the host sends COOP/COEP. | Works with no special hosting headers **[V in Chromium]** |
| App stack | Vite + React 19 + TypeScript, MDX content, CodeMirror 6 editor | Matches the requested stack. Lessons stay in `content/` as MDX, separate from components. |
| Progress | `localStorage` (versioned schema) plus export and import as a JSON file | As specified |
| Build-time truth | `tools/verify`: every sample is compiled and run natively (gcc + clang, x86-64) **and** with the browser compiler in Node. Normalized outputs are diffed; flagged samples store both results. | Expected outputs and prediction answers always come from real runs |
| Stack/heap stepper data | Traces pre-baked by a gdb-Python tracer with a malloc/free shim at build time **[V]** | A static site can't trace live. gdb gives scopes, types and heap blocks for free. |
| Local projects | Starter download plus `make test` → `node check.mjs` (zero-dependency, check50-like) **[V on Linux]** | The audience already has Node. It shares the test format with the in-browser runner. |
| Animations | HyperFrames source projects kept in `animations/`. They ship as H.264 MP4 + WebM + poster + WebVTT captions, played in our accessible `<Explainer>` player that can pause at labelled steps. | Deterministic, byte-identical renders; accessible native video; no runtime JS **[V]** |
| YouTube | `youtube-nocookie.com/embed/ID?start=&end=`, at most 2 per module, all listed in `videos.json` | IDs confirmed via oEmbed; timestamps taken from yt-dlp transcripts **[V]** |
| Hosting | Static build deployed by GitHub Actions to GitHub Pages (works on any static host). The toolchain is copied from `node_modules` at build time, never committed. | Free. The whole site works offline after the first visit. |
| Course size | **13 modules + capstone, about 195 h ≈ 39 weeks at 5 h/week.** CS50x C parity at week ≈ 23.5. | See §6. A fast lane of about 186 h is defined. |

---

## 1. Research summary

### 1.1 Options for running real C in the browser

Every candidate was installed and run here (Node 22, headless Chromium 141) unless noted. Full report: `research/reports/toolchain-alternatives.md` and `toolchain-yowasp.md`.

| Candidate | Real compiler / diagnostics | stdin | First download | COOP/COEP | Verdict |
|---|---|---|---|---|---|
| **@yowasp/clang 22** (LLVM → WASI, jco) | clang 22.1.0; diagnostics byte-identical to native clang 18 for our tests **[V]** | Pre-filled **[V]**; interactive via JSPI **[V]** | ≈17 MB brotli / ≈24 MB gzip (105 MB raw); a C-only sysroot saves a further ≈2 MB **[V]** | Not needed **[V]** | **Chosen** |
| @live-codes/clang-wasm 0.3 (wasm-idle llvm-core) | clang 22.1.8; good diagnostics **[V]** | Pre-filled **[V]** | ≈23 MB brotli | Not needed | Best fallback, but only 3 weeks old with a single maintainer. `run()` drops warnings and loses output on a trap. |
| Wasmer SDK + `clang/clang` | clang 16 (2024 personal build) | Truly interactive **[V]** | 110 MB uncompressed from Wasmer's CDN | **Required** (silently fails without it) **[V]** | Rejected: stale clang, COI requirement, and broke under Vite bundling |
| browsercc 0.1.1 | clang 20 | Pre-filled | ≈24 MB brotli | Not needed | Rejected: 1–2.5 s per compile (reloads clang every time) and unmaintained since 2025-04 |
| Emception 4.4 | clang 23 rc + emcc | — | ≈41 MB+ brotli | Required | Rejected: 3–18 s compiles plus 14–26 s links, and corrupted stdout **[V]** |
| Runno / binji wasm-clang | clang 8 (2019), forced `-Werror`, C11 | EOF never delivered **[V]** | ≈16 MB | For stdin | Rejected |
| TCC/xcc, picoc, JSCPP | Not clang or gcc / toy interpreters | — | small | — | Excluded by the "no toy interpreter" requirement |
| Compiler Explorer, Judge0, learn-c.org-style | Real, on a server | — | — | — | Excluded: needs a backend and sends learner code to a third party |

**Why @yowasp/clang wins:**
- Diagnostics are real and current.
- It is the fastest warm compile we measured: 100 ms in Node, about 146 ms median in Chromium **[V]**.
- One compiled module stays warm in a long-lived worker.
- It works without cross-origin isolation.
- The same package runs in Node, so **CI's "browser" outputs are produced by the identical compiler binary** (same sha256 across runs **[V]**).

All compiler access goes behind a small `CompilerBackend` interface, so live-codes or browsercc can be swapped in if yowasp stalls.

### 1.2 What the browser build cannot do, and how the plan handles each

| Limitation (verified) | Handling |
|---|---|
| No x86-64/arm64 backend (the build registers wasm32/wasm64 only) **[V]** | Native x86-64 and arm64 `.s` listings for course samples are generated at build time with native compilers (clang cross-targets `aarch64-linux-gnu` and `arm64-apple-macos`). For learner-edited code the app shows wasm text and LLVM IR. An optional "Open in Compiler Explorer" link-out is available. |
| No ASan, and no UBSan runtime shipped **[V]** | **Guardrail mode:** `-fsanitize=undefined` linked with our own tiny UBSan runtime. It prints messages in native UBSan format, e.g. `main.c:7:41: runtime error: signed integer overflow…` **[V]**, and even catches NULL dereferences that wasm itself does not trap. From M5, tests also add `-include leakcheck.h`, our own leak, canary-overflow and invalid-free checker **[V]**. Real ASan arrives in M6 (native). |
| NULL reads and writes do not trap; string literals are writable; the stack sits below globals **[V]** | Taught explicitly. Affected samples are auto-flagged by the diff, and the stored native result (SIGSEGV) is shown next to the browser result. |
| `long`, pointers and `size_t` are 4 bytes **[V]** | Auto-flagged; native 64-bit output is stored and shown. Where it is derivable, the learner predicts the 64-bit value first (§3.4). |
| musl `rand()` sequence and `qsort` stability differ from glibc **[V]** | Prediction questions never use libc `rand()`. Samples use the course PRNG in `learnc.h`. |
| Default 64 KiB stack (about 200 frames) **[V]** | Link with `-Wl,-z,stack-size=8388608`. The JS engine stack caps recursion at roughly 6–15k frames depending on frame size; lessons demonstrating stack overflow use large frames so browser and native agree. |
| A `malloc` loop grows memory to 4 GiB **[V]** | Link with `-Wl,--max-memory=268435456`. |
| musl does not flush stdout before blocking on stdin, so prompts stay invisible **[V]** | Every program links `course_rt.c`, which exports `__course_flush_stdout()`. The stdin hook calls it before waiting **[V]**. |
| Wasm traps instead of signals | Traps map to friendly messages with a source location via `llvm-symbolizer` on DWARF, e.g. "Integer division by zero at main.c:4:14 in divide()" **[V]**. |
| `clock()` needs WASI emulation; local time is always UTC | Built with `-D_WASI_EMULATED_PROCESS_CLOCKS -lwasi-emulated-process-clocks`. Benchmarks that matter run natively. |

### 1.3 HyperFrames

I read the skills (`hyperframes`, `-core`, `-cli`, `-animation`, `-keyframes`, `-creative`, `-studio`, `faceless-explainer`, `motion-graphics`), the package docs and the upstream README. Then I built a reference composition (`research/prototypes/hyperframes/compile-pipeline`, "main.c → main.o → a.out"), which passed `lint` (0 errors, 0 warnings) and `check --strict` (contrast 31/31 AA). It rendered to MP4 in 17.7 s, and **two renders were byte-identical, including one with no network** **[V]**. At CRF 30 an 8-second 1080p clip is 227 KB, about 1.7 MB per minute **[V]**.

**Embedding choice: rendered video is the default.** The live `@hyperframes/player` was tested **[V]**:
- By default it injects its runtime from jsDelivr. It needs an undocumented `runtime-src` attribute to work offline.
- Its scrubber is not keyboard-operable and it has no caption support.
- It costs about 225 KB of gzipped JS per page.

Rendered MP4/WebM with WebVTT captions in our own player gives native keyboard and screen-reader support, captions, zero runtime JS, and frozen deterministic artifacts. Steps are timeline labels (`data-steps`) exported to `steps.json`, so our player can **pause at each step and ask a prediction** before continuing. The live player stays an opt-in for an animation that truly needs live theming.

Authoring rules a later session must follow are in §4.6 and will be copied into `CLAUDE.md` and `animations/README.md`.

### 1.4 YouTube

The container can reach YouTube now that the network is open. Existence is checked with the oEmbed endpoint. Transcripts come from yt-dlp, which needs `--extractor-args "youtube:player_client=web_embedded" --ignore-no-formats-error`, because default clients hit a bot check from this IP **[V]**. The CS50 lecture IDs for Lectures 1–5 exist **[V]**. Lecture 3 and 4 YouTube transcripts match the CS50 CDN caption timings exactly **[V]**. Lecture 5's CDN captions run one hour ahead, so its segments are re-timed from the YouTube transcript when M8/M9 are built.

---

## 2. Architecture

### 2.1 Repository layout

```
PLAN.md  CLAUDE.md  README.md  videos.json
package.json  vite.config.ts  tsconfig.json  playwright.config.ts
content/                         # ← all course text; editable without touching components
  course.yaml                    # module order, ids, hours, success-criteria map
  modules/
    m01-c-in-your-browser/
      module.yaml                # title, hours, outcomes, resources, retrieval sources
      lessons/01-hello-compiled-world.mdx …
      exercises/<exercise-id>/
        exercise.yaml            # kind (ct|fb|pa|ce|md|pr…), hints[3], tests, variant id, solution unlock rule
        starter.c  solution.c  tests.json
        variant/{starter.c,solution.c,tests.json}
      quizzes/{retrieval.yaml,checkpoint.yaml}   # item pools; answers reference generated outputs by sample id
      project/<project-id>/      # README.md, starter/, solution/ (not shipped), check.json, tests/
animations/                      # one self-contained HyperFrames project per animation (§4.6)
  README.md  _shared/  scripts/  a01-press-run/ …
public/
  animations/<id>/{<id>.mp4,<id>.webm,poster.webp,steps.json,<id>.vtt}  # rendered, committed
  downloads/                     # generated project zips
src/                             # app code only
  app/ (routes, layout, theme)   content-runtime/ (MDX components registry, loaders)
  runtime/ (compiler.worker.ts, run.worker.ts, wasi-run.ts, CRuntime.ts, protocol.ts,
            course_rt.c, ubsan_rt.c, leakcheck.h, learnc.h)
  interactions/ (PredictRun, CodeExercise, FixBug, MemoryDiagram, Parsons, CompilerError,
                 StepPredict, NumberDrill, TraceTable, AsmRead, Bench, LocalTask, Quiz, Checkpoint)
  visualizers/ (V1–V10, §7)
  progress/ (store, schema, migrations, export/import, gating, token verify)
  generated/                     # build outputs from tools/ (committed; CI fails if stale)
tools/
  verify/   (samples: native gcc+clang, wasm-in-Node; normalize; diff; asm; generated JSON)
  trace/    (gdb tracer.py, heap_shim.c, valgrind merge)
  check/    (check.mjs + check.h: the local runner shipped in every project)
  exercises/(verify reference solutions pass and starters fail, in browser-equivalent and native runs)
  content-lint/ (word budget, interaction cadence, broken refs, quiz answer refs)
  anim/     (sync-shared, steps extraction, hash-cached render)
  videos/   (oEmbed + transcript verification for videos.json)
  toolchain/(copy and slim @yowasp/clang into dist/toolchain/clang-<ver>/)
e2e/        (Playwright: click through every lesson; axe accessibility checks)
research/   (reports and prototypes from Stage 1; reference only)
```

### 2.2 App

- **Build:** Vite with `@vitejs/plugin-react`. MDX via `@mdx-js/rollup`, with `remark-gfm`, frontmatter, and our own remark plugins:
  - **sample binder:** attaches generated outputs to code fences by `id`;
  - **content lint:** enforces the word budget between interactions.
- **Routing:** React Router (data router) with a configurable `base`. Routes:
  - `/` course map;
  - `/m/:module` module overview, which opens with the retrieval quiz;
  - `/m/:module/:lesson`;
  - `/m/:module/project`;
  - `/m/:module/checkpoint`;
  - `/settings` for theme, export/import and reset.

  Deep links work on GitHub Pages through a `404.html` copy of `index.html`.
- **Lesson UI:** a lesson is a sequence of **cards**. Content cards hold at most about 250 words or one animation or video segment. They alternate with interaction cards, and the "Next" button stays locked until the interaction has been attempted, or passed where required. A side outline shows progress and allows revisiting.
- **Editor:** CodeMirror 6 with `@codemirror/lang-cpp`. Clang diagnostics become inline markers; the browser compiler emits SARIF/parseable output **[V]**. "Esc then Tab" leaves the editor so focus is never trapped. The output pane is a virtualized terminal with ANSI support and a 1 MiB cap **[V]**.
- **Styling:** CSS custom properties with light and dark themes. The default follows `prefers-color-scheme`, and a toggle saves to `localStorage`. CSS Modules; no CSS-in-JS runtime.
- **Accessibility target:** WCAG 2.2 AA.
  - Every interaction is keyboard-operable, including Parsons (select a line, move it with Alt+↑/↓) and the memory diagrams (cells are form fields; arrows are chosen from a target list as well as drawn).
  - ARIA live regions announce run output and test results.
  - `prefers-reduced-motion` swaps animations for step stills.
  - Captions are on by default.
  - axe-core runs in every Playwright test.
- **Responsive:** the editor and output stack vertically on narrow screens. The compiler needs about 250–400 MB of RAM. On devices reporting low memory, the app offers "show stored output" mode instead of compiling.
- **Browser support:** current Chrome, Edge, Firefox and Safari. Compile and run is verified in Chromium **[V]**. Firefox and WebKit are covered by a CI matrix of Playwright smoke tests, since only Chromium exists in this container.

### 2.3 In-browser C runtime

The design was prototyped end to end in Vite + React and verified in Chromium **[V]**. Code is in `research/prototypes/runtime/`.

```
Main thread (React) ── CRuntime
  ├─ compiler.worker (module worker, long-lived): @yowasp/clang, cache-first fetch of the toolchain
  └─ run.worker (module worker, one per run, pre-spawned): browser_wasi_shim + program
        stdout/stderr → batched postMessage (flush at >16 KB, >33 ms, and before every stdin wait)
        stdin → JSPI (await a postMessage) | SharedArrayBuffer + Atomics.wait (if isolated) | pre-filled box
  watchdog: CPU-time budget (paused while waiting for stdin) → worker.terminate()
```

- **Flags (browser):**
  - Compile: `-std=c17 -Wall -Wextra -pedantic -O0 -g -fno-color-diagnostics -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_SIGNAL`.
  - Link: `-lc-printscan-long-double -lwasi-emulated-process-clocks -lwasi-emulated-signal -Wl,-z,stack-size=8388608 -Wl,--max-memory=268435456`.
  - Always linked: `course_rt.c`.
  - Guardrail mode adds `-fsanitize=undefined` plus `ubsan_rt.c`.
  - Exercises from M5 add `-include leakcheck.h`.
- **Lifecycle:**
  - The toolchain is downloaded lazily on the first Run, with a progress bar.
  - It is cached in Cache Storage under a versioned key, giving **0 network requests and about 0.32 s to ready on later visits [V]**.
  - `navigator.storage.persist()` is requested after the first successful compile.
  - An infinite loop is killed at the CPU budget and Stop kills at once. Neither affects the warm compiler **[V]**.
- **Behaviour on the page:**
  - Diagnostics are parsed into editor markers.
  - Traps map to friendly hints with a source line.
  - A multi-file mode (virtual tree of `.c`/`.h` files) supports early multi-file demos and an in-browser `-E/-S/-c/nm/link` Pipeline Explorer **[V]**.
- **Size:** about 24 MB gzip on the first visit, served from GitHub Pages; about 17 MB on hosts that serve brotli **[V]**. The toolchain files are split into chunks of 20 MiB or less at build time and re-joined by the fetch hook, so any static host with per-file limits works.

### 2.4 Content format

Lessons are MDX files. Prose is Markdown; interactions are components whose props point at exercise folders or at verified samples. **No expected output or answer is ever typed by hand.** Answers reference generated data by sample id.

````mdx
---
id: m02-l3-twos-complement
title: Unsigned and two's complement
minutes: 45
---
Short explanation (≤ 250 words)…

```c id=wrap-unsigned predict
#include <stdio.h>
int main(void) { unsigned char c = 250; c += 10; printf("%d\n", c); }
```

<PredictRun sample="wrap-unsigned" kind="output" explain="…why 4…" />

<Parsons exercise="pack-rgba" />
<Animation id="a03-twos-complement-wheel" pauseAt={["negate","wrap"]} />
<YouTube id="SlqjA04_dpk" start={8382} end={8980} pausesEverySec={360} />
````

**Code-fence meta keys:**

| Key | Meaning |
|---|---|
| `id=` | Required for anything that runs |
| `run` / `predict` / `trace` | Run it; ask for a prediction first; produce a stepper trace |
| `stdin=` / `args=` | Input and arguments |
| `expect=` | `success`, `warning`, `compile-error`, `runtime-error`, `exit:N` or `ub` |
| `warn=` | Required warning flags |
| `sanitize=address,undefined` | Native ASan/UBSan run |
| `platform` | Acknowledges an expected wasm32/native difference |
| `predict64="…"` | Optional question for the 64-bit prediction step |
| `files=` | Multi-file sample |
| `timeout=` | Milliseconds |
| `norm=` | Normalisation mode |

**Exercises** live in folders, each with:
- `exercise.yaml` (kind, prompt, three hint tiers, solution-unlock rule, variant id);
- `starter.c`, `solution.c`;
- `tests.json` in the same format as the local runner's `check.json`: I/O cases, `contains`/`matches`, exit codes, and unit tests through a C harness with `-Dmain=learner_main`.

**Quizzes** are YAML item pools. Each item has a type (predict, multiple choice, numeric, order, diagram, compiler-error) and gets its answer from a sample id or an exercise run.

### 2.5 Progress, gating and pedagogy rules

- **Storage:** a versioned schema with migrations, kept in `localStorage`. It holds:
  - completed cards;
  - attempts per exercise (count, last code, time spent);
  - hints viewed;
  - mastery (variant passed);
  - quiz and checkpoint results;
  - completion tokens;
  - a random learner seed;
  - settings.

  Export downloads `c-course-progress-YYYY-MM-DD.json`. Import validates the file, shows a diff ("this file has M1–M4 complete"), and merges or replaces.
- **Gate:** each module unlocks only when the previous module's checkpoint scores 80% or more **and** its project passes.
  - Browser projects pass through the in-browser test runner.
  - Native projects (M6 onward) pass with a **completion token**: `make test` prints the first 8 hex digits of SHA-256 over module id, learner seed, pass bitmap and runner version, and the app recomputes it. It is tamper-evident, not tamper-proof; the honour system is the only option without a backend.
- **Hints:** three tiers. **H1** is a nudge, **H2** names the concept and where to look, **H3** gives partial code.
- **Solution unlock:** requires H3 viewed **and** either 2 substantive attempts (a changed program that was compiled and tested) or 20 minutes of active time. After viewing the solution, the learner **must pass a variant exercise alone** before the skill counts as mastered.
- **Retrieval quiz** at the start of every module: 6–10 items, about 10 minutes. Roughly 40% come from the previous module, 30% from two modules back and 30% from older ones. Missed checkpoint items are re-scheduled. M1 uses a JS diagnostic quiz instead, since there is no earlier module.
- **Checkpoint:** 8–12 items, 30–45 minutes, pass mark 80%. It always includes a write-code item, a fix-a-bug item, a memory-diagram or stepper item, a compiler-message item and one transfer item set in an unfamiliar context. Items are drawn from pools, so retakes get fresh variants.
- **Word budget:** `tools/content-lint` fails the build if any run of prose between interactions exceeds 250 words, or if an animation or video is not followed by an interaction. Video segments longer than about 6 minutes get in-video pause points, each with a prediction question.
- **Analogies:** every JS/browser analogy is a `<Analogy js="…" c="…" breaksDown="…">` callout, so the "where it breaks down" line is structurally required.

---

## 3. Build-time verification pipeline

All commands run in CI (Ubuntu 24.04: gcc 13, clang 18, gdb 15, valgrind 3.22, plus `libclang-rt-18-dev` for clang sanitizers; this container's clang lacks compiler-rt **[V]**). Prototype: `research/prototypes/pipeline/`.

### 3.1 Samples (`npm run verify`)
1. Extract every code fence that has an `id` (an mdast visitor, using the same parser as rendering).
2. **Native:** compile with gcc and clang using `-std=c17 -Wall -Wextra -pedantic -g -O0`.
   - Add `-Werror` unless `expect=warning|compile-error|ub`.
   - Add `-fsanitize=address,undefined -fno-sanitize-recover=all` where `sanitize=` is set.
3. **Run natively under a pty**, because wasm stdout reports itself as a tty, so line buffering matches **[V]**. Use the given stdin and args, a timeout, and a byte cap.
4. **Browser toolchain in Node:** compile with the same `@yowasp/clang` and flags as the app, then run under the same WASI layer.
5. **Normalise:** addresses become `<addr1>…` in order of first appearance, so pointer equality survives; `(nil)`/`0` become `<NULL>`; PIDs and temp paths are replaced **[V]**. A separate "display" rendering rebases address clusters, so lessons can show realistic addresses that are stable across builds **[V]**.
6. **Check:** `expect` must hold. gcc and clang must agree unless the sample is `platform` or `ub`. Diagnostics are compared by (line, severity, normalised flag), not raw text **[V]**.
7. Write `src/generated/samples/<module>.json` holding normalised and display stdout/stderr, exit status or signal, diagnostics per compiler, and sanitizer summaries.
8. Results are content-hash cached. The key covers code, meta, compiler versions and the verifier's own source **[V]**.

### 3.2 The 64-bit vs browser difference check (automatic)
- Any sample whose normalised **browser** output differs from the **native gcc** output is **flagged automatically**. If the author has not marked it `platform`, the build fails and the error message shows the diff. Nothing slips through silently.
- For every flagged sample, the lesson renders **both results**: "Your browser (wasm32)" and "64-bit Linux/macOS (stored)".
- If the diff involves derivable quantities (`sizeof`, type limits, struct layout or padding; the verifier tags diff lines from known patterns, and authors can add `predict64`), the learner **predicts the 64-bit value before it is revealed**.
- **Editing a flagged sample:** the editor tracks a hash of the original source. As soon as the code changes, the stored 64-bit panel is replaced by "Your edit changes this program, so the stored 64-bit output no longer applies. Run it locally (M6 shows how) to see the native result."
- **Platform-specific items** (`char` signedness on aarch64 Linux, `long` = 4 on native Windows MSVC, `long double` = 8 on Apple arm64) are tagged. A **macOS GitHub Actions job** re-runs `platform` samples with Apple clang so those outputs are real too, instead of written from memory.

### 3.3 Other generators
- **Assembly:** `-S -O0/-O1 -fcf-protection=none` listings for x86-64 (gcc and clang) and arm64 (`clang -target aarch64-linux-gnu` and `arm64-apple-macos`), with source-line mapping, for V7 and M10.
- **Traces** (`trace` samples): gdb-Python stepping with a `--wrap=malloc/free` shim records frames, in-scope locals (name, type, address, size, value), globals, typed heap blocks, pointer targets (local/global/heap/freed), return values and stdout. An optional valgrind pass adds exact "uninitialised" bits and use-after-free errors. Measured at about 0.2 s per program and 1–2 KB gzip per trace **[V]**. Traces drive V3/V4 and the memory-diagram exercises, so diagram answers are real too.
- **Exercises** (`npm run verify:exercises`): every reference solution **passes** its tests and every starter **fails** at least one. Each is checked in the browser toolchain (Node) and natively for browser exercises, and natively with ASan and leak checks for projects. Each variant is checked the same way. Negative tests must supply stdin and assert on output, after a starter once "passed" by accident during prototyping **[V]**.
- **Quizzes:** every item's answer reference must resolve to a generated output. The build fails on dangling references.
- **Event-loop oracle (M8):** expected orders come from running the equivalent JS in Node.

### 3.4 Browser checks
- `npm run e2e`: Playwright opens **every lesson** and completes every interaction with the generated answers:
  - predicts, then runs;
  - submits the reference solution to code exercises;
  - checks that the hint and solution gates behave;
  - fills the diagrams;
  - passes the checkpoint;
  - verifies that the next module unlocks;
  - runs axe.
- A Chromium full run happens per change; Firefox and WebKit smoke tests run in CI.

### 3.5 Per-module definition of done
1. `npm run verify`: all samples compile cleanly with `-std=c17 -Wall -Wextra -pedantic`, plus ASan where relevant, except deliberate error demos. Outputs are regenerated. No unacknowledged native/wasm diffs.
2. `npm run verify:exercises`: solutions pass, starters fail, and variants pass.
3. `npm run lint:content`: word budget, interaction cadence, references and analogy blocks.
4. `npm run anim:check`: `hyperframes lint` and `check --strict` pass; renders are up to date, with a hash manifest.
5. `npm run videos:check`: oEmbed OK and every segment's start and end appear in the transcript.
6. `npm test` (unit) and `npm run e2e` (click-through + axe).
7. Project download built; `check.mjs` passes on the reference and fails on the starter, on Linux; the macOS CI job runs where relevant.

---

## 4. Local toolchain, projects and animations

### 4.1 Local setup module (M6)
- **macOS:** `xcode-select --install`, giving Apple clang, lldb and `leaks`. No gdb or valgrind on Apple Silicon. LeakSanitizer is unsupported there, so the runner uses `leaks --atExit`.
- **Windows:** `wsl --install`, then in Ubuntu `sudo apt install build-essential gdb valgrind`. Native Windows compilers are not supported, but the course notes MSVC's 4-byte `long`.
- **Editor:** VS Code + clangd + CodeLLDB. The plain terminal works too.
- **Doctor:** `doctor.sh` prints the architecture, compiler and `sizeof` table, builds hello with the strict flags, runs an ASan smoke test, and prints a token the app accepts.

### 4.2 Project downloads and the `check.mjs` runner
Each project zip contains `README.md`, starter files, a `Makefile` (Make-3.81-safe for macOS), `check.json`, `tests/`, and the shared `check.mjs`.

`check.mjs` is single-file, zero-dependency and Node 18+. On Linux it scored a reference solution 9/9 and the buggy starter 2/9, with readable messages **[V]**. What it does:
- Finds a compiler: `$CC`, then `cc`, `clang`, `gcc`.
- Builds plain and sanitized variants lazily.
- Runs I/O tests and unit tests (a C harness linking the learner's file with `main` renamed).
- Memory checks by platform:
  - ASan + UBSan, with LSan on Linux;
  - `leaks --atExit` on macOS;
  - valgrind on Linux when no sanitizer runtime exists.
- Reports clearly, including the first differing character and plain-English signal explanations.
- Prints the completion token.

### 4.3 Helper header
`learnc.h` is our own MIT header. libcs50's licensing is ambiguous (BSD-3 in the file header, GPL-3.0 in the repo **[V]**), so we don't ship it. It provides:
- `int get_int(const char *prompt)`, `long long get_ll(...)`, `double get_double(...)` and `const char *get_line(...)`. They re-prompt on bad input and exit on EOF.
- A seeded PRNG.

The source is visible from day one. Learners replace `get_line` with their own `realloc` version in M5.

### 4.4 Licensing guard
- Every spec, starter file and dataset is original.
- Public-domain texts come from Project Gutenberg, images are CC0, and the word list will be permissively licensed (to be confirmed when M9 is built).
- CS50 problem names are referenced only for parity mapping. Embedding CS50 lectures on YouTube is fine.
- Self-hosted toolchain notices go on an "About / Licenses" page: LLVM Apache-2.0 with LLVM exception, wasi-libc, browser_wasi_shim, HyperFrames Apache-2.0, GSAP standard no-charge licence (build-time only, since MP4s ship no GSAP), and the OFL fonts.

### 4.5 YouTube embeds
`videos.json` lists, per entry:
- `id`, `title` (from oEmbed), `channel`;
- `module`, `lesson`;
- `start` and `end` in seconds;
- `anchorQuotes`: transcript lines at the start and end;
- `pausePoints`;
- `why`: why this segment beats what the app can do;
- `verifiedAt`.

`tools/videos` re-checks oEmbed and that the anchor quotes occur at those times in the yt-dlp transcript. The `<YouTube>` component uses `https://www.youtube-nocookie.com/embed/ID?start=S&end=E` behind a click-to-load facade (privacy and performance), shows a transcript excerpt, and is always followed by an interaction.

### 4.6 Animations (HyperFrames)

**Layout.** `animations/aNN-topic/` is one self-contained HyperFrames project:
- a thin root `index.html`;
- one sub-composition per scene in `compositions/`;
- `index.motion.json` (timing assertions);
- `captions.json` → `.vtt`;
- vendored GSAP and woff2 fonts synced from `_shared`, since paths may not climb out of the project.

**Rules, enforced by lint/check or by convention:**
- One paused GSAP timeline per composition, registered last with the `window.__timelines ||= {}` guard.
- `fromTo` only.
- Step labels mirrored in `data-steps`.
- Animate transforms, opacity, colours and SVG stroke offsets only.
- No clocks, `Math.random`, network or CDN.
- Fonts via `@font-face` from local files.
- Text 24 px or larger at 1080p, kept inside the title-safe area, with WCAG AA contrast.
- Captions are a sidecar file, never burned in.
- The skills' interactive and online steps (intent interview, `usage`, `publish`, `auth`, `skills update`) are skipped in this repo.
- Environment: `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_BROWSER_PATH=<pinned chromium>`.

**Pipeline.** `npm run anim:render` does a hash-cached render (project, CLI version, browser and flags) to MP4 (H.264, CRF 30) plus WebM (VP9, for browsers without H.264), a `poster.webp`, step stills (for reduced motion), `steps.json` and the VTT file. Renders are committed: about 1–2 MB per animation, roughly 40–60 MB for the whole course.

**`<Explainer>` player.**
- Native `<video>` with captions on.
- Step chips.
- Pause-at-step prediction prompts.
- Transcript.
- Keyboard controls.
- Reduced-motion still sequence.

**Palette.** Animations use a theme-neutral "stage" palette that reads well in both app themes. Light and dark variants can be rendered from one source through composition variables if wanted **[V]**.

### 4.7 Hosting and deploy
- A GitHub Actions workflow runs: verify (cached) → build → copy and slim the toolchain into `dist/toolchain/clang-<ver>/` → deploy to Pages.
- The site is host-agnostic: no headers required, chunked toolchain, relative base path.
- GitHub Pages limits: 1 GB site, about 100 GB/month soft bandwidth. That is roughly 4,000 first-time toolchain downloads a month; repeat visits are served from cache **[DOCS]**.
- Cloudflare Pages or Netlify would serve brotli (about 17 MB) and allow headers. They are a drop-in move if traffic grows.

---

## 5. Interaction types (components)

| Code | Component | What the learner does | Checked against |
|---|---|---|---|
| PR | `PredictRun` | Commits a prediction (output text, value, multiple choice, or crash / compile error / runs) **before Run unlocks**, then sees the result and an explanation of the mismatch | Generated sample output (native and/or browser, labelled) |
| CT | `CodeExercise` | Writes code against automated tests in the browser | `tests.json` through the in-browser runner |
| FB | `FixBug` | Gets a symptom report plus a broken program; reproduces the bug, fixes it, and passes the tests | `tests.json` (the starter is verified to fail) |
| MD | `MemoryDiagram` | Fills in stack frames, addresses, values and pointer arrows (drawn, or picked from a list for keyboard users) | gdb trace at a given step |
| PA | `Parsons` | Reorders scrambled lines (with distractors and optional indentation) | Accepted orderings, then compile and test |
| CE | `CompilerError` | Reads a real diagnostic from clang 22 (browser), gcc 13 (WSL) or Apple clang, or a real linker, sanitizer or valgrind report; answers which line, what is wrong and which stage, then fixes it | Stored per-compiler output |
| SP | `StepPredict` | Predicts the next state of the stack/heap stepper (or CPU or cache) before stepping | Trace JSON / simulator |
| NP | `NumberDrill` | Conversions in the number playground | Computed |
| TT | `TraceTable` | Fills variable values per iteration | Generated trace |
| AS | `AsmRead` | Matches assembly to C, predicts register values | Generated listings and traces |
| BENCH | `Bench` | Predicts relative cost, then measures | Pipeline runs (ordering, never absolute times) |
| LT | `LocalTask` | Does native work (debugger, sanitizer, project) and pastes the completion token | Token recomputation |

**Rules:**
- Address values are never asked for, only relationships and order.
- **UB is never a prediction answer.** Instead the question is "what will UBSan/ASan report?", answered from the stored native report.
- Where browser and native differ, the prediction is tagged with the platform it refers to.

---

## 6. Course outline

**Rhythm:** each lesson is 30–60 minutes of 3–6 cards. The module time estimates below include lessons, problem sets, the project, variants, the retrieval quiz and the checkpoint, at 5 h/week.

**Success criteria (SC):**
- SC1: source → process
- SC2: memory layout
- SC3: pointers, arrays, strings, structs, heap
- SC4: debugger and sanitizers
- SC5: lists, stacks, queues, hash tables, BSTs, tries
- SC6: Big-O, sorting and searching
- SC7: bin/hex, two's complement, floats, endianness, bitwise
- SC8: CPU, registers, caches, access patterns
- SC9: reading assembly
- SC10: syscalls and the OS
- SC11: multi-file projects, Make, headers, ABI

**Coverage levels:** I = introduced, D = developed, A = assessed.

| # | Module | Runs in | Hours | Weeks | Cumulative week | CS50x |
|---|---|---|---|---|---|---|
| 1 | C in Your Browser: From JS to C | browser | 10 | 2 | 2 | W1 |
| 2 | Bits, Bytes & Numbers | browser | 10 | 2 | 4 | W1 (Credit), W4 (hex) |
| 3 | Arrays, Strings & the Command Line | browser | 10 | 2 | 6 | W2 |
| 4 | Algorithms, Recursion, Structs & Big-O | browser | 17.5 | 3.5 | 9.5 | W3 |
| 5 | Pointers & Dynamic Memory | browser + both | 15 | 3 | 12.5 | W4 (a) |
| 6 | Going Native: Toolchain, Debugger, Sanitizers, Make | native | 10 | 2 | 14.5 | W2 (compile/debug), W4 (Valgrind) |
| 7 | Structs, Files & Binary Formats | native (+ browser snippets) | 15 | 3 | 17.5 | W4 (b) |
| 8 | Data Structures I: Lists, Stacks, Queues, Trees | native (+ browser visualizers) | 15 | 3 | 20.5 | W5 (a) |
| 9 | Data Structures II: Hash Tables, Tries & Speller | native (+ browser visualizers) | 15 | 3 | **23.5 ← CS50 C parity** | W5 (b) |
| 10 | Inside the CPU: Instructions, Registers & Assembly | native + browser | 15 | 3 | 26.5 | — |
| 11 | Linking, Loading, Libraries & the C ABI | native | 10 | 2 | 28.5 | — |
| 12 | Memory Hierarchy & Performance | native + browser simulator | 12.5 | 2.5 | 31 | — |
| 13 | The Operating System (POSIX) | native | 15 | 3 | 34 | — |
| Cap | Build `malloc` (Track A) or Speller Pro (Track B) | native | 25 | 5 | 39 | — |
| | **Total** | | **195 h** | **39 wk** | | |

**Fast lane (about 186 h):** skips bitlab-lite, the "implement all three sorts" extension, the Runoff warm-up, the TinyCPU problem set, cachesim part C and `ls-lite`. Two optional flex weeks are recommended.

**Reading the module tables:** interaction codes are from §5; visualizers are V1–V10 (§7); animations are A1–A23 (§8); YouTube segments are Y1–Y13 (§9).

### M1. C in Your Browser: From JS to C (10 h, 2 weeks, browser)
**Why:** the learner writes real C on day one with nothing to install. Real clang diagnostics replace the "types are labels" habit from TypeScript with "types are memory layouts."

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 1.1 | Hello, compiled world (40m) | `main`, `#include`, `printf`, exit status; ahead-of-time compiling vs JIT; what Run does | PR (escape sequences), CE (missing `#include`) | **A1**, V7 (live) |
| 1.2 | Types are layouts (45m) | `int`/`char`/`double`/`bool`; format specifiers; `7/2`, `-7/2`; `double avg = 7/2` compiles silently | PR, CE (`-Wformat`), NP teaser | V1 |
| 1.3 | Control flow (40m) | if, `switch` fall-through, while/for, the do-while re-prompt idiom; `=` vs `==` (`-Wparentheses`) | PA, FB (off-by-one pyramid), PR | — |
| 1.4 | Functions and scope (45m) | Prototypes (no hoisting), pass by value, block scope, uninitialised locals, no closures; `enum`/`#define` | PR ("does the caller's variable change?"), **MD (fill in caller and callee frames for `add(x, y)`)**, CT `max3` | V3 (first stepper trace) |
| 1.5 | Input without magic (40m) | `learnc.h` (source visible); `scanf` pitfalls | CT Hello-It's-Me (empty name re-prompts) | — |
| 1.6 | Read the compiler like a linter (35m) | Fix the first error first; warnings vs errors; a missing `printf` argument (browser vs native output); four-stage overview | CE ×5, PR [both] | Y3 (with pauses) |

- **Problem set:** Hello, World; Hello, It's Me; Mario-less (warm-up); **Cash** (cents, positive int, greedy). The Cash variant shows greedy failing for coins {1, 3, 4}.
- **Project P1, Mario-more (browser runner).** It checks:
  - re-prompting on 0, 9, −1, `abc`, empty input and `42x`;
  - byte-exact output for heights 1–8, including the gap and no trailing spaces;
  - a clean `-Werror` build.
- **Checkpoint:** 3 PR, 2 CE, 1 PA, 1 MD, 2 CT. Transfer FB: a re-prompt loop that accepts 0.
- **Retrieval:** a JS diagnostic (`typeof null`, `0.1+0.2`, `Number.MAX_SAFE_INTEGER`, hoisting).
- **Resources:** Beej's Guide to C (v0.11) ch. 2–4; K&R 2e §1.1–1.10.
- **SC:** SC1 (I), SC3 (I).
- **Analogies:**

| JS/TS | C | Where it breaks down |
|---|---|---|
| `let x: number` | `int x` | TS types are erased; C types decide size, instructions and silent truncation |
| `console.log` | `printf` | A mismatched format is UB, not coercion |
| Hoisting | — | C needs a prototype before the call |
| `let` scope | block scope | C has no TDZ and no `undefined`; an uninitialised local is garbage |

- **Stage 2 build note:** M1 ships with **at least one of every interaction type** (PR, CT, FB, MD, PA, CE, plus SP via the 1.4 trace) and animation **A1**.

### M2. Bits, Bytes & Numbers (10 h, 2 weeks, browser)
**Why:** JS hides everything behind one IEEE double. Pointers, files, hashing and assembly all assume fluency with widths, signedness and bytes. CSS colours and TypedArrays make good hooks.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 2.1 | Binary and hex (40m) | Place value, nibbles, `#RRGGBB`, `%x`; `0b101` is not C17 (pedantic) | NP, PR, CE | V1, Y2 |
| 2.2 | Widths and `sizeof` (40m) | `<stdint.h>`, `size_t`; size table for wasm32, x86-64 and arm64 | PR (platform-tagged; 64-bit predict step) | V1, V2 |
| 2.3 | Unsigned and two's complement (45m) | Unsigned wrap is defined, signed overflow is UB; casts; `-1 < 0u`; guardrail mode | PR, NP, CE (`-Wsign-compare`), FB (`unsigned i >= 0` loop) | **A3**, V1 |
| 2.4 | Bitwise operators and masks (45m) | Masks, flags, RGBA packing; shifts and UB | CT pack/unpack, FB | V1 |
| 2.5 | Floating point (45m) | IEEE fields; `0.1+0.2`; `16777217.0f`; epsilon compares; NaN and Inf; C `round` vs `Math.round` | NP, PR | **A4**, V1, Y1 |
| 2.6 | Characters and encodings (40m) | ASCII; `char` signedness varies; UTF-8 vs UTF-16 lengths; byte order in the viewer only | PR, MD (bytes) | V2 |

- **Problem set:**
  - bitlab-lite: 6 operator-restricted puzzles, tested exhaustively, with a token scanner enforcing the allowed operators.
  - `hexcolor`: parse and blend colours.
- **Project P2, Credit (Luhn).** It checks 20+ card cases, re-prompting, and **identical output on wasm32 and native**, which catches a learner who relied on `long`.
- **Checkpoint:** 4 NP/PR conversions, 2 PR (overflow, float), 1 MD, 2 CT. Transfer: RGB565 packing.
- **Retrieval:** M1.
- **Resources:** CS:APP 3e §2.1–2.4; Beej ch. 24 "Bitwise Operations" and ch. 37 "Fixed Width Integer Types".
- **SC:** SC7 (I→A), SC3 (D).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| `x\|0`, `x>>>0` | `int32_t` / `uint32_t` | C signed overflow is UB |
| TypedArrays | fixed-width types | C has no bounds checks |
| `DataView` | byte order | `DataView` defaults to big-endian |

### M3. Arrays, Strings & the Command Line (10 h, 2 weeks, browser)
**Why:** the first module with no safety net. Strings are NUL-terminated bytes, `==` compares addresses, and the learner builds real command-line tools.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 3.1 | Arrays (40m) | Contiguous, no `.length`, no bounds checks; `sizeof a / sizeof a[0]`; decay in parameters | PR [both], MD, FB | V2 |
| 3.2 | Strings are char + NUL (45m) | `"hello"` is 6 bytes; `<string.h>`; `strlen` is O(n); `strcmp` vs `==`; `snprintf` | PR, MD | V2, Y4 |
| 3.3 | Character arithmetic (35m) | `<ctype.h>` (with the `unsigned char` cast), modular rotation | CT `rotate()`, PR | V1 |
| 3.4 | Text statistics and rounding (35m) | Counting letters, words and sentences; Coleman–Liau; `round` and `-lm` | CT, PR | — |
| 3.5 | `argc`/`argv` and exit codes (40m) | `strtol` vs `atoi`; return codes | CT (args panel), FB (missing `argv[1]`) | — |
| 3.6 | 2D arrays and defensive strings (40m) | Row-major order; arrays of strings; buffer overflow; `fgets` | MD, FB (missing NUL), CE | V2 |

- **Problem set:** Scrabble; Readability; Caesar (warm-up).
- **Project P3, `cipher`** (Caesar + Substitution + `-d` to decrypt). It checks:
  - usage errors and exit codes;
  - key validation (26 unique letters);
  - case preservation;
  - **decrypt(encrypt(x)) == x on 200 random strings**.
- **Checkpoint:** 3 PR [both], 1 MD, 2 CE, 2 CT, 1 FB. Transfer: Vigenère.
- **Retrieval:** M2, M1.
- **Resources:** Beej ch. 6 "Arrays", 7 "Strings" and 18 "The Outside Environment"; Effective C 2e ch. 7.
- **SC:** SC3 (D), SC7 (D).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| `Array` | C array | Fixed size, no `.length`; out of bounds is garbage, not `undefined` |
| `string` | `char[]` | Mutable bytes; length by scanning |
| `process.argv` | `argv` | `argv[0]` is the program |

### M4. Algorithms, Recursion, Structs & Big-O (17.5 h, 3.5 weeks, browser)
**Why:** it gives the vocabulary of cost behind `.sort()` and `.includes()`, shows the real call stack, and teaches the graph reasoning Tideman needs.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 4.1 | Search and Big-O (45m) | Linear vs binary search; O/Ω/Θ; overflow-safe midpoint | PR (comparison counts), TT, FB | V9 |
| 4.2 | Simple sorts (50m) | Bubble, selection, insertion; invariants; stability | PA, TT | V9 |
| 4.3 | Recursion and the call stack (50m) | Base cases, frames, depth limits (browser vs native) | SP, PR [both] | **A5**, V3 |
| 4.4 | Merge sort (50m) | Divide and conquer, n log n, merge buffer | CT `merge_sort`, PR | **A6**, V9, Y5 |
| 4.5 | Structs, first contact (40m) | `struct`, `typedef`, arrays of structs, designated initializers; **assignment copies** | PR (the copy surprise) | V3 |
| 4.6 | Measuring growth (35m) | Doubling experiments, log–log plots; coarsened browser timers | BENCH, PR | V9 |
| 4.7 | Graphs for elections (45m) | Adjacency matrix, DFS cycle detection, ranked pairs | TT, CT `creates_cycle` | V9 (graph mode) |

- **Problem set:**
  - **Which Sort?**: identify three mystery binaries by timing, **then implement all three** and submit a doubling table.
  - Plurality.
  - Runoff (warm-up).
- **Project P4, Tideman (required).** A hidden harness unit-tests `vote`, `record_preferences`, `add_pairs`, `sort_pairs`, `lock_pairs` (direct, 3-cycle, indirect and multi-cycle cases) and `print_winner`, plus a 9-candidate × 1000-voter time limit.
- **Checkpoint:** 4 Big-O classifications, 2 TT, 1 SP, 1 PA, 2 CT (including a new problem), 1 FB. Transfer: choose an algorithm from constraints.
- **Retrieval:** M3, M2, M1.
- **Resources:** CLRS 4e ch. 2 "Getting Started" and ch. 3 "Characterizing Running Times"; Erickson *Algorithms* ch. 6 "Depth-First Search".
- **SC:** SC6 (A), SC2 (I), SC3 (D).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| "Maximum call stack size exceeded" | stack overflow | Natively it is SIGSEGV; the limit is bytes, not frames |
| Objects by reference | structs | C copies the whole struct |
| `performance.now()` | timers | Browser timers are coarsened |

### M5. Pointers & Dynamic Memory (15 h, 3 weeks, browser + [both])
**Why:** the core skill gap. In wasm32, memory really is one `ArrayBuffer` and a pointer really is a byte offset, so the concept is concrete. Stored native results show what a 64-bit OS does differently.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 5.1 | Addresses (40m) | `&`, `%p`; memory as one big `Uint8Array` | PR (relationships), MD | V2 |
| 5.2 | Dereferencing and NULL (45m) | `*`, typed pointers; NULL behaves differently in the browser and natively; guardrail mode | PR [both], MD | V4, Y6 |
| 5.3 | Swap and out-parameters (40m) | `swap`; why `scanf` needs `&`; returning several values | SP, FB (broken swap) | **A7**, V3, V4 |
| 5.4 | Pointer arithmetic and arrays (45m) | `a[i] ≡ *(a+i)`, decay, one past the end; view a `uint32_t` byte by byte (endianness in code) | PR, PA | V2, V4 |
| 5.5 | Code, static, stack, heap (45m) | Place declarations in regions; lifetimes; returning a local's address; native vs wasm32 layout order | MD, PR [both] | **A8**, V3, Y7 |
| 5.6 | `malloc`/`calloc`/`realloc`/`free` (50m) | `sizeof *p`, NULL checks, ownership, double free, leaks; `leakcheck.h` reports | FB, SP, CE (leakcheck) | V3 (heap) |
| 5.7 | Strings revisited, `char **` (45m) | Literals are read-only natively; copying; arrays of pointers; `argv` layout | PR [both], MD | V4 (argv mode) |
| 5.8 | `const` and ownership (30m) | `const T*` vs `T* const`; documenting who frees | PA, CE | — |

- **Project P5, `libstr`:** `str_dup`, `str_concat_alloc`, `str_split`, `str_join`, `str_trim`, `str_replace_all`, `strv_free`, and `get_line(FILE*)` with `realloc` doubling, which replaces the helper. It checks:
  - unit tests and 1000 randomized property tests;
  - **zero leaks, overflows and invalid frees under `leakcheck.h`**;
  - the UB-trap build;
  - no `strdup` (checked via `nm`).

  In M6 the same tests rerun natively under ASan.
- **Checkpoint:** 3 MD, 2 SP, 2 PR [both], 1 FB, 2 CT. Transfer: reverse the words in a string in place using pointers.
- **Retrieval:** M4, M3, M2.
- **Resources:** K&R 2e §5.1–5.6; Beej ch. 5, 11 and 12.
- **SC:** SC2 (A), SC3 (A), SC4 (I), SC7 (D).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| Object references | pointers | Pointers support arithmetic, can dangle, and can point at ints |
| `WebAssembly.Memory` | address space | Exactly true in wasm32; native memory is 64-bit virtual with protected pages |
| GC | `free` | Opposite definition of a leak |
| `push` growth | `realloc` | `realloc` can move the block |

### M6. Going Native: Toolchain, Debugger, Sanitizers & Make (10 h, 2 weeks, native)
**Why now:** the M5 bugs are invisible in the browser. Locally, ASan names the file and line. The learner installs a toolchain at the moment they want one.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 6.1 | Install and doctor (60m) | macOS CLT / WSL + build-essential + gdb + valgrind; VS Code + clangd; `doctor.sh`; Apple Silicon is arm64 | LT (doctor token) | **A9** |
| 6.2 | Compiling by hand (40m) | `-o -g -O0/-O2 -Werror`; `-lm` differences; rerun `sizes.c` and predict 8-byte `long` | PR [both] | **A2**, V7 |
| 6.3 | Debugger (60m) | lldb and gdb side by side: break, step, next, finish, bt, print, watch, x | FB (segfault → `bt`), LT, SP | V3 bridge, Y8 |
| 6.4 | Sanitizers (50m) | ASan, UBSan; LSan on Linux; `leaks --atExit` on macOS; rerun P5 | CE (real reports) | — |
| 6.5 | Valgrind on Linux/WSL (30m) | Definitely vs indirectly lost; invalid read; uninitialised jump | CE | Y9 |
| 6.6 | Two files and a Makefile (45m) | `.h`/`.c`, include guards, `extern`/`static`; a Make-3.81-safe Makefile; linker errors | PA, CE, CT (split `cipher`) | V7 |

- **Project P6, Bug Hunt:** six programs with symptom-only reports. For each the learner reproduces, locates, fixes and writes up the bug in `diagnosis.md`. It checks:
  - zero sanitizer reports;
  - Valgrind or `leaks` clean;
  - the diagnosis names the right file and line;
  - P5 passes under ASan;
  - token printed.
- **Checkpoint:** 3 CE (ASan, UBSan, Valgrind), 2 PA (debugger commands), 1 LT, 2 PR, 1 MD. Transfer: classify failures by build stage.
- **Retrieval:** M5, M4, M2.
- **Resources:** Effective C 2e ch. 11 "Debugging, Testing, and Analysis"; GNU Make manual ch. 2 "An Introduction to Makefiles".
- **SC:** SC4 (A), SC1 (D), SC11 (I).
- **Analogies:**

| JS / tooling | C tooling | Where it breaks down |
|---|---|---|
| DevTools Sources | lldb/gdb | No hot reload; `<optimized out>` |
| Source maps | `-g` | You must rebuild |
| npm scripts | Make | Timestamp-driven dependency graph; tabs matter |
| `import` | `#include` | Textual paste |

### M7. Structs, Files & Binary Formats (15 h, 3 weeks, native; snippets and BMP preview in browser)
**Why:** real data has byte-level layouts. Image filters give this visual audience instant feedback.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 7.1 | Structs in depth (40m) | `->`, struct pointers, compound literals, passing by value vs pointer | PR, CT | V4 |
| 7.2 | Alignment and padding (45m) | `offsetof`, reordering fields, `_Alignof`; why you shouldn't `fread` into a padded struct | PR [both] (3 targets, 64-bit predict step), MD (padding bytes) | V2 (target toggle) |
| 7.3 | Text streams (40m) | `FILE*`, modes, `perror`/`errno`, stderr, exit codes | CT `cp`, FB (unchecked `fopen`) | Y10 |
| 7.4 | Binary I/O (45m) | `fread`/`fwrite` semantics, short reads, the `while(!feof)` bug; WAV header; scale and clamp | PR, FB, CT Volume | V2 (WAV overlay) |
| 7.5 | Images as pixel arrays (50m) | BMP headers, BGR, bottom-up, row padding; heap 2D arrays; kernels | CT, PR (blur value), FB (in-place blur) | **A10**, V2, BMP preview |
| 7.6 | Signatures and recovery (35m) | JPEG signatures, 512-byte blocks, state machine, a mini `xxd` | CT | **A11**, V2 |

- **Problem set:** Volume (sample-exact output, including clipping).
- **Project P7, Media Lab:** **all five filters** (grayscale, sepia, reflect, blur, edges) plus **Recover**. It checks:
  - per-function tests on tiny images and whole-image byte comparison;
  - a 4000×3000 image runs without stack overflow;
  - a synthetic card built from CC0 images, with SHA-256 per recovered file;
  - ASan and leak checks clean;
  - all files closed.
- **Checkpoint:** 2 PR, 1 MD (a padded BMP row), 1 V2 header task, 2 CE, 2 CT (crop, flip), 1 FB. Transfer: parse an unseen header spec.
- **Retrieval:** M6, M5, M3, M2.
- **Resources:** Beej ch. 9 "File Input/Output" and ch. 20 "structs II"; Effective C 2e ch. 8 "Input/Output".
- **SC:** SC3 (A), SC7 (A), SC4 (D), SC10 (I).
- **Analogies:**

| JS / Web | C | Where it breaks down |
|---|---|---|
| TS interface | struct | Fixed layout with padding |
| `DataView` | reading fields | `fwrite` of a struct is not portable |
| `ImageData` | BMP pixels | `ImageData` is RGBA, top-down and clamped; BMP is BGR, bottom-up, padded, and `uint8_t` wraps |

### M8. Data Structures I: Lists, Stacks, Queues, Trees (15 h, 3 weeks; projects native, visualizers in browser)
**Why:** learners use `push`, `shift` and `Map` daily without knowing the cost. Building the structures, and an event loop out of them, turns pointer skill into fluency.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 8.1 | ADTs, function pointers, generic code (45m) | Opaque types, create/destroy pairs; function pointers; `qsort`/`bsearch` comparators | CT, FB (`return a-b` overflow), CE | — |
| 8.2 | Dynamic arrays (35m) | Doubling `realloc`, amortised O(1); the `p = realloc(p, n)` leak | PR, FB | V3 |
| 8.3 | Singly linked lists (60m) | Insert at head, tail and sorted; delete; free with a temp pointer; `node **pp` | MD, SP, FB (use-after-free) | **A12**, V4, Y11 |
| 8.4 | Stacks and queues (40m) | Array stack, circular buffer, linked versions | CT, PR | V4 |
| 8.5 | Binary search trees (50m) | Insert, search, delete; traversals; height; degenerate trees; post-order free | SP, PA, CT | V4, Y12 |
| 8.6 | Recursive ownership (30m) | Allocating and freeing a family tree | CT | V3 |

- **Problem set: Inheritance.** 1000 seeded runs check the structure and alleles, with zero leaks.
- **Project P8, `eventloop`.** Scripts such as `setTimeout A 10`, `then B`, `queueMicrotask C` and `log D` are simulated with a circular-buffer macrotask queue, a linked-list microtask queue and a timer BST. It checks:
  - the order matches **real Node output, generated at build time**;
  - unit tests for each module;
  - 10⁵ events within a time limit;
  - ASan clean.
- **Checkpoint:** 2 MD, 1 SP, 2 CT, 1 FB, 1 PR. Transfer: a complexity table for a new ADT.
- **Retrieval:** M7, M5, M4, M6.
- **Resources:** K&R 2e §5.11 "Pointers to Functions" and §6.5 "Self-referential Structures".
- **SC:** SC5 (A: lists, stacks, queues, BST), SC3 (A), SC6 (D), SC4 (D).
- **Analogies:**

| JS / React | C | Where it breaks down |
|---|---|---|
| React Fiber `child`/`sibling`/`return` | linked nodes | No GC |
| `arr.shift()` | queue | A naive shift is O(n) |
| `arr.sort(cmp)` | `qsort` | `void*`, no closures, no stability guarantee |
| Event loop | P8 | Rebuilt from your own queues |

### M9. Data Structures II: Hash Tables, Tries & Speller (15 h, 3 weeks; project native)
**Why:** `Map`, `Set` and object keys are hash tables these learners have never seen inside. Speller is CS50's showcase problem set; ours adds a performance gate. **CS50x C parity is reached here.**

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 9.1 | Hashing (40m) | djb2, FNV-1a; uniformity; mask vs `%`; case folding; the `unsigned char` cast | PR (bucket indices), CT | V5 |
| 9.2 | Separate chaining (45m) | Load factor, resize and rehash, key ownership | CT, SP | **A14**, V5, Y13 |
| 9.3 | Open addressing (40m) | Linear probing, tombstones, clustering | SP | V5 (probing mode) |
| 9.4 | Tries (40m) | 27-way nodes; memory cost (computed per target by the pipeline); O(L) lookup | MD, PR | V5 (trie mode) |
| 9.5 | Measuring honestly (40m) | `clock_gettime`, `getrusage`, `-O2`, warm-up, median, a counting allocator | BENCH | — |
| 9.6 | Speller design studio (35m) | The `load`/`check`/`size`/`unload` contract; apostrophes; POSIX vs C17 functions | PA, CT | — |

- **Problem set:** word-frequency counter (hash map plus top-k with `qsort`).
- **Project P9, Speller** (hash table required; trie optional). It checks:
  - output identical to the reference on 10+ public-domain texts × 2 dictionaries;
  - `unload` frees everything;
  - **`check` time at least k× faster than a provided sorted-array + `bsearch` baseline** on the learner's machine;
  - the report file parses.
- **Checkpoint:** a V5 collisions-and-resize prediction, CT (open-addressing set with delete), FB (negative bucket index from signed `char`), CE (ASan heap overflow), PR.
- **Retrieval:** M8, M7, M2, M4.
- **Resources:** K&R 2e §6.6 "Table Lookup".
- **SC:** SC5 (A: hash tables, tries), SC6 (A), SC4 (A).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| `Map`/`Set` | hash table | You choose the hash, collisions, resizing and key ownership; there is no insertion order |

### M10. Inside the CPU: Instructions, Registers & Assembly (15 h, 3 weeks; native + browser TinyCPU and static listings)
**Why:** the learner sees what their C becomes. Mac learners see arm64 and WSL learners see x86-64, so every listing is shown for both.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 10.1 | Machine model (45m) | Registers, PC, flags, memory; fetch–decode–execute on a toy ISA | SP | **A15**, V10 |
| 10.2 | Write the decode loop (45m) | TinyCPU core in C (`uint8_t mem[]`, bit-field decode, `switch`) | CT | V10 |
| 10.3 | From C to assembly (45m) | `-S` at `-O0`/`-O1`; clean listings; wasm is a stack machine | PR ("which C line?") | V7 |
| 10.4 | Moves and arithmetic (45m) | `lea` vs `add`; sign extension; `eax`/`rax`, `w0`/`x0` | PR, PA, AS | V7 |
| 10.5 | Control flow (45m) | Compare and branch; loops; jump tables; signed vs unsigned jumps | AS, PA | V7, V10 |
| 10.6 | Procedures and the stack (50m) | `call`/`ret`/`bl`; SysV vs AAPCS64 arguments; saved registers; alignment; how a stack smash overwrites the return address | SP (register traces), MD | **A16**, V10, V3 |
| 10.7 | Data in assembly (40m) | Indexed addressing; field offsets = `offsetof` | PR, MD | V7 |
| 10.8 | `-O2` and instruction-level debugging (45m) | Folding, inlining, UB exploitation, `volatile`; `stepi`, `disassemble`, `x/16xb` | PR ("what disappears?"), LT | V10 |

- **Problem set: TinyCPU emulator.** Checked against golden per-step register and memory traces on 20 programs.
- **Project P10, Asm Detective.**
  - A per-learner seeded `phases.o` (x86-64 ELF, arm64 Mach-O, aarch64 ELF) that the learner links and defuses through five phases with the debugger.
  - Two "write C equivalent to this listing" items, checked with test vectors and an instruction budget.
  - Register values at a breakpoint.
- **Checkpoint:** 3 asm→C items (learner's ISA), 1 MD (calling convention), 1 PA, 2 SP, 1 `bt` interpretation. Transfer: predict a mystery function's result.
- **Retrieval:** M9, M5, M2, M7.
- **Resources:** CS:APP 3e §3.1–3.7; CMU 15-213 (Fall 2015) Lecture 6 "Machine Prog: Control" and Lecture 7 "Machine Prog: Procedures".
- **SC:** SC8 (A: CPU and registers), SC9 (A), SC2 (A).
- **Analogies:**

| JS | Machine | Where it breaks down |
|---|---|---|
| V8 JIT | AOT compiler | No speculation or deopt |
| DevTools call stack | frames | Real frames hold an overwritable return address |

### M11. Linking, Loading, Libraries & the C ABI (10 h, 2 weeks, native)
**Why:** it explains "undefined reference" errors and completes the source → process story. The C ABI is what N-API, Rust FFI and wasm exports all speak.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 11.1 | The four stages, for real (45m) | `-E -S -c`, link, `-v`; `nm`, `objdump`/`otool` | CE ("which stage failed?" ×6) | A2 recap, V7 |
| 11.2 | Symbols and linkage (45m) | `extern`/`static`, one-definition rule, strong and weak symbols, relocation; ELF vs Mach-O | CE, FB (duplicate symbol) | **A17** |
| 11.3 | Libraries (40m) | `ar`; `-fPIC -shared`; `-L`/`-l`; link order; `ldd`/`otool -L`; rpath; `dlopen` | CT, CE (loader errors) | V7 |
| 11.4 | Loading (40m) | Segments, entry → `main`, dynamic loader, PLT/GOT idea, ASLR | PR [native] | **A18**, V2 |
| 11.5 | Make, properly (40m) | Pattern rules, automatic variables, `-MMD -MP`, `.PHONY`, `-j` | PA, CT | — |
| 11.6 | The C ABI and FFI (40m) | Calling convention and struct layout as ABI; opaque pointers; symbol naming on macOS; wasm exports called from JS | CT (call your C from JS in the browser) | V7 |

- **Project P11, Libify:** package the M9 hash table as `libdict.a` and a `.so`/`.dylib` with an opaque type, hidden visibility and a versioned header. It checks:
  - the exported symbol set equals the API;
  - static and dynamic clients pass;
  - touching a header rebuilds only its dependents (parsed from `make -n`);
  - **changing an internal struct and relinking only the library keeps the old client working**.
- **Checkpoint:** 3 CE (one per stage), 1 PA (Makefile), 1 MD (segments), 2 PR. Transfer: "why does this library crash when the struct changes?"
- **Retrieval:** M10, M6, M1, M7.
- **Resources:** CS:APP 3e ch. 7 §7.1–7.12; GNU Make manual ch. 4 (§4.14 "Generating Prerequisites Automatically").
- **SC:** SC1 (A), SC11 (A).
- **Analogies:**

| JS / npm | C | Where it breaks down |
|---|---|---|
| Bundler | compiler + linker | Symbols are global unless `static` |
| `import()` | `dlopen` | Returns an untyped `void*` |
| `.d.ts` | header | A header is pasted in textually |
| `exports` map | visibility | Visibility is a linker property |

### M12. Memory Hierarchy & Performance (12.5 h, 2.5 weeks; browser simulator + native benchmarks)
**Why:** it explains why the same Big-O can run an order of magnitude slower. This audience already thinks in latency and caching from network waterfalls.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 12.1 | Latency ladder (35m) | Registers → caches → DRAM → SSD; locality | PR | DevTools-waterfall analogy |
| 12.2 | Caches (50m) | Lines, sets, ways, tags; direct-mapped vs associative; LRU; address split | SP (hit or miss), NP (tag/set/offset) | **A19**, V6 |
| 12.3 | Locality in loops (45m) | Row vs column order, measured natively and in the browser (ratios come from pipeline runs) | PR (direction and order of magnitude), BENCH | V6 |
| 12.4 | Data layout (40m) | AoS vs SoA; pointer chasing vs arrays; chaining vs probing | PR, CT | V6, V2 |
| 12.5 | Honest benchmarking (40m) | Warm-up, median, sinks, variance; `perf stat` / Instruments | FB (a flawed benchmark) | — |
| 12.6 | Blocking and compiler help (40m) | Tiling; `-O` levels, inlining, vectorisation, `restrict` | PR | V7 |

- **Project P12, cachesim + Make It Fast:**
  - (A) A trace-driven set-associative LRU simulator; hits, misses and evictions must match the reference on 8 configurations.
  - (B) A blocked transpose whose miss counts stay under thresholds, measured by **the learner's own simulator**.
  - (C) At least 3× real speedup on the learner's machine, plus a report.
- **Checkpoint:** 3 V6 predictions, 1 address split, 2 PR (performance ordering), 1 FB, 1 asm-loop read. Transfer CT: a loop interchange.
- **Retrieval:** M11, M10, M3, M8/M9.
- **Resources:** CS:APP 3e §6.2–6.6; CMU 15-213 (Fall 2015) Lecture 12 "Cache Memories".
- **SC:** SC8 (A: caches, access patterns), SC6 (D), SC9 (D).
- **Analogies:**

| JS / Web | Hardware | Where it breaks down |
|---|---|---|
| HTTP/CDN cache | CPU cache | Hardware-managed, 64-byte lines, conflict misses |
| TypedArray vs array of objects | SoA vs AoS | Same lesson: contiguous data is fast |

### M13. The Operating System: Processes, System Calls, Files & Virtual Memory (15 h, 3 weeks, native POSIX; WSL on Windows)
**Why:** Node's `fs` and `child_process` are thin wrappers over these calls, and every shell pipe is `fork`, `exec` and `dup2`. In the browser our JS literally plays the kernel through WASI, which makes a good bridge.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 13.1 | The syscall boundary (40m) | User vs kernel mode, traps, libc wrappers, `errno`; WASI log vs `strace` | PR (count of `write` calls, tty vs pipe) | V8, **A20** |
| 13.2 | File descriptors (45m) | `open`/`read`/`write`/`close`/`lseek`; fds 0–2; buffer sizes; redirection | CT `mycat`, BENCH, PR [both] | V8 |
| 13.3 | `fork`/`exec`/`wait` (50m) | Copy-on-write, `waitpid`, zombies; duplicated output after fork when piped | PR (output order), PA | **A21**, V3 |
| 13.4 | Pipes and redirection (45m) | `pipe`, `dup2`; how `a \| b > f` works; an unclosed pipe end hangs | CT, MD (fd table) | V4 (fd-table mode) |
| 13.5 | Signals and exit status (30m) | SIGSEGV, SIGINT, SIGPIPE, SIGCHLD; 128+n; async-signal-safety | PR | — |
| 13.6 | Virtual memory (50m) | Pages, page tables, TLB, faults, protection (why NULL faults natively but not in wasm); `mmap`; `/proc/self/maps` / `vmmap` | PR, MD (translate an address) | **A22**, V6 (address-split mode) |
| 13.7 | Files and directories (35m) | Inodes, `stat`, permissions, `readdir`; mini `ls -l` | CT | — |

- **Project P13, `msh` (mini shell):** prompt loop; builtins `cd`, `exit` and `pwd`; `fork`/`execvp`/`waitpid`; `$?`; `<`, `>` and `>>`; one `|`; Ctrl-C kills the child, not the shell. It checks:
  - output and files against `/bin/sh`;
  - **status 127 for a missing command**;
  - no zombies and no leaked fds;
  - ASan clean.
- **Checkpoint:** 2 PR (fork output), 1 MD (fd table), 1 virtual-memory translation, 2 CT, 1 CE (an `strace` excerpt). Transfer: "why does output appear twice after `fork`?"
- **Retrieval:** M12, M11, M7, M5, M6.
- **Resources:** OSTEP v1.10 ch. 5 "Process API" and ch. 39 "Files and Directories"; CS:APP 3e ch. 10 "System-Level I/O".
- **SC:** SC10 (A), SC2 (A), SC1 (A), SC8 (D).
- **Analogies:**

| JS / Browser | OS | Where it breaks down |
|---|---|---|
| `child_process.spawn` | `fork`+`exec` | `fork` clones the whole process |
| Web Worker | process | A Worker starts fresh |
| `fs.openSync` fd | kernel fd | Exactly the same numbers |
| WASI in our runtime | syscalls | Literally a syscall interface |

### Capstone: build `malloc`, then run your own programs on it (25 h, 5 weeks, native)

**Track A (default):** implement `mm_malloc`, `mm_free`, `mm_realloc` and `mm_calloc` with 16-byte alignment over a provided `memlib` (an `mmap` region that works on macOS and Linux).

| Week | Milestone |
|---|---|
| 1 | Implicit free list, boundary tags, first fit, and an `mm_check` invariant checker |
| 2 | Coalescing, splitting, in-place `realloc` |
| 3 | Explicit free list, then segregated lists |
| 4 | **Integration:** rebuild Speller (M9), `eventloop` (M8) and `msh` (M13) on the learner's allocator; `mm_dump()` JSON feeds the V3 heap view in the app |
| 5 | Benchmarking, tuning, and a report on utilisation vs throughput |

The runner uses about 12 trace-driven workloads. It checks:
- alignment, no overlap, payload integrity across `realloc`, `calloc` zeroing, and `mm_check` after every operation;
- utilisation of 70% or more on average;
- throughput of at least 0.25× libc to pass and 0.5× for distinction;
- byte-identical output from all three integrated programs.

**Why it is harder than Speller:** raw pointer arithmetic, bit-packed headers, alignment, structures living inside untyped memory, OS memory, performance work, and debugging without sanitizer coverage of the custom heap.

**Track B, Speller Pro:** chained, open-addressing, trie and baseline backends; a median-of-N benchmark harness; byte-exact memory accounting; a cache-reasoned choice; at least 2× faster than the baseline.

**Graduation check** (60–90 min): draw a memory layout, diagnose errors by stage, read assembly, predict a fork program's output, interpret an ASan report, and choose a data structure.

**Resources:** CS:APP 3e §9.9 "Dynamic Memory Allocation"; K&R 2e §8.7 "Example—A Storage Allocator".

### 6.1 Success criteria → modules (I introduced, D developed, **A** assessed)

| Criterion | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | Cap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC1 source → process | I | | | | | D | | | | D | **A** | | **A** | |
| SC2 memory layout | I | | | I | **A** | D | D | | | **A** | D | | **A** | D |
| SC3 pointers/arrays/strings/structs/heap | I | D | D | D | **A** | D | **A** | **A** | D | | | | | **A** |
| SC4 debugger + sanitizers | | | | | I | **A** | D | D | **A** | D | | | D | **A** |
| SC5 lists/stacks/queues/hash/BST/trie | | | | I | D | | | **A** | **A** | | D | | | D |
| SC6 Big-O, sort/search | | | | **A** | | | | D | **A** | | | D | | |
| SC7 bin/hex/2's comp/float/endian/bitwise | I | **A** | D | | D | | **A** | | D | D | | D | | D |
| SC8 CPU, registers, caches, access patterns | | | | | | | | | | **A** | | **A** | D | D |
| SC9 read assembly of own C | | | | | | I | | | | **A** | D | D | | |
| SC10 syscalls, files, processes, OS role | | | | | | | I | | | | | | **A** | D |
| SC11 multi-file, Make, headers, C ABI | | | | | | I | D | D | D | D | **A** | | D | **A** |

### 6.2 CS50x (2026) problem-set parity
Problem sets were checked against cs50.harvard.edu/x/psets in October 2026.

| CS50 | CS50 requires | Ours | Module | At least as hard because |
|---|---|---|---|---|
| Hello, World / Hello, It's Me | both | both, plus input validation | M1 | — |
| Mario less / more | one | less as warm-up, **more required** | M1 | harder one required |
| Cash / Credit | one | **both** (Cash in cents; Credit must match on wasm32 and native) | M1/M2 | both required |
| Scrabble, Readability | both | both | M3 | — |
| Caesar / Substitution | one | **`cipher`: both, plus decrypt and round-trip property tests** | M3 | both + properties |
| Sort | identify | identify **+ implement all three + doubling table** | M4 | empirical Big-O |
| Plurality | yes | yes | M4 | — |
| Runoff / Tideman | one | **Tideman required** (Runoff warm-up) | M4 | harder one + DFS lesson |
| Volume | yes | yes, with clipping tests | M7 | — |
| Filter less / more | one | **all five filters + a 4000×3000 heap test** | M7 | union of both |
| Recover | yes | yes, synthetic card + SHA-256 checks | M7 | randomized data |
| Inheritance | yes | yes, 1000 seeded runs, leak-free | M8 | — |
| Speller | yes | yes **+ must beat a `bsearch` baseline**; then Libify (M11) and capstone integration or Track B | M9 | performance gate + ABI work |

Beyond CS50: bitlab-lite, hexcolor, `libstr`, Bug Hunt, `eventloop`, word frequency, TinyCPU, Asm Detective, Libify, cachesim, `msh`, `malloc`.

Note: CS50 now compiles with `-std=c23 -Werror` (cs50/cli). We teach **C17** as specified, and point out C23 differences where they matter (`bool` keyword, `nullptr`, binary literals).

---

## 7. Visualizers (React components the learner controls)

| ID | Name | Used in | Modes | Prediction hook |
|---|---|---|---|---|
| V1 | Number Playground | M1–M3, M5, M10, M12 | Binary/hex/decimal; two's-complement wheel; IEEE-754 float/double bit editor; overflow wheel; JS `Number` comparison | NP drills; PR on wrap and rounding |
| V2 | Byte Viewer | M2, M3, M5, M7, M11, M12 | Hexdump; endianness; **struct padding with a wasm32 / x86-64 / arm64 toggle**; WAV/BMP/JPEG header overlays; live wasm memory after a run | MD on padding and bytes |
| V3 | Stack/Heap Stepper | M1, M4–M6, M8, M10, M13, Cap | Frames, locals and typed heap blocks from gdb traces; **the learner predicts the next state before stepping**; capstone `mm_dump` | SP |
| V4 | Pointer Diagram | M5, M7–M9, M13 | Auto-drawn from traces, plus drag-to-draw; list, tree, `argv` and fd-table modes | MD |
| V5 | Hash-Table Visualizer | M9, M12, Cap B | Hash function, bucket count, load factor, chaining, probing, tombstones, resize, trie mode, chain histogram | PR on bucket, probes, resize |
| V6 | Cache Simulator | M12, M13 | s/E/b, LRU, address trace from a C loop, hit/miss heat map, address-split mode reused for page translation | SP (hit or miss), NP (split) |
| V7 | Pipeline Explorer | M1, M6, M10–M12 | **Live** in-browser `-E/-S/-c/nm/link` for wasm32; stored native x86-64/arm64 `.s`, `nm` and `objdump` panes with source-line highlighting | PR ("which line produced this?"), CE |
| V8 | Syscall Tracer | M1 (teaser), M13 | Live WASI import log of a browser run, next to a stored native `strace` | PR (number of `write` calls) |
| V9 | Algorithm Race | M4, M8, M9 | Bars with comparison and swap counters, doubling chart, graph/DFS mode | TT, PR |
| V10 | TinyCPU / Register Stepper | M10, M12 | Toy ISA plus stored gdb/lldb `stepi` register traces | SP on registers and flags |

---

## 8. HyperFrames animations (30–90 s; each is followed by an interaction)

| ID | Module.lesson | Length | Shows | Interaction that follows |
|---|---|---|---|---|
| A1 | 1.1 | 45 s | Press Run: C → in-browser clang → `.wasm` → Worker → output panel | PR: which messages came from the compiler and which from the program? |
| A2 | 6.2 (recap 11.1) | 75 s | `hello.c` → preprocess → compile → assemble → link → load | CE: classify 3 failures by stage |
| A3 | 2.3 | 45 s | Two's-complement wheel; wrap vs UB | NP + PR `(unsigned char)250+10` |
| A4 | 2.5 | 60 s | Float fields: sign, exponent, mantissa | NP: decode `0x3F800000` |
| A5 | 4.3 | 50 s | Frames pushed and popped during recursion | SP: next frame of `fact(3)` |
| A6 | 4.4 | 60 s | Merge sort split and merge | TT: merge buffer state |
| A7 | 5.3 | 50 s | Swap by value vs by address | SP + FB broken swap |
| A8 | 5.5 | 60 s | Where variables live; native vs wasm32 layout | MD: place declarations |
| A9 | 6.1 | 45 s | Why the browser didn't crash: linear memory vs virtual memory with an unmapped page 0 | PR [both]: NULL write |
| A10 | 7.5 | 60 s | BMP anatomy: headers, BGR, bottom-up rows, padding | MD: padding in a 3-pixel row |
| A11 | 7.6 | 60 s | Carving JPEGs from 512-byte blocks | TT: recovery state machine |
| A12 | 8.3 | 50 s | Linked-list insert, delete, free with a temp pointer | MD: redraw arrows |
| A13 | 8 (P8 intro) | 60 s | The event loop as C structures | PR: order of a 6-line script |
| A14 | 9.2 | 75 s | Hashing into buckets, chaining, resize and rehash | V5 PR: bucket after growing |
| A15 | 10.1 | 60 s | Fetch–decode–execute | SP: next PC and register |
| A16 | 10.6 | 60 s | Calling convention: argument registers, `call`/`ret`, frame | SP: rdi/x0 at callee entry |
| A17 | 11.2 | 75 s | Symbol resolution and relocation | Match symbols to definitions; CE |
| A18 | 11.4 | 75 s | exec → loader → dynamic linker → `main` | PR: what changes between runs (ASLR) |
| A19 | 12.2 | 75 s | Cache lines and sets; row vs column order | V6 SP: next 8 accesses |
| A20 | 13.1 | 60 s | `printf` → buffer → `write` syscall → kernel → terminal | PR: `write` count, tty vs pipe |
| A21 | 13.3 | 60 s | `fork`/`exec`/`wait` and copy-on-write | PR: output lines of a fork tree |
| A22 | 13.6 | 90 s | Virtual → physical translation, page table, TLB | MD: translate an address |
| A23 | Cap week 2 | 75 s | Free-list split and coalesce with boundary tags | V3 SP: free list after `free(b)` |

When an animation shows concrete values (sizes, offsets, register contents), they are injected at render time from the pipeline's generated outputs through composition variables. Nothing is hand-typed.

---

## 9. YouTube segment candidates (≤ 2 per module; final list goes into `videos.json`)

All five video IDs were confirmed via oEmbed as the official CS50 channel's "CS50x – Lecture N" uploads **[V]**. Times below come from CS50's caption files. Lecture 3 and 4 YouTube transcripts match them exactly **[V]**. Every segment is re-checked against its YouTube transcript (anchor quotes at start and end) when its module is built, and Lecture 5 is re-timed then.

| ID | Video | Segment | Topic | Module | Why it earns its place |
|---|---|---|---|---|---|
| Y1 | L1 `SlqjA04_dpk` | ≈02:19:42–02:29:40 | Overflow, Boeing, truncation, float imprecision | M2 | Real-world failures told memorably |
| Y2 | L4 `db0H0U13YsA` | ≈00:06:56–00:18:12 | Hexadecimal | M2 | A strong live explanation; we skip only if V1 covers it better (decided when M2 is built) |
| Y3 | L2 `h5Gc1n8ZuU8` | ≈00:41:59–00:59:14 | clang and the four steps | M1 | Shows the toolchain on a real machine |
| Y4 | L2 | ≈01:33:27–01:44:25 | Strings in memory, NUL | M3 | — |
| Y5 | L3 `6Svu_ae5ebk` | ≈01:46:12–01:58:58 | Merge sort | M4 | A physical demo |
| Y6 | L4 | ≈01:27:41–01:30:35 | Binky pointer fun | M5 | A classic 3-minute mental model |
| Y7 | L4 | ≈01:40:00–01:49:30 | Memory layout, stack and heap | M5 | — |
| Y8 | L2 | ≈00:26:17–00:36:52 | Debugger | M6 | — |
| Y9 | L4 | ≈01:14:07–01:26:47 | Valgrind, garbage values | M6 | — |
| Y10 | L4 | ≈02:02:35–02:19:00 | File I/O through JPEG signatures | M7 | Boundaries to be confirmed |
| Y11 | L5 `PmAI76OGE_E` | ≈00:33:30–00:55:00 | Linked lists | M8 | Re-time from the YouTube transcript |
| Y12 | L5 | ≈01:22:00–01:38:00 | Trees and BSTs | M8 | — |
| Y13 | L5 | ≈01:38:00–02:01:00 | Hashing, hash tables, tries | M9 | — |

M10–M13 use animations instead of video. A segment longer than about 6 minutes gets pause points with prediction questions, to respect the "≤ one clip before an interaction" rule.

---

## 10. Further study (out of scope rather than skimmed)
- **Concurrency:** threads, atomics, races (OSTEP ch. 26–33; CS:APP ch. 12; Beej ch. 39–40).
- **Networking and sockets:** CS:APP ch. 11.
- **Full job-control shell, signals in depth, nonlocal jumps:** CS:APP §8.5–8.6.
- **Virtual-memory internals and file-system implementation:** OSTEP ch. 18–23 and 40–42.
- **Garbage collectors:** CS:APP §9.10.
- **Processor design and building a computer:** CS:APP ch. 4; Nand2Tetris projects 1–5.
- **Optimisation in depth, SIMD, floating-point assembly, PIC/GOT/PLT details:** CS:APP ch. 5, §3.11, §7.12.
- **Exploits and mitigations:** CS:APP §3.10.3–3.10.4.
- **Algorithms beyond the core:** balanced trees, graph algorithms, dynamic programming (Erickson; CLRS 4e).
- **C23 in full:** Effective C 2e; Modern C.
- **Unicode handling:** Beej ch. 26–27.
- **Tooling:** fuzzing (libFuzzer/AFL++), static analysis (`clang-tidy`, `gcc -fanalyzer`), CMake.
- **CS50 Weeks 6–10** (Python, SQL, web): out of scope by design.

---

## 11. Build roadmap

| Stage | Session(s) | Output | Stop for review |
|---|---|---|---|
| **1** | this one | Research, prototypes saved in `research/`, **PLAN.md**, initial CLAUDE.md | **yes (now)** |
| **2** | 2–3 | App shell (routing, theme, progress store with export/import, gating, lesson card engine, MDX pipeline); in-browser runtime (compiler + run workers, JSPI stdin, guardrail mode, caching); `tools/verify`, `tools/trace`, `tools/check`, content lint, e2e harness; the CI workflow; **Module 1 end to end**, with every interaction type, visualizers V1 (basic), V3 and V7 (basic), animation **A1**, Y3, and the P1 Mario-more project | **yes** |
| 3.n | one per module | M2 … M13, then the capstone, each passing §3.5 and adding its visualizers and animations as listed | **yes, after each** |

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| First Run downloads about 24 MB | Lazy load, progress bar, persistent cache (0 requests on repeat visits **[V]**), stored outputs viewable without compiling, brotli on hosts that support it |
| yowasp is a young package built with LLVM assertions on | Pin the exact version and vendor the files; keep the `CompilerBackend` interface; live-codes as the tested fallback |
| JSPI is missing on older Safari or Firefox | Pre-filled stdin box (always works); SharedArrayBuffer where isolated |
| Low-memory mobile devices | Detect and offer stored-output mode |
| Firefox/WebKit untested here | CI Playwright matrix for compile/run smoke tests |
| macOS-specific outputs can't be generated on Linux | macOS GitHub Actions job for `platform` samples and the `check.mjs` macOS path (`leaks`) |
| HyperFrames CLI is pre-1.0 and releases daily | Pin the version in devDependencies; renders committed; `check --strict` in CI |
| Completion tokens can be forged | Accepted as an honour system (no backend by design); stated openly to learners |

---

## 12. Decisions I'd like you to confirm

1. **Hosting:** GitHub Pages via Actions needs the repo to be public, or a paid plan for private Pages. Alternatively Cloudflare Pages or Netlify, which also serve brotli (about 17 MB vs 24 MB first load).
2. **Committing rendered animations** to git (about 1–2 MB each, roughly 50 MB total), instead of rendering in CI on each deploy.
3. **Course length:** 195 h (39 weeks at 5 h/week) with a fast lane of about 186 h. It is above CS50 because projects are sized like the CMU labs they mirror. Shall I trim, or keep the rigor?
4. **Capstone:** default to Track A (allocator) with Track B (Speller Pro) as the alternative?
5. **Browser support floor:** interactive `scanf` needs JSPI (Chrome/Edge 137+, Firefox 153+, Safari 27). Other browsers get a pre-filled stdin box. Acceptable?
6. **Animation palette:** one theme-neutral render per animation (smaller), or separate light and dark renders?
7. **CS50 video segments:** they are CC BY-NC-SA and embedded via YouTube (not re-hosted). OK to rely on them as the primary outside videos?
