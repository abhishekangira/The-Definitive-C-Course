# The Definitive C Course: Plan

A self-paced, interactive web app that teaches C17 and low-level computer fundamentals to experienced front-end engineers.
- It is a static site with no backend. The optional AI tutor (§2.6) calls an AI provider straight from the browser with the learner's own API key; the course runs no server for it.
- Learners write and run real C in the browser from the first lesson.
- From Module 3 (weeks 5–6), they also use their own toolchain for debugging, sanitizers and projects.

> **Status:** Stage 1 (research + plan) was reviewed and approved; the client's decisions are recorded in §12. Stage 2 (app shell + Module 1) is in progress.
> - **[V]** marks a technical claim verified by running it in this repo's container during research.
> - **[DOCS]** marks a claim read in documentation only.
> - Raw reports and working prototypes are in `research/reports/` and `research/prototypes/`. Three independent adversarial reviews of the first draft are in `research/reports/review-*.md`; their confirmed findings are folded in below.

---

## 0. Key decisions at a glance

| Question | Decision | Why (short) |
|---|---|---|
| In-browser C compiler | **`@yowasp/clang` 22.0.0-git20542-10**, pinned and self-hosted | Real clang 22; diagnostics matched native clang 18 on our test set, apart from warnings that clang 22 adds or renames (§3.1 step 4), and CI compares against native clang 22; warm compile+link ≈100–150 ms; needs no COOP/COEP. Deterministic, so the same binary runs in Node for CI **[V]** |
| Running the compiled program | `@bjorn3/browser_wasi_shim` 0.4.2 in a per-run Web Worker, with our own stdin/stdout file descriptors | Small (6.7 KB gzip worker); stdin, in-memory FS and streaming output; MIT/Apache **[V]** |
| Interactive `scanf` | **JSPI** (Chrome/Edge 137+; the app targets Chromium-based browsers only, §12); a pre-filled stdin box on older ones | Needs no special hosting headers **[V in Chromium]** |
| App stack | Vite + React 19 + TypeScript; MDX + YAML content in `content/`; CodeMirror 6 editor; HashRouter | Lessons are editable without touching components; works from any static server or subpath |
| Progress | `localStorage` (namespaced, versioned schema) + export/import as a JSON file | As specified |
| Local toolchain | **Module 3 (weeks 5–6)**: macOS Command Line Tools or WSL Ubuntu 24.04. All projects from M3 on are local and checked by `check.mjs`. | Matches the spec's "early module… from then on, debugger, sanitizer and project work happens locally" |
| Build-time truth | `tools/verify` compiles and runs every sample natively (gcc 13 + clang 22, x86-64), with the browser compiler in Node, and on macOS/arm64/Windows CI runners where relevant. Normalized outputs are diffed and flagged samples store every result. | Expected outputs and prediction answers always come from real runs |
| Stepper data | Traces pre-baked by a gdb-Python tracer with a malloc/free shim **[V]**, labelled "x86-64 Linux" | A static site can't trace live; gdb gives scopes, types and heap for free |
| Local projects | Starter zip (built client-side, with the learner's seed) → `make test` → `node check.mjs` (zero-dependency, check50-like) **[V on Linux]** | The audience has Node; the test format is shared with the in-browser runner |
| Animations | HyperFrames source projects in `animations/`, rendered to H.264 MP4 + captions, played in our accessible `<Explainer>` with pause-at-step predictions | Deterministic, byte-identical renders; accessible native video; no runtime JS **[V]** |
| YouTube | Only **2 short segments** so far (≈3 min each) that beat what the app can do, on `youtube-nocookie.com` with `start`/`end`; listed in `videos.json` | IDs confirmed via oEmbed; boundaries taken from YouTube transcripts **[V]** |
| AI tutor (optional) | Bring your own key: the learner pastes a key for an OpenAI-compatible chat API (OpenRouter by default); the learner uses the course's default models on OpenRouter or types their own model id; the browser calls the provider directly (§2.6) | Keeps the site static and free to run; the learner pays for the model; nothing to proxy, rate-limit or secure on our side |
| Hosting | GitHub Actions → GitHub Pages (works on any static host); toolchain copied from `node_modules` at build, never committed | Free; repeat visits load the compiler from cache |
| Course size | **13 modules + capstone ≈ 200 h ≈ 40 weeks at 5 h/week**; CS50x C parity at ≈ week 24 | See §6; a fast lane of about 190 h is defined |

---

## 1. Research summary

### 1.1 Options for running real C in the browser
Each candidate was installed and run here (Node 22, headless Chromium 141) unless noted. Details: `research/reports/toolchain-yowasp.md` and `toolchain-alternatives.md`.

| Candidate | Real compiler / diagnostics | stdin | First download | COOP/COEP | Verdict |
|---|---|---|---|---|---|
| **@yowasp/clang 22** (LLVM → WASI, via jco) | clang 22.1.0; diagnostics match native clang 18 on our tests, apart from warnings new or renamed in clang 22 **[V]** | Pre-filled **[V]**; interactive via JSPI **[V]** | C-only sysroot: ≈15.2 MB brotli / ≈23.7 MB gzip. Full: ≈17.2 / ≈27 MB. Raw: 105 MB **[V]** | Not needed **[V]** | **Chosen** |
| @live-codes/clang-wasm 0.3 (wasm-idle llvm-core) | clang 22.1.8; good diagnostics **[V]** | Pre-filled **[V]** | ≈23 MB brotli | Not needed | Best fallback. Only 3 weeks old and single-maintainer; its `run()` drops warnings and loses output on a trap |
| Wasmer SDK + `clang/clang` | clang 16 (a 2024 personal build) | Truly interactive **[V]** | 110 MB uncompressed from Wasmer's CDN | **Required**; fails silently without it **[V]** | Rejected: stale, COI, broke under Vite bundling |
| browsercc 0.1.1 | clang 20 | Pre-filled | ≈24 MB brotli | Not needed | Rejected: 1–2.5 s per compile (reloads clang each time); unmaintained since 2025-04 |
| Emception 4.4 | clang 23 rc + emcc | — | ≥41 MB brotli | Required | Rejected: 3–18 s compile + 14–26 s link; corrupted stdout **[V]** |
| Runno / binji wasm-clang | clang 8 (2019), forced `-Werror`, C11 | EOF never delivered **[V]** | ≈16 MB | For stdin | Rejected |
| TCC/xcc, picoc, JSCPP | not clang/gcc / toy interpreters | — | small | — | Excluded by "no toy interpreter" |
| Compiler Explorer, Judge0, learn-c.org-style | real, on a server | — | — | — | Excluded: needs a backend, and sends learner code to a third party |

**Why @yowasp/clang wins**
- Real, current diagnostics.
- The fastest warm compile we measured: about 100 ms in Node and a 146 ms median in Chromium **[V]**.
- Works without cross-origin isolation.
- The same package runs in Node, so **CI's "browser" outputs come from the identical compiler binary** (same sha256 across runs **[V]**).

All compiler access sits behind a small `CompilerBackend` interface, so live-codes can be swapped in if yowasp stalls.

### 1.2 What the browser build cannot do, and how the plan handles it

| Limitation (verified) | Handling |
|---|---|
| No x86-64/arm64 backend; only wasm32/wasm64 are registered **[V]** | Native `.s` listings for course samples are generated by CI on real machines (Linux x86-64 and arm64 runners, macOS runner). For learner-edited code the app shows wasm text and LLVM IR, plus an optional "Open in Compiler Explorer" link-out. |
| No ASan, and no UBSan runtime shipped **[V]** | **Guardrail mode** links our own UBSan runtime. It implements every handler in the `-fsanitize=undefined` group plus the `_abort` variants, and is compiled with `-fno-sanitize-recover=all`, so it stops at the first error like native. Messages are in native format, e.g. `main.c:7:41: runtime error: signed integer overflow…` **[V for the core handlers; full set built and CI-tested in Stage 2]**. It also catches NULL dereferences, which wasm doesn't trap. In-browser leak checking uses `leakcheck.c`, linked via `-Wl,--wrap=malloc,…` (wasm-ld supports `--wrap` **[V]**), with one global registry; reports go to a side file, not stderr. **Real ASan, Valgrind and debuggers start in M3 (native).** |
| NULL reads and writes don't trap; string literals are writable; the stack sits below globals **[V]** | Taught explicitly. The diff auto-flags affected samples and shows the stored native result (SIGSEGV) next to the browser result. |
| `long`, pointers and `size_t` are 4 bytes **[V]** | Auto-flagged. Native 64-bit output is stored and shown, and the learner predicts the 64-bit value first where it is derivable (§3.2). |
| musl `rand()` sequence and `qsort` stability differ from glibc **[V]** | Prediction questions never use libc `rand()`; samples use the course PRNG in `learnc.h`. |
| Recursion depth is limited by the JS engine's stack (≈6–15k frames depending on frame size, engine and JSPI) as well as the wasm stack **[V]** | Link with `-Wl,-z,stack-size=1048576`, and always run under `WebAssembly.promising` when JSPI exists. Map both `RangeError` and the out-of-bounds trap to "stack overflow". Never ask depth counts. Overflow demos use ≥4 KB frames, and depth-sensitive browser results are recorded in Playwright Chromium, not Node. |
| A malloc loop grows memory to 4 GiB **[V]** | Link with `-Wl,--max-memory=268435456`. |
| musl doesn't flush stdout before blocking on stdin, so prompts stay invisible **[V]** | Every program links `course_rt.c`, which exports `__course_flush_stdout()`; the stdin hook calls it before waiting **[V]**. |
| `sleep()` busy-waits in the shim's `poll_oneoff` (from the research notes) | Override `poll_oneoff` with a JSPI-suspended `setTimeout`, and pause the CPU watchdog meanwhile. |
| Wasm traps instead of signals | Traps map to friendly messages with a source location via `llvm-symbolizer` on DWARF, e.g. "Integer division by zero at main.c:4:14 in divide()" **[V in Chromium]**. Where stack traces lack wasm offsets (e.g., Safari), the message omits the line. |
| `clock()` needs WASI emulation; local time is always UTC | Built with `-D_WASI_EMULATED_PROCESS_CLOCKS -lwasi-emulated-process-clocks`. Benchmarks that matter run natively. |

### 1.3 HyperFrames

**What I read.** The installed skills relevant to authoring:
- `hyperframes`, `-core`, `-cli`, `-animation`, `-keyframes`, `-creative`, `-studio`
- `faceless-explainer`, `motion-graphics`

Also the package docs and the upstream README. Before the first animation in Stage 2 I'll also read:
- `hyperframes-registry` (code and terminal-window blocks need offline rewrites)
- `general-video`
- `media-use`

**Reference composition.** I built `research/prototypes/hyperframes/compile-pipeline` ("main.c → main.o → a.out").
- It passed `lint` (0 errors, 0 warnings) and `check --strict` (contrast 31/31 AA).
- It rendered to MP4 in 17.7 s.
- **Two renders were byte-identical, including one with no network** **[V]**.
- At CRF 30, an 8 s 1080p clip is 227 KB (≈1.7 MB per minute) **[V]**.

**Prerequisites:** Node ≥22, FFmpeg and a pinned Chromium headless shell. All three are present here.

**Embedding: rendered video is the default.** I tested the live `@hyperframes/player` **[V]** and found that:
- it injects its runtime from jsDelivr unless given an undocumented `runtime-src`;
- its scrubber isn't keyboard-operable;
- it has no caption support;
- it costs about 225 KB of gzipped JS.

Rendered MP4 with WebVTT captions in our own player instead gives:
- native keyboard and screen-reader support;
- captions;
- zero runtime JS;
- frozen, deterministic artifacts.

Steps are timeline labels (`data-steps`), exported to `steps.json`. Our player **pauses at each step and asks a prediction** before continuing. The live player remains opt-in for an animation that truly needs live theming.

### 1.4 YouTube
- With the network open, the container reaches YouTube.
- **Existence** is checked via oEmbed.
- **Transcripts** come from yt-dlp with `--extractor-args "youtube:player_client=web_embedded" --ignore-no-formats-error`; default clients hit a bot check from this IP **[V]**.
- **Timing check:** YouTube transcripts for CS50x Lectures 1–5 all match CS50's CDN captions **[V]**. Lecture 5's CDN file is offset by +1 h, and the YouTube version matches the corrected times.
- **Selection rule:** I only include a segment when it beats what the app can do. A real-world story, or a piece of media we can't reproduce, qualifies. A lecturer explaining something our visualizers make interactive does not. That cut the draft's 13 long segments to 2 (§9).

---

## 2. Architecture

### 2.1 Repository layout
```
PLAN.md  AGENTS.md (+ an AGENTS.md in some folders)  README.md  videos.json
package.json  vite.config.ts  tsconfig.json  playwright.config.ts
content/                          # ← all course text; editable without touching components
  course.yaml                     # module order, ids, hours, success-criteria map
  modules/
    m01-c-in-your-browser/
      module.yaml                 # title, hours + breakdown, outcomes, resources, retrieval sources
      lessons/01-hello-compiled-world.mdx …
      exercises/<exercise-id>/
        exercise.yaml             # kind (ct|fb|pa|ce|md|pr|lt…), hints[3], tests, variant pool, runs-in (browser|native)
        starter.c  solution.c  tests.json
        variants/<n>/{starter.c,solution.c,tests.json}
      quizzes/{retrieval.yaml,checkpoint.yaml}   # item pools; answers reference generated outputs by sample id
      project/<project-id>/       # README.md, starter/, solution/ (never shipped), check.json (with hints), tests/
animations/                       # one self-contained HyperFrames project per animation (§4.6)
public/animations/<id>/{<id>.mp4,poster.webp,steps.json,<id>.vtt,stills/}   # rendered, committed
src/                              # app code only
  app/  content-runtime/  progress/  interactions/  visualizers/
  runtime/ (compiler.worker.ts, run.worker.ts, wasi-run.ts, CRuntime.ts, protocol.ts,
            course_rt.c, ubsan_rt.c, leakcheck.c, learnc.h)
  generated/                      # outputs of tools/ (committed; CI fails if stale)
    samples/  traces/  asm/  targets/<target>/  exercises/
tools/
  verify/ trace/ check/ exercises/ content-lint/ anim/ videos/ toolchain/
e2e/                              # Playwright: every lesson, every interaction, axe checks
research/                         # Stage 1 reports and prototypes (reference only)
```

### 2.2 App
- **Build.** Vite + `@vitejs/plugin-react`. MDX via `@mdx-js/rollup` with `remark-gfm`, frontmatter, and two of our own remark plugins:
  - a **sample binder**, which attaches generated outputs to code fences by `id`;
  - a **content lint**.
- **Routing.**
  - **HashRouter** with Vite `base: './'`. Routes: `#/`, `#/m/:module` (opens with the retrieval quiz), `#/m/:module/:lesson`, `#/m/:module/project`, `#/m/:module/checkpoint`, `#/settings`.
  - This works on GitHub Pages, on any subpath, and with any local static server (`npm run preview`, `npx serve dist`). `file://` is not supported, because module workers need http.
  - The toolchain URL is resolved on the main thread from `document.baseURI` and passed to the workers.
  - An e2e test checks deep links against a Pages-like server.
- **Lesson UI.**
  - A lesson is a sequence of 6–14 **cards**.
  - Content cards hold ≤250 words, or one animation or video segment.
  - Each content card is followed by an interaction card. "Next" stays locked until the interaction has been attempted, or passed where required.
  - A side outline shows progress and allows revisiting.
- **Editor.** CodeMirror 6 with `@codemirror/lang-cpp`.
  - Clang diagnostics, parsed from parseable or SARIF output **[V]**, become inline markers.
  - "Esc then Tab" leaves the editor, so focus is never trapped.
  - Output goes to a terminal pane (ANSI, 1 MiB cap **[V]**, virtualized; virtualization is to be built).
- **Styling.** CSS custom properties for light and dark themes; the default follows `prefers-color-scheme`, and a toggle is saved. CSS Modules.
- **Accessibility target: WCAG 2.2 AA.**
  - Every interaction is keyboard-operable. Parsons: select a line, move it with Alt+↑/↓. Memory diagrams: cells are form fields, and arrows can be chosen from a target list as well as drawn.
  - Live regions announce run output and test results.
  - `prefers-reduced-motion` swaps animations for step stills.
  - Captions are on by default.
  - axe-core runs in every Playwright test.
- **Responsive.** Editor and output stack on narrow screens. If a compile or instantiate fails for lack of memory, the app switches that lesson to "show stored output" mode. There is also a manual toggle.
- **Browser support.**
  - Target: current Chromium-based browsers (Chrome, Edge, Brave and similar). Firefox and Safari are not supported and not tested (owner decision, §12 item 9).
  - Compile+run is verified in Chromium **[V]**.

### 2.3 In-browser C runtime
This was prototyped end to end in Vite + React and verified in Chromium **[V]**; see `research/prototypes/runtime/`.
```
Main thread (React) ── CRuntime
  ├─ compiler.worker (module worker, long-lived): @yowasp/clang, cache-first fetch of the toolchain
  └─ run.worker (module worker, one per run, pre-spawned): browser_wasi_shim + program
        stdout/stderr → batched postMessage (flush at >16 KB, >33 ms, and before every stdin wait)
        stdin → JSPI (await a postMessage) | SharedArrayBuffer + Atomics.wait (if isolated) | pre-filled box
  watchdog: CPU-time budget (paused while waiting for stdin or sleeping) → worker.terminate()
```

**Flags**
- Compile: `-std=c17 -Wall -Wextra -pedantic -O0 -g -fno-color-diagnostics -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_SIGNAL`.
- Link: `-lc-printscan-long-double -lwasi-emulated-process-clocks -lwasi-emulated-signal -Wl,-z,stack-size=1048576 -Wl,--max-memory=268435456`.
- `course_rt.c` is always linked.
- Guardrail mode adds `-fsanitize=undefined -fno-sanitize-recover=all`, plus `ubsan_rt.c`.
- Leak-checked exercises add `leakcheck.c` and `-Wl,--wrap=malloc,--wrap=free,--wrap=calloc,--wrap=realloc`.

**Lifecycle**
- The toolchain downloads lazily on the first Run, with a progress bar.
- It is cached in Cache Storage under `tdcc-toolchain-<version>`: **0 network requests and ≈0.32 s to ready on repeat visits [V]**.
- `navigator.storage.persist()` is requested after the first successful compile.
- Infinite loops are killed at the CPU budget, and Stop kills immediately. Neither affects the warm compiler **[V]**.

**Multi-file mode.** A virtual tree of `.c`/`.h` files powers:
- early multi-file demos;
- the in-browser `-E/-S/-c/nm/link` Pipeline Explorer **[V]**.

**Size**
- First visit: ≈23.7 MB gzip on GitHub Pages; ≈15.2 MB on hosts that serve brotli **[V]**.
- Chunking the toolchain into ≤20 MiB parts is an option, off by default, for hosts with per-file limits such as Cloudflare Pages:
  - stream-join the chunks with `Content-Type: application/wasm`;
  - cache them under the canonical URL;
  - re-measure warm load.

  GitHub Pages doesn't need it.

### 2.4 Content format
Lessons are MDX. Prose is Markdown, and interactions are components whose props point at exercise folders or at verified samples. **No expected output or answer is ever typed by hand.**

````mdx
---
id: m02-l3-twos-complement
title: Unsigned and two's complement
minutes: 45
---
Short explanation (≤ 250 words)…

```c id=wrap-unsigned
#include <stdio.h>
int main(void) { unsigned char c = 250; c += 10; printf("%d\n", c); }
```
<PredictRun sample="wrap-unsigned" kind="output" explain="…why 4…" />

Short explanation of the wheel (≤ 250 words)…

<Animation id="a03-twos-complement-wheel" />
<NumberDrill exercise="place-minus-one" />
````

**Code-fence meta keys.** Every C fence in lesson prose must have `id=` (compiled, run and predicted) or `fragment` (an illustration, compiled with `-fsyntax-only` inside a harness and never run). Content-lint fails otherwise.

| Key | Meaning |
|---|---|
| (default for `id=` fences) | **predict-before-run**. `run` without a prediction is allowed only inside CT/FB editors |
| `trace` | Also produce a stepper trace |
| `stdin=` / `args=` | Input and arguments |
| `expect=` | `success` \| `warning` \| `compile-error` \| `runtime-error` \| `exit:N` \| `ub` |
| `expect.<target>=` / `warn.<target>=` | Per-compiler expectations (gcc, clang22, wasm, apple) |
| `sanitize=off` | Opt out of the default native ASan+UBSan run (for deliberate UB demos) |
| `guardrail` | Also store the browser guardrail-mode output |
| `platform` | Acknowledges an expected cross-target difference |
| `predict64="…"` / `predict64=none reason="…"` | **Required on every flagged sample** (§3.2) |
| `target=native` | Native-only (fork, pipes, dlopen, files on disk). No browser Run button: predict, then reveal stored output |
| `stdout=tty\|pipe\|both` | How the native run's stdout is attached; default `tty`, matching the browser |
| `posix` | Required when POSIX APIs are used; checks the feature-test macro convention (§4.4) |
| `files=` | Multi-file sample |
| `timeout=` | Milliseconds |
| `norm=` | Normalisation mode (default: only `%p` output is normalised) |

**Exercises** are folders containing:
- `exercise.yaml`: kind, prompt, three hint tiers, solution-unlock rule, variant pool, and `runs-in: browser|native`;
- `starter.c` and `solution.c`;
- `tests.json`, in the same format as the local runner's `check.json` (I/O cases, `contains`/`matches`, exit codes, and unit tests through a C harness).

**Checkpoint CT/FB items are exercise folders too**, so they're verified like any other exercise.

**Quizzes** are YAML pools of typed items. Answers come from sample ids or exercise runs. Any code inside YAML is itself a sample and is compiled. **Parsons** items list their accepted orderings, and every accepted ordering is compiled and tested.

### 2.5 Progress, gating and pedagogy rules
- **Storage.** A versioned schema with migrations, under namespaced keys (`tdcc:v1:*`, because all github.io project sites of one user share an origin). It holds:
  - completed cards;
  - attempts per exercise (count, last code, active time);
  - hints viewed and mastery (variant passed);
  - quiz and checkpoint results;
  - LT progress codes and completion tokens;
  - a random learner seed;
  - the "my machine" platform setting;
  - other settings.
- **Export and import.**
  - Export downloads `c-course-progress-YYYY-MM-DD.json`.
  - Import validates the file, shows a diff ("this file has M1–M4 complete"), then merges or replaces.
  - Browsers can lose site data (the user clears it, or it is evicted). So the app shows "last exported N days ago" and prompts for an export after each module.
- **Gate.** A module unlocks only when the previous one is complete:
  - its **checkpoint** scored ≥80%;
  - its **project** passed, via the in-browser runner (M1–M2) or a native completion token (M3+);
  - every **core exercise variant** is mastered. Outstanding variants show as blockers.
- **Hints.** Three tiers: **H1** a nudge, **H2** the concept and where to look, **H3** partial code. Projects have hint tiers per failing check, in `check.json`, shown by the app and by `node check.mjs --hint`.
- **Solution unlock.** Requires H3 viewed **and** a genuine attempt record: either ≥2 substantive attempts (a changed program that was compiled and tested), or ≥1 substantive attempt plus 20 minutes of active time.
- **Variants.** Viewing a solution assigns a **variant** from the exercise's pool. The learner must solve it alone:
  - H1–H2 only, never a solution;
  - failing a variant serves another;
  - mastery is recorded only on a pass.
- **Local exercises (kind LT).** These cover work that only runs natively: debugger, sanitizers, Make, POSIX.
  1. The app builds the starter zip client-side (fflate) and injects `.learner` (seed + ids).
  2. Every `make test` run prints a short **progress code**. It encodes exercise, seed, pass bitmap, run counter and a source hash, plus a truncated SHA-256 MAC.
  3. The learner pastes the code; each distinct code counts as an attempt for the hint and solution rules.
  4. A full pass prints the **completion token**.

  Codes carry the runner version, and the app keeps a list of accepted `check.mjs` and token-module versions. The codes are tamper-evident, not tamper-proof. Without a backend this is an honour system, and the app says so. One token module (`tools/check/token.mjs`) is shared by `check.mjs` and the app, and both test suites run against fixed test vectors.
- **Retrieval quiz.** Opens every module: 6–10 items, about 10 min.
  - Roughly 40% from the previous module, 30% from two back, 30% older.
  - Missed checkpoint items are re-scheduled.
  - M1 uses a JS diagnostic quiz instead.
- **Checkpoint.** 8–12 items, 30–45 min, pass mark 80%. It must include:
  - a write-code item (CT, or LT for a native-only skill);
  - a fix-a-bug item (FB or LT);
  - a memory-diagram or stepper item (MD/SP);
  - a compiler/tool-message item (CE);
  - a **transfer** item set in an unfamiliar context.

  Items are drawn from pools, so retakes get fresh variants. Content-lint enforces the composition rule.
- **Cadence lint.** `tools/content-lint` fails the build when:
  - any prose run between interactions exceeds 250 words;
  - an animation or video isn't followed by an interaction;
  - an `id` fence lacks a prediction outside an editor;
  - an analogy lacks a breakdown.
- **Analogies.** Every JS/browser analogy is an `<Analogy js="…" c="…" breaksDown="…">` callout. Lint rejects empty breakdowns, and flags "exactly" or "same" for review.

---

### 2.6 Optional AI tutor (bring your own key)
The tutor helps a learner whose code fails a check: it nudges them towards the next step without giving the answer, and it explains why *their* approach does not work. It is off until the learner sets it up, and the course works the same without it.

- **Provider and key.**
  - Any OpenAI-compatible chat-completions API, called with `fetch` (no SDK, no new dependency). The default base URL is OpenRouter's (`https://openrouter.ai/api/v1`); the learner can change it to another compatible provider.
  - The learner pastes their own API key and pays the provider. Model: either the **course default** (OpenRouter only), where the request body is the owner's fixed `models` (`openai/gpt-oss-120b`, `google/gemini-3.5-flash-lite`, `nvidia/nemotron-3.5-super-vl:free`), `provider` (`only` groq, cerebras, google-ai-studio, nvidia, with `allow_fallbacks`), `messages` (a single user message) and `max_tokens` (adjustable), or **their own model id** (free text, with suggestions), which sends the plain `model`, `messages`, `max_tokens` body to any provider. OpenRouter-only fields are never sent to another host. Replies are shown in one piece, not streamed, because the leak guard needs the whole reply first.
  - The key, base URL and model choice live in their own key `tdcc:v1:tutor`, outside the progress document, so export, import and "Reset all progress" never touch them (like `tdcc:v1:playground`). Settings has a "Remove key" button.
  - Settings says plainly that the key is stored in this browser and readable by any script on the page, and recommends a key with a spending limit.
  - The tutor sends the learner's code to the provider they chose. The first use shows a one-time notice that names the provider host; until the learner accepts it, nothing is sent.
- **Where it appears.**
  - Browser exercises (CT, FB, PA) in lessons and problem sets, after at least one failed check of a program the learner changed (a substantive attempt, §2.5).
  - Never in checkpoints (assessment mode), retrieval quizzes or LT tasks, and never on a variant served after a solution view: variants are solved alone (§2.5).
  - Not in the Playground in the first version (there is no exercise to ground it).
- **Two questions.**
  - "Give me a nudge": one next step, phrased as a question or a pointer to a concept or a line. No corrected code.
  - "Why doesn't my approach work?": the learner writes a sentence about their idea, and the tutor explains, against the real results, where that idea breaks.
- **What is sent.**
  - The exercise statement, the learner's current code, the compiler diagnostics, and every failing test case with its input, expected output and the learner's real output.
  - The hints the learner has already opened (never unopened tiers).
  - The reference solution, as hidden context marked "never reveal". It adds no new exposure, because a static site already ships it in the bundle (§4.2).
- **Grounded in real runs.** The tutor only receives outputs the app produced by running the learner's code with the browser compiler. The prompt requires it to quote those results for any claim about what the program prints, and to say "I'm not sure" rather than predict output it was not given. This keeps the course rule that outputs come from real runs, never from memory.
- **Leak guard.** Before a reply is shown, the app compares it with the reference solution, ignoring whitespace and comments. If it contains a solution line that the learner's code doesn't already have, or a code block longer than a few lines, it is replaced by a short refusal and a pointer to the next unopened hint. A fragment the learner can already read (their code, the statement, the shown outputs, an opened hint, a Parsons bank) is not a leak, and the whole-line check is never relaxed. The comparison folds Cyrillic and Greek lookalikes to Latin, ignores invisible characters and typographic quotes, and reads the reply as it is rendered; a reply that reorders text with a bidi override is refused. For a Parsons exercise every bank line is visible, so the secret is the order: a reply that lists four or more bank lines the learner has not placed, forwards or backwards, is refused.
- **Progress and gating.**
  - Each answered question is recorded per exercise (`tutorAsks`), which needs the usual migrate, merge, round-trip and key-list changes (§2.5, `src/progress/AGENTS.md`).
  - It does not count towards the solution unlock and does not count as a submission for the streak.
- **Failure handling.** A wrong key, an exhausted credit, a rate limit, a network error, a refusal or an empty reply each show a short, specific message; the exercise keeps working. The request has a timeout and a cap on output length.
- **Accessibility.** The reply is announced through a polite live region. The panel works with the keyboard and passes axe in light and dark like the rest of the app.
- **Testing.** No real key in CI. Unit tests cover prompt building, the leak guard and the error mapping. The e2e stubs the provider with `page.route` and checks the gating, the notice, both questions, the leak guard and the error messages.

## 3. Build-time verification pipeline

**CI image.** Ubuntu 24.04 with:
- gcc 13;
- clang 22 from apt.llvm.org, pinned to match the browser compiler, plus `libclang-rt-22-dev` for its sanitizers;
- gdb 15 and valgrind 3.22;
- Node ≥22, FFmpeg and a pinned Chromium.

This container's clang 18 lacks compiler-rt, but gcc's ASan works **[V]**. Prototype: `research/prototypes/pipeline/`.

### 3.1 Samples (`npm run verify`)
1. **Extract** every C fence (mdast visitor), plus code in quizzes, Parsons orderings and animation scripts.
2. **Native compile** with gcc 13 and clang 22: `-std=c17 -Wall -Wextra -pedantic -g -O0`, plus `-Werror` unless a warning or error is expected.
   - By default, also build and run with `-fsanitize=address,undefined -fno-sanitize-recover=all`. A sample must be sanitizer-clean unless it is `expect=ub|runtime-error` or `sanitize=off`.
3. **Native run** with stdin as a pipe, stdout on a pty (wasm stdout reports itself as a tty, so line buffering matches **[V]**) and stderr captured separately; strip `\r`. `stdout=pipe` samples run with a pipe instead, for lessons about buffering. There is a timeout and a byte cap.
4. **Browser toolchain in Node.** The same `@yowasp/clang` (the exact slimmed `dist/toolchain` copy that ships), the same flags, and `browser_wasi_shim`, so CI runs what learners run.
   - **The browser compile must be warning-free unless warnings are expected.** clang 22 warns on some code that gcc and clang 18 accept cleanly, e.g. `printf("%ld", int64_t)` and `char s[5] = "hello"` **[V]**.
5. **Normalise.**
   - Only output produced by `%p` (detected from the source, or `norm=ptr`) is tokenised as `<addr1>…` in order of first appearance, so pointer equality survives.
   - On those lines, `0`, `0x0` and `(nil)` are one `<NULL>` token (musl prints NULL as `0` **[V]**).
   - Other hex output, e.g. `%#x` of `0xdeadbeef`, is left alone.
   - A separate "display" rendering rebases address clusters to stable, realistic values **[V]**.
6. **Check.**
   - `expect` holds per compiler.
   - Runtime output from gcc and clang must agree unless the sample is `platform`, `ub` or `runtime-error`. Sanitizer and guardrail reports are compared by (file, line, error kind), ignoring column, addresses and frames.
   - Diagnostics are compared by (line, severity, normalised flag) per compiler, not by raw text, and gcc's and clang's warnings need not match **[V: they genuinely differ]**.
7. **Write** `src/generated/samples/<module>.json`.
8. **Cache** by content hash over code, meta, compiler versions, the verifier's own source, and all runtime files (`course_rt.c`, `ubsan_rt.c`, `leakcheck.c`, `learnc.h`, the slimmed sysroot).

### 3.2 The 64-bit vs browser difference check (automatic)
- **Auto-flag.** Any sample whose normalised **browser** output differs from **native gcc x86-64**, or from **any stored target output**, is flagged automatically. If the author hasn't added `platform` **and** a `predict64` decision, the build (or the targets workflow) fails and prints the diff.
- **Both results.** A flagged sample renders both results: "Your browser (wasm32)" and the learner's platform, for example "macOS arm64 (stored)" or "Linux/WSL x86-64 (stored)". The platform comes from the "my machine" setting (Mac Apple Silicon, Mac Intel, Windows + WSL, Linux x86-64, Linux arm64 / WSL on ARM), and "show all platforms" reveals every stored target.
- **64-bit prediction.** When the difference is derivable (sizeof, type limits, struct layout or padding), the author declares `predict64` and the learner **predicts the 64-bit value before it is revealed**. Pattern heuristics in the verifier only *suggest* candidates to the author.
- **Edits.** The editor hashes source + stdin + args + mode. When the learner changes any of them on a flagged sample, the stored panels are replaced by: "Your edit changes this program, so the stored 64-bit output no longer applies. Run it locally (Module 3 shows how)." The stepper uses the same check to mark a trace stale.
- **Per-target outputs.** A `targets` CI workflow writes `src/generated/targets/<target>/`:

  | Target | Samples |
  |---|---|
  | macOS arm64 (Apple clang) | all |
  | Linux aarch64 gcc (`ubuntu-24.04-arm`) | all |
  | Windows x64 MSVC (`cl /std:c17 /W4`) | `platform` samples, e.g. the 4-byte `long` |

  - Results are committed by a fetch script or a bot commit, with a content-hash manifest.
  - The Linux staleness check excludes them, but a module isn't "done" until every target is green.
  - On private repos, macOS minutes cost 10× (§12).

  This makes platform values (Apple's 8-byte `long double`, unsigned `char` on aarch64 Linux, Windows' `long`) real outputs, never written from memory.

### 3.3 Other generators
- **Assembly.** `-S -O0/-O1 -fcf-protection=none` listings with source-line maps, produced on each real target: x86-64 Linux (gcc/clang), aarch64 Linux, arm64 macOS. Used by V7 and M10.
- **Traces (`trace` samples).** gdb-Python stepping with a `--wrap=malloc/free` shim records:
  - frames and in-scope locals (name, type, address, size, value);
  - globals;
  - typed heap blocks and pointer targets (local/global/heap/freed);
  - return values and stdout.

  An optional Valgrind pass adds exact "uninitialised" bits and use-after-free errors. Measured at about 0.2 s per program and 1–2 KB gzip per trace **[V]**. Traces are labelled **"x86-64 Linux (gcc)"**. aarch64 register traces for V10 come from the arm64 runner.
- **Exercises (`npm run verify:exercises`).** Every reference solution **passes** and every starter **fails** at least one test. Every variant is checked the same way.
  - Browser exercises are checked in the Node browser toolchain.
  - Native exercises and projects are checked with `check.mjs` on Linux, with ASan and leak checks, and the macOS job covers its `leaks` path.
  - Negative tests must supply stdin and assert on output; during prototyping, a starter once "passed" by accident **[V]**.
- **Quizzes.** Every answer reference must resolve to a generated output.
- **Event-loop oracle (M8).** Expected orders come from running the equivalent JS in Node.

### 3.4 Undefined behaviour, nondeterminism and prediction answers
- **UB rule.** UB appears in a prediction only when UB is the lesson. Those questions are categorical:
  - Does it crash?
  - Same value every run?
  - What does the compiler, UBSan or ASan report?

  The accepted answer is the **set of outcomes observed** over 3 runs on every target. Garbage values are never asked.
- **Determinism.** Fork, thread or timing samples must be made deterministic (wait/pipe ordering), or answered as a set of outcomes.

### 3.5 Browser checks
- `npm run e2e`: Playwright opens **every lesson** and completes every interaction with generated answers:
  - predicts, runs, and submits reference solutions;
  - exercises the hint, solution and variant gates;
  - fills diagrams;
  - passes the checkpoint and checks the next module unlocks;
  - runs axe.
- Chromium runs per change.
- Video playback is tested with a WebM fixture, because open-source Chromium can't decode H.264.

### 3.6 Per-module definition of done
1. **`npm run verify`.** Every sample compiles cleanly with `-std=c17 -Wall -Wextra -pedantic`, in gcc, clang 22 and the browser compiler (with ASan+UBSan natively), except deliberate demos. Outputs are regenerated, and there are no undeclared cross-target diffs.
2. **`npm run verify:exercises`.** Solutions pass, starters fail, variants pass.
3. **`npm run lint:content`.** Word budget, cadence, fence ids, checkpoint composition, analogies, references.
4. **`npm run anim:check`.** `hyperframes lint` + `check --strict`; renders match the hash manifest.
5. **`npm run videos:check`.** oEmbed OK, and the anchor quotes match the committed transcript excerpts. CI never calls yt-dlp, because YouTube rate-limits datacenter IPs. Transcripts are refreshed manually.
6. **`npm test` and `npm run e2e`.**
7. **Platform targets green.** Project zips are verified on Linux and macOS.

---

## 4. Local toolchain, projects and animations

### 4.1 Local setup (Module 3)
- **macOS.**
  - `xcode-select --install` gives Apple clang, lldb and `leaks`; Node comes from nodejs.org or nvm.
  - No gdb or Valgrind on Apple Silicon, and LeakSanitizer is unsupported, so the runner uses `leaks --atExit`.
  - **Optional Linux route** for Valgrind and gdb: a container (OrbStack, Docker or Lima running Ubuntu arm64) or GitHub Codespaces. This route lets Mac learners also do the Valgrind parts of the success criteria; otherwise they meet Valgrind only through stored reports.
- **Windows.**
  - `wsl --install -d Ubuntu-24.04` (matches CI's gcc 13 and valgrind 3.22), then `sudo apt install build-essential gdb valgrind unzip curl`, then Node LTS via nvm.
  - Work in `~`, not `/mnt/c`.
  - Native Windows compilers aren't supported, but the course flags MSVC's 4-byte `long` with real stored output.
- **Editor.** VS Code + clangd + CodeLLDB, or any editor and terminal.
- **`doctor.sh`** prints:
  - architecture, compiler and Node versions;
  - the `sizeof` table;
  - cache-line and page size (Apple Silicon reports 128 B lines and 16 KiB pages).

  It also builds hello with the strict flags, runs an ASan smoke test, and prints a token the app accepts.

### 4.2 Projects and the `check.mjs` runner
**Every project** has a downloadable starter zip, including P1 and P2, which are graded in the browser and can be re-run locally after M3. Each zip contains:
- `README.md` and starter files;
- a Make-3.81-safe `Makefile` (macOS ships GNU Make 3.81);
- `check.json` with hints, and `tests/`;
- the shared `check.mjs`;
- `.learner`.

**What `check.mjs` does.** It is single-file, zero-dependency, Node 18+. On Linux it scored a reference solution 9/9 and a buggy starter 2/9, with readable messages **[V]**.
- Finds a compiler: `$CC`, then `cc`, `clang`, `gcc`.
- Runs a clean build of the **unmodified** sources with the strict flags.
- Runs I/O tests and unit tests.
- Memory checks:
  - ASan+UBSan, plus LSan on Linux;
  - `leaks --atExit` on macOS;
  - Valgrind on Linux where no sanitizer runtime exists.
- Explains failures: the first differing character, plain-English signal explanations, progressive hints.
- Prints the progress code or completion token.

**Unit-test harness, one scheme in both runners.**
- The harness `#define`s `main` to `learner_main` and `#include`s only the file that defines `main`, with `-Wreturn-type` and `-Wmissing-prototypes` silenced around the include.
- It never trusts `learner_main`'s return value.
- Multi-file projects (P3 onward) are driven through **`make` targets declared in `check.json`**, so dependency and library checks (P3, P8, P11) test the learner's real build.
- "Tests not shown by default" ship in the zip; nothing is truly hidden on a static site.

### 4.3 Helper header
`learnc.h` is our own MIT header. libcs50's licensing is ambiguous (BSD-3 in the file header, GPL-3.0 in the repo **[V]**), so we don't ship it.
- It provides `int get_int(const char *prompt)`, `long long get_ll(...)`, `double get_double(...)` and `const char *get_line(...)`. They re-prompt on malformed input and exit on EOF; an empty line is valid input for `get_line`.
- It also provides a seeded PRNG.
- The source is visible from day one.
- In M6 learners write their own `char *read_line(void)`: it returns heap memory that the caller frees.

### 4.4 Conventions and licensing guard
- **C17 + standard library** everywhere. POSIX appears only in M11 (`dlopen`, loading), M13 (the OS module) and the capstone's provided `memlib`.
- **POSIX samples** start with `#define _POSIX_C_SOURCE 200809L`. Add `_DEFAULT_SOURCE` (glibc, for `d_type`) or `_DARWIN_C_SOURCE` (macOS, `MAP_ANON`) where needed, because strict `-std=c17` hides `clock_gettime`, `strdup`, `fileno` and `DT_DIR` on glibc **[V]**. This is introduced in 11.3 and taught in M13.1.
- **No POSIX before M11.** M9's benchmarking uses C11 `timespec_get` in a provided harness. Learners write their own case-insensitive compare instead of `strcasecmp`, and their own string duplication instead of `strdup`.
- **Originality.** All specs, starters and datasets are original:
  - texts from Project Gutenberg;
  - CC0 images;
  - a permissively licensed word list, confirmed when M9 is built.
- **CS50** problem names appear only in the parity mapping.
- **Notices.** An "About / Licenses" page carries the notices: LLVM (Apache-2.0 WITH LLVM-exception), wasi-libc, browser_wasi_shim, HyperFrames (Apache-2.0), GSAP's standard no-charge licence (build-time only; MP4s ship no GSAP), and the OFL fonts.

### 4.5 YouTube embeds
- **`videos.json` fields:**
  - `id`, `title` (from oEmbed), `channel`;
  - `module`, `lesson`;
  - `start` and `end` in seconds;
  - `anchorStart` and `anchorEnd`: the transcript lines at those times;
  - `why`;
  - `verifiedAt`.
- **Transcripts.** The full segment plus 60 s either side is committed under `tools/videos/transcripts/`, so CI never needs yt-dlp.
- **`<YouTube>` component.**
  - Embeds `https://www.youtube-nocookie.com/embed/ID?start=S&end=E` behind a click-to-load facade.
  - Shows the transcript excerpt and the duration.
  - Is always followed by an interaction.
- **Length.** Segments stay short (≈2–6 min), so no in-video pause API is needed.
- **Budget.** Video minutes count toward lesson time.

### 4.6 Animations (HyperFrames)
**Layout.** `animations/aNN-topic/` is one self-contained HyperFrames project:
- a thin root `index.html`;
- one sub-composition per scene in `compositions/`;
- `index.motion.json` (timing assertions);
- `captions.json` → `.vtt`;
- vendored GSAP and woff2 fonts, synced from `_shared` (paths may not leave the project).

**Rules, enforced by lint/check or by convention:**
- Exactly one paused GSAP timeline per composition, registered last with the `window.__timelines ||= {}` guard.
- `fromTo` only.
- Step labels mirrored in `data-steps`.
- Animate transforms, opacity, colours and SVG stroke offsets only.
- No clocks, `Math.random`, network or CDN.
- Fonts via local `@font-face`.
- Text ≥24 px at 1080p, inside the title-safe area, with WCAG AA contrast.
- Captions as a sidecar, never burned in.

**Concrete values.** Values shown on screen (sizes, offsets, registers) are injected at render time from generated pipeline outputs through composition variables, and each animation states which platform it depicts.

**Skipped skill steps.** The skills' interactive and online steps (intent interview, `usage`, `publish`, `auth`, `skills update`) are skipped in this repo.

**Environment:** `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_BROWSER_PATH=<pinned chromium>`.

**Pipeline.** `npm run anim:render` is a hash-cached render (project, CLI version, browser and flags) producing:
- MP4 (H.264, CRF 30);
- `poster.webp`;
- step stills, for reduced motion;
- `steps.json` and `.vtt`.

Only the **MP4 is committed**, at ≈1.7 MB per minute, so ≈45 MB for 24 animations of about a minute each. A WebM (VP9) for browsers without H.264 is **transcoded from the MP4 with FFmpeg during the deploy build**, in seconds, not re-rendered.

**`<Explainer>` player.**
- Native `<video>`.
- Captions on by default.
- Step chips.
- Pause-at-step prediction prompts.
- Transcript.
- Keyboard controls.
- Reduced-motion still sequence.

**Palette.** A single **dark** render per animation, shown as-is in both app themes (§12).

### 4.7 Hosting and deploy
- **Pipeline.** GitHub Actions: `toolchain:prepare` (copy and slim from `node_modules` into `build/toolchain/clang-<ver>/`) → verify (cached; uses that copy) → build → copy it into `dist/toolchain/clang-<ver>/` → WebM transcode → deploy to Pages.
- **Portability.** The site needs no special headers; HashRouter with a relative base runs anywhere.
- **Pages limits.** 1 GB per site and ≈100 GB/month soft bandwidth, i.e. about 4,000 first-time toolchain downloads a month **[DOCS]**.
- **Alternatives.** Cloudflare Pages or Netlify serve brotli (≈15 MB first load) and allow headers.

---

## 5. Interaction types (components)

| Code | Component | What the learner does | Checked against |
|---|---|---|---|
| PR | `PredictRun` | Commits a prediction (output text, a value, multiple choice, or crash / compile error / runs) **before Run unlocks**, then sees the result and an explanation of the mismatch | Generated output (labelled by platform) |
| CT | `CodeExercise` | Writes code against automated tests, in the browser | `tests.json` via the in-browser runner |
| FB | `FixBug` | Gets a symptom report and a broken program; reproduces, fixes and passes the tests | `tests.json` (the starter is verified to fail) |
| MD | `MemoryDiagram` | Fills in stack frames, values, **addresses** (derived: a display base plus offsets or sizeof, platform-tagged) and pointer arrows, drawn or picked from a list | gdb trace at a step |
| PA | `Parsons` | Reorders scrambled lines (with distractors and optional indentation) | Accepted orderings, compiled and tested |
| CE | `CompilerError` | Reads a real diagnostic or tool report (clang 22 browser, gcc 13 WSL, Apple clang, linker, ASan/UBSan, Valgrind, `leaks`): which line, what's wrong, which stage? Then fixes it | Stored per-target output |
| SP | `StepPredict` | Predicts the next state of the stack/heap stepper (or CPU, cache, hash table) before stepping | Trace / simulator |
| NP | `NumberDrill` | Conversions in the number playground | Computed |
| TT | `TraceTable` | Fills variable values per iteration | Generated trace |
| AS | `AsmRead` | Matches assembly to C; predicts register values | Generated listings and traces |
| BENCH | `Bench` | Predicts relative cost, then measures | Pipeline runs (ordering, never absolute times) |
| LT | `LocalTask` | Native work (debugger, sanitizers, Make, POSIX, projects); pastes progress codes and the token | Token module (§2.5) |

**Rules**
- Raw run-specific addresses are never asked; derived addresses on stated bases are.
- `[both]` marks a PR on a flagged sample, showing the browser panel plus the learner's platform panel (§3.2); `[all targets]` shows every stored target.
- UB follows §3.4.
- Where platforms differ, every prediction is tagged with the platform it refers to.

---

## 6. Course outline

**Rhythm.** Each lesson is 25–60 minutes of 6–14 cards. Module hours include lessons (with video minutes), problem sets, the project, variants, the retrieval quiz and the checkpoint, at 5 h/week.

**Success criteria (SC):**

| SC | Criterion |
|---|---|
| SC1 | Source → process |
| SC2 | Memory layout |
| SC3 | Pointers, arrays, strings, structs, heap |
| SC4 | Debugger + sanitizers/Valgrind |
| SC5 | Lists, stacks, queues, hash tables, BSTs, tries |
| SC6 | Big-O, sorting/searching |
| SC7 | Data representation and bitwise ops |
| SC8 | CPU, registers, caches, access patterns |
| SC9 | Reading assembly |
| SC10 | Syscalls and the OS |
| SC11 | Multi-file, Make, headers, ABI |

Coverage levels: I = introduced, D = developed, **A** = assessed.

| # | Module | Lessons run in | Projects run in | Hours | Weeks | Ends at week | CS50x |
|---|---|---|---|---|---|---|---|
| 1 | C in Your Browser: From JS to C | browser | browser | 10 | 2 | 2 | W1 |
| 2 | Bits, Bytes & Numbers | browser | browser | 10 | 2 | 4 | W1 (Credit), W4 (hex) |
| 3 | **Going Native: Toolchain, Debugger, Sanitizers & Make** | native + browser | **native** | 10 | 2 | 6 | W2 (compile/debug), W4 (Valgrind) |
| 4 | Arrays, Strings & the Command Line | browser | native | 10 | 2 | 8 | W2 |
| 5 | Algorithms, Recursion, Structs & Big-O | browser | native | 18 | 3.6 | 11.6 | W3 |
| 6 | Pointers & Dynamic Memory | browser + [both] | native | 15.5 | 3.1 | 14.7 | W4 (a) |
| 7 | Structs, Files & Binary Formats | browser snippets + native | native | 15 | 3 | 17.7 | W4 (b) |
| 8 | Data Structures I: Lists, Stacks, Queues, Trees | browser visualizers + native | native | 15 | 3 | 20.7 | W5 (a) |
| 9 | Data Structures II: Hash Tables, Tries & Speller | browser visualizers + native | native | 15.5 | 3.1 | **23.8 ← CS50 C parity** | W5 (b) |
| 10 | Inside the CPU: Instructions, Registers & Assembly | native + browser | native | 17 | 3.4 | 27.2 | — |
| 11 | Linking, Loading, Libraries & the C ABI | native + browser | native | 10 | 2 | 29.2 | — |
| 12 | Memory Hierarchy & Performance | browser simulator + native | native | 13.5 | 2.7 | 31.9 | — |
| 13 | The Operating System (POSIX) | native | native | 15.5 | 3.1 | 35 | — |
| Cap | Build `malloc`: your own allocator | native | native | 25 | 5 | 40 | — |
| | **Total** | | | **200 h** | **40 wk** | | |

- **Fast lane (≈190 h):** skips bitlab-lite, the "implement all three sorts" extension, the Runoff warm-up, the TinyCPU problem set, P12 part C (the ≥3× speedup; optional for the gate) and the mini `ls -l` (13.7).
- Two optional flex weeks are recommended.
- Interaction codes are from §5; visualizers V1–V10 from §7; animations A1–A24 from §8; videos from §9.

### M1. C in Your Browser: From JS to C (10 h, 2 weeks, browser)
**Why it matters:** learners write real C on day one with nothing to install. Real clang diagnostics replace TypeScript's "types are labels" with C's "types are memory layouts".

**Time:** lessons 4 h · problem set 2 h · project 2 h · variants 1 h · quiz + checkpoint 1 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 1.1 | Hello, compiled world (40m) | `main`, `#include`, `printf`, exit status; ahead-of-time compile vs JIT; what Run does | PR (escape sequences), CE (missing `#include`) | **A1**, V7 (live) |
| 1.2 | Types are layouts (45m) | `int`/`char`/`double`/`bool`, format specifiers; `7/2`, `-7/2`; `double avg = 7/2` compiles silently | PR, CE (`-Wformat`), NP teaser | V1 |
| 1.3 | Control flow (40m) | `if`, `switch` fall-through, `while`/`for`, do-while re-prompt; `=` vs `==` (`-Wparentheses`) | PA, FB (off-by-one pyramid), PR | — |
| 1.4 | Functions and scope (45m) | Prototypes (no hoisting), pass by value, block scope, no closures; `enum`/`#define`. Uninitialised locals: a compiler-warning question, not a value prediction | PR ("does the caller's variable change?"), **MD** (caller and callee frames for `add(x, y)`), **SP** (step the call), CT `max3` | V3 (first trace) |
| 1.5 | Input without magic (40m) | `learnc.h` (source visible); `scanf` pitfalls | CT Hello-It's-Me, PR | — |
| 1.6 | Read the compiler like a linter (35m) | Fix the first error first; warnings vs errors; the four build stages in one picture; `printf` with a missing argument as a CE item (UB rule, §3.4) | CE ×3, PR | — |

- **Problem set:** Hello, World; Hello, It's Me; Mario-less (warm-up); **Cash** (cents, positive int, greedy). The Cash variant shows greedy failing for coins {1, 3, 4}.
- **Project P1, Mario-more** (browser runner; also downloadable). The runner checks:
  - re-prompting on 0, 9, −1, `abc`, empty input and `42x`;
  - byte-exact output for heights 1–8;
  - a clean build.
- **Checkpoint:** 3 PR, 2 CE, 1 PA, 1 MD, 2 CT, 1 FB (a re-prompt loop that accepts 0). The transfer item is a third CT: validate a 24-hour time `HH MM` with re-prompting.
- **Retrieval:** JS diagnostic (`typeof null`, `0.1+0.2`, `Number.MAX_SAFE_INTEGER`, hoisting).
- **Resources:** Beej's Guide to C (v0.11) ch. 2 "Hello, World!", ch. 3 "Variables and Statements", ch. 4 "Functions"; K&R 2e §1.1–1.10.
- **Success criteria:** SC1 (I), SC2 (I), SC3 (I).
- **Analogies:**

| JS/TS | C | Where it breaks down |
|---|---|---|
| `let x: number` | `int x` | TS types are erased; C types decide size, instructions and silent truncation |
| `console.log` | `printf` | A mismatched format is UB, not coercion |
| Hoisting | — | C needs a prototype before the call |
| `let` scope | block scope | No TDZ and no `undefined`: an uninitialised local holds whatever was there |

- **Stage 2 includes all of M1**, with every interaction type the spec names (CT, FB, MD, PA, CE), plus PR and SP, and animation **A1**.

### M2. Bits, Bytes & Numbers (10 h, 2 weeks, browser)
**Why it matters:** JS hides everything behind one IEEE double. Pointers, files, hashing and assembly all assume fluency with widths, signedness and bytes.

**Time:** lessons 4.5 h (incl. 3 min video) · problem set 2 h · project 2 h · variants 0.5 h · quiz + checkpoint 1 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 2.1 | Binary and hex (40m) | Place value, nibbles, `#RRGGBB`, `%x`; `0b101` is not C17 (pedantic) | NP, PR, CE | V1 |
| 2.2 | Widths and `sizeof` (40m) | `<stdint.h>`, `size_t`; the size table across wasm32 / x86-64 / arm64 / Windows | PR (platform-tagged, with the 64-bit prediction step) | V1, V2 |
| 2.3 | Unsigned and two's complement (45m) | Unsigned wrap is defined; signed overflow is UB; casts; `-1 < 0u`; guardrail mode | PR, NP, CE (`-Wsign-compare`), FB (`unsigned i >= 0` loop) | **A3**, V1 |
| 2.4 | Bitwise operators and masks (45m) | Masks, flags, RGBA packing; shift rules and UB | CT pack/unpack, FB | V1 |
| 2.5 | Floating point (45m) | IEEE fields; `0.1+0.2`; `16777217.0f`; epsilon compares; NaN and Inf; C `round` vs `Math.round` | NP, PR | **A4**, V1 |
| 2.6 | Overflow in the real world (25m) | Why 32-bit counters fail in production | PR (the 248-day count, worked out), NP | **YT-1**, V1 |
| 2.7 | Characters as numbers (30m) | ASCII; `char` signedness varies by platform; bytes of a code point (shown in V2 only; strings come in M4) | PR, MD (bytes) | V2 |

- **Problem set:**
  - **bitlab-lite:** 6 operator-restricted puzzles, tested exhaustively, with a token scanner enforcing the allowed operators.
  - **`hexcolor`:** the starter parses `#RRGGBB` for you; you write the blending with bit operations.
- **Project P2, Credit (Luhn)** (browser runner; downloadable). It checks 20+ card cases and re-prompting. The browser runner's `long` is 32-bit, so 16-digit numbers expose learners who used `long` instead of `long long`.
- **Checkpoint:** 3 NP/PR, 2 PR (overflow, float), 1 MD (bytes), 1 CE (`-Wsign-compare`), 1 FB (unsigned loop), 2 CT. One CT is the transfer: RGB565 pack/unpack.
- **Retrieval:** M1.
- **Resources:** CS:APP 3e §2.1–2.4; Beej ch. 24 "Bitwise Operations" and ch. 37 "Fixed Width Integer Types".
- **Success criteria:** SC7 (I→A), SC3 (D).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| `x\|0`, `x>>>0` | `int32_t` / `uint32_t` | C signed overflow is UB, not wrap |
| TypedArrays | fixed-width types | C has no bounds checks |
| `DataView` | reading bytes | `DataView` defaults to big-endian; C on x86, ARM and wasm is little-endian |

### M3. Going Native: Toolchain, Debugger, Sanitizers & Make (10 h, 2 weeks, native + browser)
**Why now:** learners have just seen that the browser's `long` is 4 bytes. Their own machine says 8. From here on, every project is built, debugged and checked locally, as in the spec.

**Time:** lessons 4.75 h (incl. 1 h install) · project 3 h · variants 0.5 h · quiz + checkpoint 1 h · install buffer 0.75 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 3.1 | Install and doctor (60m) | macOS CLT, or WSL Ubuntu 24.04 + build-essential + gdb + valgrind + Node; VS Code + clangd; `doctor.sh`; Apple Silicon is arm64 | LT (doctor token) | — |
| 3.2 | Compiling by hand (45m) | `cc -o -g -O0/-O2 -Werror`; the four stages (`-E`, `-S`, `-c`, link) seen once; `-lm` differences; rerun `sizes.c` and predict 8-byte `long` | PR [both] with the 64-bit step, CE (which stage failed?) | **A2**, V7 |
| 3.3 | The debugger (60m) | lldb and gdb side by side: break, run, next, step, finish, bt, print, watch; debug Mario and Credit; the call stack you know from DevTools | LT (find the bug with `bt`/`watch`), SP (predict `bt` after `step`), PA (command sequence) | V3 bridge |
| 3.4 | Sanitizers (45m) | UBSan on M2's signed overflow and shifts; ASan on an out-of-bounds array write (arrays previewed; taught in M4) | CE (real UBSan and ASan reports), LT | — |
| 3.5 | Valgrind and `leaks` (30m) | Uninitialised values (the M1 lesson made visible); memcheck basics on Linux/WSL; `leaks` on macOS; the optional Linux-container route | CE | — |
| 3.6 | Two files and a Makefile (45m) | `.h`/`.c`, include guards, `extern`/`static` linkage, declaration vs definition; a Make-3.81-safe Makefile; `undefined reference` and `multiple definition` | PA (Makefile), CE (linker errors), LT (split Credit into files), CT (header + implementation in browser multi-file mode) | V7 |

- **Project P3, Toolchain Lab (local, `check.mjs`).** Restructure Credit into `main.c`, `luhn.c`, `luhn.h` and a `Makefile`, then fix 4 seeded bugs that come with **symptom-only reports**:
  - a signed overflow, found with UBSan;
  - an uninitialised variable, found with Valgrind or warnings;
  - an off-by-one, found with the debugger;
  - a truncating division, found with `watch`.

  Also write `diagnosis.md`. The runner checks:
  - the build via `make`, and that touching `luhn.h` rebuilds both objects;
  - all tests pass;
  - UBSan clean, and Valgrind or `leaks` clean;
  - `diagnosis.md` names the right lines;
  - then it prints the token.
- **Checkpoint:** 1 PR (64-bit sizeof), 1 SP (debugger state), 2 PA (debugger commands, Makefile), 3 CE (UBSan report, Valgrind/`leaks` report, linker error), 1 LT fix-bug, 1 LT write-code (add a module + header + Make rule). The transfer item is a CE: diagnose an unseen two-library link-order failure.
- **Retrieval:** M2, M1.
- **Resources:** Effective C 2e ch. 11 "Debugging, Testing, and Analysis"; GNU Make manual ch. 2 "An Introduction to Makefiles".
- **Success criteria:** SC4 (I→D), SC1 (D), SC11 (I).
- **Analogies:**

| Web dev | C | Where it breaks down |
|---|---|---|
| DevTools Sources | lldb/gdb | No hot reload; optimized builds show `<optimized out>`; a crash is a signal, not an exception |
| Source maps | `-g` (DWARF) | You must rebuild |
| npm scripts | Make | A timestamp-driven dependency graph; tab-sensitive recipes |
| `import` | `#include` | Textual paste; no module scope |

### M4. Arrays, Strings & the Command Line (10 h, 2 weeks; lessons in browser, project native)
**Why it matters:** C has no safety net here. Strings are NUL-terminated bytes, `==` compares addresses, and learners build real command-line tools, now with ASan watching.

**Time:** lessons 3.9 h · problem set 2.25 h · project 2.25 h · variants 0.6 h · quiz + checkpoint 1 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 4.1 | Arrays (40m) | Contiguous, no `.length`, no bounds checks; `sizeof a / sizeof a[0]`; decay in parameters (`-Wsizeof-array-argument`) | PR [both], MD, FB (OOB; ASan locally) | V2 |
| 4.2 | Strings are char + NUL (45m) | `"hello"` is 6 bytes; `<string.h>`; `strlen` is O(n); `strcmp` vs `==`; UTF-8 lengths (`strlen("é")`); `snprintf` | PR, MD | V2 |
| 4.3 | Character arithmetic (35m) | `<ctype.h>` (with the `unsigned char` cast); modular rotation | CT `rotate()`, PR | V1 |
| 4.4 | Text statistics and rounding (35m) | Counting letters, words, sentences; Coleman–Liau; `round` and `-lm` | CT, PR | — |
| 4.5 | `argc`/`argv` and exit codes (40m) | Validating a numeric argument with an `isdigit` loop (`strtol`'s end pointer comes in M6); exit codes | CT (args panel), FB (missing `argv[1]`) | — |
| 4.6 | 2D arrays and defensive strings (40m) | Row-major order; arrays of strings; buffer overflow; `fgets` | MD, FB (missing NUL), CE | V2 |

- **Problem set:** Scrabble; Readability; Caesar (warm-up).
- **Project P4, `cipher` (local).** Caesar + Substitution + `-d` to decrypt. The runner checks:
  - usage errors and exit codes;
  - key validation: 26 letters, no duplicates;
  - case preserved;
  - **decrypt(encrypt(x)) == x on 200 random strings**;
  - ASan/UBSan clean.
- **Checkpoint:** 3 PR [both], 1 MD, 2 CE, 2 CT (one is the transfer: Vigenère), 1 FB.
- **Retrieval:** M3, M2, M1.
- **Resources:** Beej ch. 6 "Arrays", ch. 7 "Strings", ch. 18 "The Outside Environment"; Effective C 2e ch. 7 "Characters and Strings".
- **Success criteria:** SC3 (D), SC7 (D), SC4 (D).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| `Array` | C array | Fixed size, one type, no `.length`; out of bounds is garbage or a crash, not `undefined`; can't be assigned or returned |
| `string` | `char[]` | Mutable UTF-8 bytes, not immutable UTF-16; length found by scanning; `==` compares addresses |
| `process.argv` | `argv` | User arguments start at index 2 in Node (after node and the script), at index 1 in C |

### M5. Algorithms, Recursion, Structs & Big-O (18 h, 3.6 weeks; lessons in browser, project native)
**Why it matters:** it gives the vocabulary of cost behind `.sort()` and `.includes()`, shows the real call stack, and teaches the graph reasoning Tideman needs.

**Time:** lessons 6 h · problem set 4 h · project 5.5 h · variants 1.25 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 5.1 | Search and Big-O (45m) | Linear vs binary search; O/Ω/Θ; overflow-safe midpoint | PR (comparison counts), TT, FB | V9 |
| 5.2 | Simple sorts (50m) | Bubble, selection, insertion; invariants; stability | PA, TT | V9 |
| 5.3 | Recursion and the call stack (50m) | Base cases, frames; what stack overflow looks like (browser vs native; outcome, never depth) | SP, PR [both] | **A5**, V3 |
| 5.4 | Merge sort (50m) | Divide and conquer, n log n; `merge_sort(a, tmp, n)` with a caller-provided scratch buffer | CT `merge_sort`, TT (merge buffer, after A6), PR | **A6**, V9 |
| 5.5 | Quicksort and partitioning (40m) | Lomuto/Hoare partition; average vs worst case; why libraries randomise pivots | CT `partition`, PR (worst case on sorted input) | V9 |
| 5.6 | Structs, first contact (40m) | `struct`, `typedef`, arrays of structs, designated initializers; **assignment copies** | PR (copy surprise), MD | V3 |
| 5.7 | Measuring growth (30m) | Doubling experiments, log–log plots; coarsened browser timers | BENCH, PR | V9 |
| 5.8 | Graphs for elections (45m) | Adjacency matrix, DFS cycle detection, ranked pairs | TT, CT `creates_cycle` | V9 (graph mode) |

- **Problem set:**
  - **Which Sort?** Three mystery binaries (pre-built wasm reading data files preloaded into the WASI filesystem) are identified by timing. **Then implement all three** on generated in-memory data and submit a doubling table.
  - Plurality.
  - Runoff (warm-up).
- **Project P5, Tideman (local, required).** A harness unit-tests:
  - `vote`, `record_preferences`, `add_pairs`, `sort_pairs`;
  - `lock_pairs` (direct, 3-cycle, indirect and multi-cycle cases);
  - `print_winner`;
  - a 9-candidate × 1000-voter time limit;
  - ASan clean.
- **Checkpoint:** 3 PR (Big-O classification), 2 TT, 1 SP (stack frame), 1 PA, 1 CE (`-Wreturn-type` on a recursive function missing a return), 2 CT (`partition`; count inversions with merge sort as the transfer), 1 FB (binary search).
- **Retrieval:** M4, M3, M2.
- **Resources:** CLRS 4e ch. 2 "Getting Started" and ch. 3 "Characterizing Running Times"; Erickson, *Algorithms*, ch. 6 "Depth-First Search".
- **Success criteria:** SC6 (A), SC2 (D), SC3 (D).
- **Analogies:**

| JS | C | Where it breaks down |
|---|---|---|
| "Maximum call stack size exceeded" | stack overflow | Both limits are in bytes. JS throws a catchable `RangeError` with a message; C gets SIGSEGV with no message (default 8 MiB main stack) |
| Objects by reference | structs | Assigning or passing a struct copies all of it |
| `arr.sort()` | your sorts | V8's sort is stable TimSort; C's `qsort` promises neither stability nor an algorithm |

### M6. Pointers & Dynamic Memory (15.5 h, 3.1 weeks; lessons in browser with [both] panels, project native)
**Why it matters:** this is the core skill gap. In wasm32, data memory really is one `ArrayBuffer` and a data pointer really is a byte offset, which makes the idea concrete. Stored native results show what a 64-bit OS does differently, and ASan is already on hand.

**Time:** lessons 5.75 h (incl. 3 min video) · problem set 1.5 h · project 5.5 h · variants 1.5 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 6.1 | Addresses (40m) | `&`, `%p`; data memory as one big `Uint8Array` | PR (relationships), MD (derived addresses) | V2 |
| 6.2 | Dereferencing and NULL (45m) | `*`, typed pointers; NULL behaves differently in the browser vs natively; guardrail mode; pointers as claymation | PR [both], MD | **A9**, V4, **YT-2** |
| 6.3 | Swap and out-parameters (45m) | `swap`; why `scanf` needs `&`; returning several values; `strtol`'s end pointer as an out-parameter | SP, FB (broken swap), CT (`parse_int(const char*, int *out)`) | **A7**, V3, V4 |
| 6.4 | Pointer arithmetic and arrays (45m) | `a[i] ≡ *(a+i)`, decay, one past the end; view a `uint32_t` byte by byte (endianness in code) | PR, PA | V2, V4 |
| 6.5 | `malloc`/`calloc`/`realloc`/`free` (50m) | `sizeof *p`, NULL checks, ownership, double free, leaks; ASan/LSan locally; leakcheck in browser | FB, SP, CE (ASan/LSan reports) | **A24**, V3 (heap) |
| 6.6 | Where every variable lives (45m) | text, rodata (string literals, `const` globals), data vs bss, heap, stack; `static` locals (static storage duration); register-only locals; native vs wasm32 region order; returning a local's address (a compiler-warning question); code-region addresses come from stored `nm` output, never from `(void*)main` | MD (place 20 declarations), PR [both] (region order), CE (`-Wreturn-stack-address`/`-Wreturn-local-addr`) | **A8**, V3 |
| 6.7 | Strings revisited, `char **`, streams (45m) | Literals are read-only natively; copying; arrays of pointers; `argv` layout; `getc` and `EOF` | PR [both], MD | V4 (argv mode) |
| 6.8 | `const` and ownership (30m) | `const T*` vs `T* const`; documenting who frees | PA, CE | — |

- **Problem set: Bug Hunt (local).** Four memory bugs with symptom-only reports ("garbage sometimes", "crashes on long names", "memory grows", "wrong after second call"). Each is found with ASan, Valgrind or `leaks` and fixed. Checked by `check.mjs`.
- **Project P6, `libstr` (local).** Implement:
  - `str_dup`, `str_concat_alloc`, `str_split` (`char**` + count), `str_join`, `str_trim`, `str_replace_all`, `strv_free`;
  - `char *read_line(void)` with `realloc` doubling, reading stdin; the caller frees.

  The runner checks:
  - unit tests and 1000 randomized property tests;
  - ASan + UBSan + LSan clean (`leaks` on macOS);
  - no `strdup` (checked with `nm`).
- **Checkpoint:** 3 MD, 1 SP, 2 PR [both], 1 CE (`-Wincompatible-pointer-types`), 1 FB (leak + use-after-free), 2 CT. One CT is the transfer: reverse the words of a string in place using pointers.
- **Retrieval:** M5, M4, M3, M2.
- **Resources:** K&R 2e §5.1–5.6; Beej ch. 5 "Pointers—Cower In Fear!", ch. 11 "Pointers II: Arithmetic", ch. 12 "Manual Memory Allocation".
- **Success criteria:** SC2 (A), SC3 (A), SC4 (A), SC7 (D).
- **Analogies:**

| JS / Browser | C | Where it breaks down |
|---|---|---|
| Object references | pointers | Pointers support arithmetic, can dangle, and can point at any variable including an `int`; NULL dereference is UB, not a TypeError |
| `WebAssembly.Memory` | address space | Data, heap and address-taken locals live in linear memory. Code, return addresses and other locals don't, and function pointers are table indices (`(void*)f` prints `0x1` **[V]**). Native memory is 64-bit virtual, with protected pages |
| GC | `free` | You choose lifetimes. A JS leak is still-reachable data; a C leak is unreachable but never freed |
| `arr.push` growth | `realloc` | `realloc` may move the block, invalidating old pointers |

### M7. Structs, Files & Binary Formats (15 h, 3 weeks; native, with browser snippets and BMP preview)
**Why it matters:** real data has byte-level layouts, and image filters give this visual audience instant feedback.

**Time:** lessons 4.25 h · problem set 1.25 h · project 6.5 h · variants 1.75 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 7.1 | Structs in depth (40m) | `->`, struct pointers, compound literals, passing by value vs by pointer | PR, CT | V4 |
| 7.2 | Alignment and padding (45m) | `offsetof`, reordering fields, `_Alignof`; why you don't `fread` into a padded struct | PR [all targets] with the 64-bit step, MD (padding bytes) | V2 (target toggle) |
| 7.3 | Text streams (40m) | `FILE*`, modes, `perror`/`errno`, stderr, exit codes | LT `mycp`, FB (unchecked `fopen`) | — |
| 7.4 | Binary I/O (45m) | `fread`/`fwrite` semantics, short reads, the `while(!feof)` bug; WAV header; scale and clamp | PR, FB, LT Volume | V2 (WAV overlay) |
| 7.5 | Images as pixel arrays (50m) | BMP headers, BGR, bottom-up rows, row padding; a flat pixel buffer `img[y*w + x]` (optional card: pointer-to-array `T (*p)[w]`); kernels | MD (padding in a 3-pixel row, after A10), CT, PR (blur value), FB (in-place blur) | **A10**, V2, BMP preview |
| 7.6 | Signatures and recovery (35m) | JPEG signatures, 512-byte blocks, a state machine, a mini `xxd` | TT (recovery state machine, after A11), CT | **A11**, V2 |

- **Problem set:** Volume (sample-exact, including clipping).
- **Project P7, Media Lab (local).** **All five filters** (grayscale, sepia, reflect, blur, edges) plus **Recover**. The runner checks:
  - per-function tests on tiny images;
  - whole-image byte comparison;
  - a 4000×3000 image without stack overflow;
  - Recover against a synthetic card built from CC0 images, with SHA-256 per recovered file;
  - ASan and leak checks clean;
  - all files closed;
  - the build through `make` targets.
- **Checkpoint:** 2 PR, 1 MD (a padded BMP row), 1 NP (read width, height and bit depth from a hexdump), 1 CE (Valgrind/ASan report), 3 CT (crop, flip, and the transfer: parse an unseen header spec), 1 FB (padding misread).
- **Retrieval:** M6, M5, M4, M3.
- **Resources:** Beej ch. 9 "File Input/Output" and ch. 20 "structs II"; Effective C 2e ch. 8 "Input/Output".
- **Success criteria:** SC3 (A), SC7 (A), SC4 (D), SC10 (I).
- **Analogies:**

| JS / Web | C | Where it breaks down |
|---|---|---|
| TS interface | struct | Fixed layout with padding; no dynamic keys |
| `DataView.getUint16(o, true)` | reading fields | `fwrite` of a whole struct isn't portable (padding, endianness, pointers) |
| `ImageData` | BMP pixels | `ImageData` is RGBA, top-down, unpadded and clamped; BMP is BGR, bottom-up and padded, and `uint8_t` wraps |

### M8. Data Structures I: Lists, Stacks, Queues, Trees (15 h, 3 weeks; visualizers in browser, project native)
**Why it matters:** learners use `push`, `shift` and `Map` daily without knowing the cost. Building the structures, and an event loop from them, turns pointer skill into fluency.

**Time:** lessons 4.35 h · problem set 2 h · project 5.5 h · variants 1.9 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 8.1 | ADTs, function pointers, generic code (45m) | Opaque types, create/destroy pairs; function pointers; `qsort`/`bsearch` comparators | CT, FB (a `return a-b` comparator overflowing), CE (incompatible function pointer) | — |
| 8.2 | Dynamic arrays (35m) | Doubling `realloc`, amortised O(1); the `p = realloc(p, n)` leak | PR, FB | V3 |
| 8.3 | Singly linked lists (60m) | Insert at head, tail and sorted; delete; free with a temp pointer; `node **pp` | MD, SP, FB (use-after-free) | **A12**, V4 |
| 8.4 | Stacks and queues (40m) | Array stack, circular buffer, linked versions | CT, PR | V4 |
| 8.5 | Binary search trees (50m) | Insert, search, delete; traversals; height; degenerate trees; post-order free | SP, PA, CT | V4 |
| 8.6 | Recursive ownership (30m) | Allocating and freeing a family tree | CT | V3 |

- **Problem set: Inheritance (local).** 1000 seeded runs check the structure and alleles, with zero leaks.
- **Project P8, `eventloop` (local).** Scripts such as `setTimeout A 10`, `then B`, `queueMicrotask C`, `log D` run on:
  - a circular-buffer macrotask queue;
  - a linked-list microtask queue;
  - a timer BST keyed by (time, seq).

  Delays below 1 ms are clamped to 1 ms, as in Node; `nextTick`, `setImmediate` and I/O phases are out of scope. The runner checks:
  - the order matches **real Node output generated at build time** (A13 introduces the structures);
  - unit tests per module, via `make`;
  - 10⁵ events within a time limit;
  - ASan clean.
- **Checkpoint:** 2 MD, 1 SP, 2 CT, 1 FB, 1 PR, 1 CE. The transfer item is 1 PR: a complexity table for a new ADT.
- **Retrieval:** M7, M6, M5, M3.
- **Resources:** K&R 2e §5.11 "Pointers to Functions" and §6.5 "Self-referential Structures".
- **Success criteria:** SC5 (A: lists, stacks, queues, BST), SC3 (A), SC6 (D), SC4 (D).
- **Analogies:**

| JS / React | C | Where it breaks down |
|---|---|---|
| React Fiber `child`/`sibling`/`return` | linked nodes | No GC: unlinking without freeing leaks |
| `arr.shift()` | queue | A naive shift is O(n); a circular buffer is O(1) but fixed-size unless you grow it |
| `arr.sort(cmp)` | `qsort` | `void*` arguments, no closures (`qsort_r` is non-standard), no stability guarantee |
| The event loop | P8 | Your model omits Node's phases, `nextTick` and `setImmediate`, and must reproduce Node's 1 ms clamp |

### M9. Data Structures II: Hash Tables, Tries & Speller (15.5 h, 3.1 weeks; visualizers in browser, project native) → CS50 C parity
**Why it matters:** `Map`, `Set` and object keys are hash tables these learners have never seen inside. Speller is CS50's showcase, and ours adds a performance gate.

**Time:** lessons 4.25 h · problem set 1.5 h · project 6.75 h · variants 1.75 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 9.1 | Hashing (40m) | djb2, FNV-1a; uniformity; mask vs `%`; case folding; the `unsigned char` cast | PR (bucket indices), CT | V5 |
| 9.2 | Separate chaining (45m) | Load factor, resize and rehash, key ownership | PR (bucket after growing, after A14), CT, SP | **A14**, V5 |
| 9.3 | Open addressing (40m) | Linear probing, tombstones, clustering | SP | V5 (probing mode) |
| 9.4 | Tries (50m) | 27-way nodes; memory cost per target (computed by the pipeline); O(L) lookup | MD, PR, **CT trie insert/lookup/free** (leak-checked) | V5 (trie mode) |
| 9.5 | Measuring honestly (40m) | C11 `timespec_get` in a provided harness; `-O2`; warm-up; median; a counting allocator | BENCH | — |
| 9.6 | Speller design studio (35m) | The `load`/`check`/`size`/`unload` contract; apostrophes; your own case-insensitive compare | PA, CT | — |

- **Problem set:** word-frequency counter (a hash map, then top-k with `qsort`).
- **Project P9, Speller (local).** A hash-table backend is required; the trie backend is optional, because the trie is already assessed in 9.4. The runner checks:
  - output identical to the reference on 10+ public-domain texts × 2 dictionaries;
  - `unload` frees everything;
  - **`check` time ≥ 2× faster than a provided sorted-array + `bsearch` baseline** (median of 5 runs at `-O2`, on the learner's machine);
  - the report parses.
- **Checkpoint:** 1 SP (V5 collisions, probes, resize), 1 MD (trie after inserts), 2 CT (open-addressing set with delete; trie prefix count), 1 FB (negative bucket index from signed `char`), 1 CE (ASan heap overflow), 2 PR (complexity; bytes per trie node per target). The transfer item is 1 PR: choose a structure for a new workload, from 4 options.
- **Retrieval:** M8, M7, M2, M5.
- **Resources:** K&R 2e §6.6 "Table Lookup".
- **Success criteria:** SC5 (A: hash tables, tries), SC6 (A), SC4 (A).
- **Analogy:**

| JS | C | Where it breaks down |
|---|---|---|
| `Map`/`Set` | hash table | You choose the hash, collision policy, resizing and key ownership; no insertion order |

### M10. Inside the CPU: Instructions, Registers & Assembly (17 h, 3.4 weeks; native + browser TinyCPU and stored listings)
**Why it matters:** learners see what their C becomes. Mac learners see arm64 and WSL learners x86-64, so every listing is shown for both, labelled by the platform that produced it.

**Time:** lessons 6 h · problem set 2.5 h · project 6.5 h · variants 0.75 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 10.1 | Machine model (45m) | Registers, PC, flags, memory; fetch–decode–execute on a toy ISA | SP | **A15**, V10 |
| 10.2 | Write the decode loop (45m) | TinyCPU core in C (`uint8_t mem[]`, bit-field decode, `switch`) | CT | V10 |
| 10.3 | From C to assembly (45m) | `-S` at `-O0`/`-O1`; clean listings; wasm is a stack machine | PR ("which C line?") | V7 |
| 10.4 | Moves and arithmetic (45m) | `lea` vs `add`; sign extension; `eax`/`rax`, `w0`/`x0` | PR, PA, AS | V7 |
| 10.5 | Control flow (45m) | Compare and branch; loops; jump tables; signed vs unsigned jumps | AS, PA | V7, V10 |
| 10.6 | Procedures and the stack (50m) | `call`/`ret`/`bl`; SysV vs AAPCS64 argument registers; **Apple arm64 passes variadic arguments on the stack**; saved registers; alignment; how a stack smash overwrites the return address | SP (register traces), MD | **A16**, V10, V3 |
| 10.7 | Data in assembly (40m) | Indexed addressing; field offsets = `offsetof` | PR, MD | V7 |
| 10.8 | `-O2` and instruction-level debugging (45m) | Folding, inlining, how the optimizer exploits UB, `volatile`; `stepi`, `disassemble`, `x/16xb` | PR ("what disappears?"), LT | V10 |

- **Problem set: TinyCPU emulator.** Checked against golden per-step register and memory traces on 20 programs.
- **Project P10, Asm Detective (local).**
  - A **4-phase** `phases.o` (string compare, arithmetic loop / jump table, recursion, linked nodes) chosen by seed from a **pool of 16 pre-built variants per target** (x86-64 ELF, aarch64 ELF, arm64 Mach-O, x86-64 Mach-O), built in CI. The learner links it and defuses it with the debugger.
  - Two "write C equivalent to this listing" items, checked with test vectors and an instruction budget at `-O1`.
  - Register values at a breakpoint.
- **Checkpoint:** 3 AS (asm→C on the learner's ISA), 1 MD (calling convention), 1 PA, 2 SP (register traces), 1 CE (interpret real `bt`/`info frame` output and an optimizer diagnostic), 1 FB (a signed/unsigned compare bug visible in the listing), 1 CT (write C for a listing). The transfer item is 1 AS: predict a mystery function's result.
- **Retrieval:** M9, M8, M6, M2.
- **Resources:** CS:APP 3e §3.1–3.7; plus one AArch64 reading for Mac learners, chosen and chapter-verified when M10 is built.
- **Success criteria:** SC8 (A: CPU, registers), SC9 (A), SC2 (A).
- **Analogies:**

| JS | Machine | Where it breaks down |
|---|---|---|
| V8 JIT | ahead-of-time compiler | A JIT speculates and deoptimizes; C is compiled once, with no guards |
| DevTools call stack | frames | Real frames are bytes holding a return address that can be overwritten |

### M11. Linking, Loading, Libraries & the C ABI (10 h, 2 weeks; native + browser multi-file)
**Why it matters:** it explains "undefined reference" errors and completes the source → process story. The C ABI is what N-API, Rust FFI and wasm exports speak.

**Time:** lessons 4.2 h · project 4 h · variants 0.8 h · quiz + checkpoint 1 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 11.1 | The four stages, for real (45m) | `-E -S -c`, link, `-v`; `nm`, `objdump`/`otool` | CE ("which stage failed?" ×6) | A2 recap, V7 |
| 11.2 | Symbols and linkage (45m) | `extern`/`static`, the one-definition rule, strong and weak symbols, relocation; ELF vs Mach-O | CE, FB (duplicate symbol; browser multi-file) | **A17** |
| 11.3 | Libraries (40m) | `ar`; `-fPIC -shared`; `-L`/`-l`; link order; `ldd`/`otool -L`; rpath; `dlopen` (POSIX; feature-test macros first met here) | LT, CE (loader errors) | V7 |
| 11.4 | Loading (40m) | Segments, entry → `main`, the dynamic loader, the PLT/GOT idea, ASLR | PR (`target=native`) | **A18**, V2 |
| 11.5 | Make, properly (40m) | Pattern rules, automatic variables, `-MMD -MP`, `.PHONY`, `-j` | PA, LT | — |
| 11.6 | The C ABI and FFI (40m) | Calling convention and struct layout as ABI; opaque pointers; symbol naming on macOS; wasm exports called from JS | CT (call your C from JS in the browser) | V7 |

- **Project P11, Libify (local).** Package the M9 hash table as `libdict.a` and `.so`/`.dylib`, with an opaque type, hidden visibility and a versioned header. The runner checks:
  - exported symbols = the API;
  - static and dynamic clients pass;
  - touching a header rebuilds only its dependents (from `make -n`);
  - **changing an internal struct and relinking only the library keeps the old client working**.
- **Checkpoint:** 3 CE (preprocess / compile / link-or-load), 1 PA (Makefile), 1 MD (segments), 2 PR, 1 CT (header + implementation pair in browser multi-file mode), 1 FB (missing `static`). The transfer item is 1 PR: "why does this library crash when the struct changes?"
- **Retrieval:** M10, M9, M3, M7.
- **Resources:** CS:APP 3e ch. 7 §7.1–7.12; GNU Make manual ch. 4 "Writing Rules" (incl. §4.14).
- **Success criteria:** SC1 (A), SC11 (A).
- **Analogies:**

| JS / npm | C | Where it breaks down |
|---|---|---|
| Bundler | compiler + linker | No runtime module registry; symbols are global unless `static` |
| `import()` | `dlopen` | Returns an untyped `void*` that you cast; nothing checks the type |
| `.d.ts` | header | A header is pasted in textually and can accidentally contain definitions |
| package.json `exports` | symbol visibility | Visibility is a linker property, not a language one |

### M12. Memory Hierarchy & Performance (13.5 h, 2.7 weeks; browser simulator + native measurements)
**Why it matters:** it explains why the same Big-O can run an order of magnitude slower. This audience already thinks in latency and caching from network waterfalls.

**Time:** lessons 4.2 h · project 7 h · variants 1.05 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 12.1 | Latency ladder (35m) | Registers → caches → DRAM → SSD; locality | PR | DevTools-waterfall analogy |
| 12.2 | Caches (50m) | Lines (64 B on most x86, 128 B on Apple Silicon), sets, ways, tags; direct-mapped vs associative; LRU; address split | SP (hit or miss), NP (tag/set/offset) | **A19**, V6 |
| 12.3 | Locality in loops (45m) | Row vs column order, measured natively and in the browser (ratios from pipeline runs) | PR (direction and order of magnitude), BENCH | V6 |
| 12.4 | Data layout (40m) | AoS vs SoA; pointer chasing vs arrays; chaining vs probing | PR, CT | V6, V2 |
| 12.5 | Honest benchmarking (40m) | Warm-up, median, sinks against dead-code elimination, variance; `clock()` for CPU time and `timespec_get` for wall time; `valgrind --tool=cachegrind` (Linux/WSL); `perf` and Instruments as optional extras | FB (a flawed benchmark), CE (cachegrind summary) | — |
| 12.6 | Blocking and compiler help (40m) | Tiling; `-O` levels, inlining, vectorisation (`-Rpass=loop-vectorize`), `restrict` | PR | V7 |

- **Project P12, cachesim + Make It Fast (local).**
  - (A) A trace-driven set-associative LRU simulator (`-s -E -b`). Hits, misses and evictions must match the reference on 8 configurations.
  - (B) A blocked transpose. A provided `A(i,j)` access macro logs addresses to a trace, so **the learner's own simulator** counts the misses. 32×32 must beat a threshold calibrated against a simple blocked reference; 64×64 counts toward distinction.
  - (C) ≥3× measured speedup on the learner's machine, plus a report.
- **Checkpoint:** 3 SP (V6), 1 NP (address split), 2 PR (performance ordering), 1 FB (flawed benchmark), 1 AS (assembly loop), 1 CE (vectorizer remark or cachegrind summary). The transfer item is a CT: a loop interchange.
- **Retrieval:** M11, M10, M4, M8/M9.
- **Resources:** CS:APP 3e §6.2–6.6.
- **Success criteria:** SC8 (A: caches, access patterns), SC6 (D), SC9 (D).
- **Analogies:**

| JS / Web | Hardware | Where it breaks down |
|---|---|---|
| HTTP/CDN cache | CPU cache | Hardware-managed, fixed-size lines, conflict misses, no invalidation API |
| Array of objects | array of struct *pointers* | A JS array of objects is pointer chasing, not AoS. Parallel TypedArrays ≈ SoA; one interleaved TypedArray ≈ AoS |

### M13. The Operating System: Processes, System Calls, Files & Virtual Memory (15.5 h, 3.1 weeks, native POSIX; WSL on Windows)
**Why it matters:** Node's `fs` and `child_process` are thin wrappers over these calls, and every shell pipe is `fork`, `exec` and `dup2`.

**Time:** lessons 5.25 h · small tools 1.5 h · project 6 h · variants 1.5 h · quiz + checkpoint 1.25 h.

| # | Lesson | Content | Interactions | Visual |
|---|---|---|---|---|
| 13.1 | The syscall boundary (45m) | User vs kernel mode, traps, libc wrappers, `errno`; feature-test macros; the browser's WASI log vs native `strace` | PR (count of `write` calls, tty vs pipe; `stdout=both`) | V8, **A20** |
| 13.2 | File descriptors (45m) | `open`/`read`/`write`/`close`/`lseek`; fds 0–2; buffer sizes; redirection | LT `mycat`, BENCH, PR | V8 |
| 13.3 | Processes and scheduling (60m) | `fork`/`exec`/`wait`, copy-on-write, zombies; **what the OS does for you: timer interrupts, context switches, limited direct execution**; duplicated output after `fork` when piped | PR (deterministic fork outputs), PR (context switches), PA | **A21**, V3 |
| 13.4 | Pipes and redirection (45m) | `pipe`, `dup2`; how `a \| b > f` works; an unclosed pipe end hangs | LT, MD (fd table) | V4 (fd-table mode) |
| 13.5 | Signals and exit status (35m) | SIGSEGV, SIGINT, SIGPIPE, SIGCHLD; 128+n; dispositions (`SIG_IGN` in the shell, `SIG_DFL` in the child before `exec`); async-signal-safety | LT (make a parent survive Ctrl-C), PR | — |
| 13.6 | Virtual memory (50m) | Pages (4 KiB; 16 KiB on Apple Silicon), page tables, TLB, faults, protection (why NULL faults natively but not in wasm); `mmap`; `/proc/self/maps` / `vmmap` | PR, MD (translate an address) | **A22**, V6 (address-split mode) |
| 13.7 | Files and directories (35m) | Inodes, `stat`, permissions, `readdir`; mini `ls -l` | LT | — |

- **Project P13, `msh` mini shell (local).** Prompt loop; builtins `cd`, `exit`, `pwd`; `fork`/`execvp`/`waitpid`; `$?`; `<`, `>`, `>>`; one `|`; Ctrl-C kills the child, not the shell. The runner checks:
  - output and files against `/bin/sh`;
  - **status 127 for a missing command**;
  - no zombies and no leaked fds;
  - Ctrl-C handling: it starts msh in its own process group, runs `sleep 5`, then sends SIGINT to the group, as a terminal does. The child must die and msh must print the next prompt;
  - ASan clean.
- **Checkpoint:** 2 PR (fork output, scheduling), 2 MD (fd table, VM translation), 1 PA (order the calls for `a | b`), 1 LT write-code (`run_pipeline`), 1 LT fix-bug (an unclosed pipe end hangs), 1 CE (an `strace` excerpt). The transfer item is 1 PR: "why does output appear twice after `fork`?" (`stdout=pipe`).
- **Retrieval:** M12, M11, M7, M6, M3.
- **Resources:** OSTEP v1.10 ch. 5 "Process API", ch. 6 "Mechanism: Limited Direct Execution" and ch. 39 "Files and Directories"; CS:APP 3e ch. 10 "System-Level I/O".
- **Success criteria:** SC10 (A), SC2 (A), SC1 (A), SC8 (D).
- **Analogies:**

| JS / Browser | OS | Where it breaks down |
|---|---|---|
| `child_process.spawn` | `fork` + `exec` | `fork` clones the whole process (memory and fds, copy-on-write); JS has no equivalent |
| Web Worker | process | A Worker is a thread inside the same OS process, starting fresh; a process has its own address space |
| `fs.openSync` fd | kernel fd | Same kind of number, but Node's first `openSync` returned 20, because libuv already holds fds **[V]**; a fresh C program's first `open` returns 3 |
| WASI in our runtime | syscalls | WASI calls are imported JS functions in the same process: no trap, no privilege switch, and no `fork` |

### Capstone: build `malloc`, then run your own programs on it (25 h, 5 weeks, native)
Implement `mm_malloc`, `mm_free`, `mm_realloc` and `mm_calloc` with 16-byte alignment, over a provided `memlib` (one `mmap` region; works on macOS and Linux).

| Week | Milestone |
|---|---|
| 1 | Implicit free list, boundary tags, first fit, and an `mm_check` invariant checker |
| 2 | Coalescing, splitting, in-place `realloc` (A23) |
| 3 | Explicit free list, then segregated lists |
| 4 | **Integration:** Speller (M9), `eventloop` (M8) and `msh` (M13) rebuilt on the learner's allocator. A provided `mm_shim.h` uses object-like macros (`#define free shim_free`, …), so `free` passed as a pointer still routes through the shim. The shim's `realloc` and `free` forward any pointer outside the mm heap to libc, so memory from `getline` or `opendir` stays safe. `mm_dump()` JSON feeds the V3 heap view |
| 5 | Benchmarking, tuning, and a report on utilisation vs throughput |

The runner uses about 12 trace-driven workloads. It checks:
- **correctness:** alignment, no overlap, payload integrity across `realloc`, `calloc` zeroing, and `mm_check` after every operation;
- **scores** relative to a provided reference allocator (pre-built objects per target from CI). To pass: utilisation within 10 points of the reference and throughput ≥0.5× the reference on the learner's machine. Beating the reference earns distinction;
- **integration:** byte-identical output from all three programs.

**Graduation check (60–90 min).** Draw a memory layout, diagnose errors by stage, read assembly, predict a fork program, interpret an ASan report, and choose a data structure.

**Resources:** CS:APP 3e §9.9 "Dynamic Memory Allocation"; K&R 2e §8.7 "Example—A Storage Allocator".

**Why it's harder than Speller:** raw pointer arithmetic, bit-packed headers, alignment, structures inside untyped memory, OS memory, performance work, and debugging without sanitizer coverage of the custom heap.

### 6.1 Success criteria → modules (I introduced, D developed, **A** assessed)
| Criterion | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | Cap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC1 source → process | I | | D | | | | | | | D | **A** | | **A** | |
| SC2 memory layout | I | | | | D | **A** | D | | | **A** | D | | **A** | D |
| SC3 pointers/arrays/strings/structs/heap | I | D | | D | D | **A** | **A** | **A** | D | | | | | **A** |
| SC4 debugger + ASan/Valgrind | | | D | D | | **A** | D | D | **A** | D | | | | **A** |
| SC5 lists/stacks/queues/hash/BST/trie | | | | | I | | | **A** | **A** | | D | | | D |
| SC6 Big-O, sort/search | | | | | **A** | | | D | **A** | | | D | | |
| SC7 bin/hex/2's comp/float/endian/bitwise | I | **A** | | D | | D | **A** | | D | D | | D | | D |
| SC8 CPU, registers, caches, access patterns | | | | | | | | | | **A** | | **A** | D | D |
| SC9 read assembly of own C | | | I | | | | | | | **A** | D | D | | |
| SC10 syscalls, files, processes, OS role | | | | | | | I | | | | | | **A** | D |
| SC11 multi-file, Make, headers, C ABI | | | I | | | | D | D | D | D | **A** | | D | **A** |

This matrix is authoritative. The per-module "Success criteria" lines list only the main entries.

### 6.2 CS50x (2026) problem-set parity
These were checked against cs50.harvard.edu/x/psets in October 2026.

| CS50 | CS50 requires | Ours | Module | At least as hard because |
|---|---|---|---|---|
| Hello, World / Hello, It's Me | both | both | M1 | — |
| Mario less / more | one | less as a warm-up, **more required** | M1 | the harder one is required |
| Cash / Credit | one | **both** | M1/M2 | both required |
| Scrabble, Readability | both | both | M4 | — |
| Caesar / Substitution | one | **`cipher`: both + decrypt + round-trip property tests** | M4 | both, plus property tests |
| Sort | identify | identify **+ implement all three + a doubling table**, plus quicksort | M5 | empirical Big-O |
| Plurality | yes | yes | M5 | — |
| Runoff / Tideman | one | **Tideman required** (Runoff as a warm-up) | M5 | the harder one, plus a DFS lesson |
| Volume | yes | yes, with clipping tests | M7 | — |
| Filter less / more | one | **all five filters + a 4000×3000 heap test** | M7 | the union of both |
| Recover | yes | yes, on a synthetic card with SHA-256 checks | M7 | randomized data |
| Inheritance | yes | yes, 1000 seeded runs, leak-free | M8 | — |
| Speller | yes | yes **+ must beat a `bsearch` baseline 2×**; a required trie exercise; then Libify (M11) and capstone integration on the learner's own allocator | M9 | performance gate + ABI packaging |

Beyond CS50: bitlab-lite, hexcolor, Toolchain Lab, Bug Hunt, `libstr`, `eventloop`, word frequency, TinyCPU, Asm Detective, Libify, cachesim, `msh`, `malloc`.

CS50 now compiles with `-std=c23 -Werror` (per cs50/cli). We teach **C17** as specified and point out C23 differences where they matter (`bool` as a keyword, `nullptr`, binary literals).

---

## 7. Visualizers (React components the learner controls)
| ID | Name | Used in | Modes | Prediction hook |
|---|---|---|---|---|
| V1 | Number Playground | M1, M2, M4 | binary/hex/decimal; two's-complement wheel; IEEE-754 float/double bit editor; overflow wheel; JS `Number` comparison | NP drills; PR on wrap and rounding |
| V2 | Byte Viewer | M2, M4, M6, M7, M11, M12 | hexdump; endianness; **struct padding with a wasm32 / x86-64 / arm64 / Windows toggle**; WAV/BMP/JPEG header overlays; live wasm data memory after a run | MD on padding and bytes |
| V3 | Stack/Heap Stepper | M1, M3, M5, M6, M8, M10, M13, Cap | frames, locals and typed heap blocks from gdb traces ("x86-64 Linux"); **predict the next state before stepping**; capstone `mm_dump` | SP |
| V4 | Pointer Diagram | M6–M8, M13 | auto-drawn from traces, plus drag-to-draw; list, tree, argv and fd-table modes | MD |
| V5 | Hash-Table Visualizer | M9 | hash function, bucket count, load factor, chaining, probing, tombstones, resize, trie mode, chain histogram | PR on bucket, probes, resize |
| V6 | Cache Simulator | M12, M13 | s/E/b, LRU, address trace from a C loop, hit/miss heat map, address-split mode reused for page translation | SP (hit or miss), NP (split) |
| V7 | Pipeline Explorer | M1, M3, M10–M12 | **live** in-browser `-E/-S/-c/nm/link` for wasm32; stored native x86-64/arm64 `.s`, `nm` and `objdump` panes with source-line highlighting | PR ("which line produced this?"), CE |
| V8 | Syscall Tracer | M13 | live WASI import log of a browser run, next to a stored native `strace` | PR (number of `write` calls) |
| V9 | Algorithm Race | M5 | bars with comparison and swap counters, doubling chart, graph/DFS mode | TT, PR |
| V10 | TinyCPU / Register Stepper | M10 | toy ISA plus stored gdb `stepi` register traces (x86-64 and aarch64 runners) | SP on registers and flags |

---

## 8. HyperFrames animations (30–90 s; each is followed by an interaction)
| ID | Lesson | Length | Shows | Interaction that follows |
|---|---|---|---|---|
| A1 | 1.1 | 45 s | Press Run: C → in-browser clang → `.wasm` → Worker → output panel | PR: which messages came from the compiler and which from the program? |
| A2 | 3.2 (recap 11.1) | 75 s | `hello.c` → preprocess → compile → assemble → link → **load** | CE: classify 3 failures by stage |
| A3 | 2.3 | 45 s | Two's-complement wheel; wrap vs UB | NP: place −1 and INT_MIN; PR on `unsigned char c = 250; c += 10;` (wraps to 4) |
| A4 | 2.5 | 60 s | Float fields: sign, exponent, mantissa | NP: decode `0x3F800000` |
| A5 | 5.3 | 50 s | Frames pushed and popped during recursion | SP: next frame of `fact(3)` |
| A6 | 5.4 | 60 s | Merge sort: split and merge with a scratch buffer | TT: the merge buffer's state |
| A7 | 6.3 | 50 s | Swap by value vs by address | SP + FB broken swap |
| A8 | 6.6 | 60 s | Where variables live: text, rodata, data/bss, heap, stack; native vs wasm32 order | MD: place declarations |
| A9 | 6.2 | 45 s | Why the browser didn't crash: linear memory vs virtual memory with an unmapped page 0 | PR [both]: what a NULL write does |
| A10 | 7.5 | 60 s | BMP anatomy: headers, BGR, bottom-up rows, padding | MD: padding in a 3-pixel row |
| A11 | 7.6 | 60 s | Carving JPEGs from 512-byte blocks | TT: recovery state machine |
| A12 | 8.3 | 50 s | Linked-list insert, delete, free with a temp pointer | MD: redraw the arrows |
| A13 | 8 (P8 intro) | 60 s | The event loop as C structures (ring buffer, list, timer BST) | PR: order of a 6-line script |
| A14 | 9.2 | 75 s | Hashing into buckets, chaining, resize and rehash | V5 PR: bucket after growing |
| A15 | 10.1 | 60 s | Fetch–decode–execute | SP: next PC and register |
| A16 | 10.6 | 60 s | Calling convention: argument registers, `call`/`ret`, the frame | SP: rdi/x0 at callee entry |
| A17 | 11.2 | 75 s | Symbol resolution and relocation | CE: which definition does each reference resolve to? |
| A18 | 11.4 | 75 s | exec → loader → dynamic linker → `main` | PR: what changes between runs (ASLR) |
| A19 | 12.2 | 75 s | Cache lines and sets; row vs column order | V6 SP: next 8 accesses |
| A20 | 13.1 | 60 s | `printf` → buffer → `write` syscall → kernel → terminal | PR: `write` count, tty vs pipe |
| A21 | 13.3 | 60 s | `fork`/`exec`/`wait`, copy-on-write, and a timer interrupt switching processes | PR: output lines of a (deterministic) fork tree |
| A22 | 13.6 | 90 s | Virtual → physical translation, page table, TLB | MD: translate an address |
| A23 | Cap week 2 | 75 s | Free-list split and coalesce with boundary tags | V3 SP: free list after `free(b)` |
| **A24** | **6.5** | **60 s** | **malloc carving up the heap**: requests split a free region, `free` returns blocks, fragmentation appears | SP: which block does the next `malloc(24)` get? |

Each animation states the platform its concrete values come from; the values are injected from pipeline outputs at render time.

---

## 9. YouTube segments (≤2 per module; `videos.json` is delivered for review in Stage 2)
Both video IDs are confirmed via oEmbed as official CS50 channel uploads **[V]**. Boundaries come from the **YouTube** transcripts **[V]**. Each starts and ends on a sentence.

| ID | Video | Start–end (s) | Length | Topic | Lesson | Why it earns its place |
|---|---|---|---|---|---|---|
| YT-1 | CS50x Lecture 1 – C `SlqjA04_dpk` | 8531–8701 (02:22:11–02:25:01) | 2:50 | Integer overflow in the real world: the Boeing 787 "248 days" power-off bug and Pac-Man's level 256 | 2.6 | Real incidents give the stakes behind a 32-bit counter, which no visualizer can. It's followed by working out the 248-day figure with V1 |
| YT-2 | CS50x Lecture 4 – Memory `db0H0U13YsA` | 5260–5427 (01:27:40–01:30:27) | 2:47 | Binky Pointer Fun (Stanford claymation): pointer vs pointee, dereferencing an unassigned pointer | 6.2 | A memorable, widely loved mental model of pointee allocation that our diagrams can't make as sticky. It's followed by an MD of an original Binky-style program up to `y = x`; the unassigned-pointer write is a categorical PR [both] (§3.4) |

**Anchor lines from the transcripts**
- YT-1 begins "So that too was a problem, and this happens truly in the real world. So picture here is a Boeing 787…" and ends "…hit level 256 in this way because of this bug."
- YT-2 begins "…as we'll see now, some claymation. So here I give you a binky." and ends "…I can only imagine how long that took Nick."

**Considered and dropped.** These CS50 segments were not used, because our visualizers or animations make the same idea interactive: the four compile steps, strings and NUL, merge sort, the memory layout talk, debug50 (VS Code-specific), Valgrind, linked lists, trees, hash tables and tries.

**M10–M13.** Real-hardware footage, e.g. a breadboard CPU executing instructions, may beat an animation for M10. If so, a segment will be searched for, verified the same way and proposed when M10 is built.

---

## 10. Further study (out of scope rather than skimmed)
- Concurrency: threads, atomics, races (OSTEP ch. 26–33; CS:APP ch. 12; Beej ch. 39–40).
- Networking and sockets (CS:APP ch. 11).
- A full job-control shell, signals in depth, nonlocal jumps (CS:APP §8.5–8.6).
- Virtual-memory internals and file-system implementation (OSTEP ch. 18–23, 40–42).
- Garbage collectors (CS:APP §9.10).
- Processor design and building a computer (CS:APP ch. 4; Nand2Tetris projects 1–5).
- Optimisation in depth, SIMD, floating-point assembly, PIC/GOT/PLT details (CS:APP ch. 5, §3.11, §7.12).
- Exploits and mitigations (CS:APP §3.10.3–3.10.4).
- Algorithms beyond the core: balanced trees, graph algorithms, dynamic programming (Erickson; CLRS 4e).
- C23 in full (Effective C 2e; Modern C).
- Unicode handling (Beej ch. 26–27).
- Tooling: fuzzing (libFuzzer/AFL++), static analysis (`clang-tidy`, `gcc -fanalyzer`), CMake.
- CS50 Weeks 6–10 (Python, SQL, web): out of scope by design.

---

## 11. Build roadmap

| Stage | Session(s) | Output | Stop for review |
|---|---|---|---|
| **1** | this one | Research; prototypes saved in `research/`; **PLAN.md**; initial AGENTS.md | **yes (now)** |
| **2** | 2–3 | App shell (HashRouter, theme, namespaced progress store with export/import and reminders, gating, card engine, MDX pipeline); in-browser runtime (compiler + run workers, JSPI stdin, `sleep` override, full guardrail UBSan runtime, `leakcheck.c`, caching); `tools/verify` (native + browser-in-Node + targets workflow), `tools/trace`, `tools/check` with the shared token module, content lint, e2e harness; CI workflows; **Module 1 end to end** (every spec-named interaction type plus PR and SP; V1 basic, V3, V7 basic; animation **A1**; P1 Mario-more); `videos.json` (YT-1, YT-2) for review. **Exit criteria:** AGENTS.md updated with the content format, schemas and real npm scripts; the §3.6 checklist green for M1 | **yes** |
| 3.n | one per module | M2 … M13, then the capstone, each passing §3.6 and adding its visualizers and animations as listed | **yes, after each** |

### Risks and mitigations
| Risk | Mitigation |
|---|---|
| First Run downloads ≈24 MB (gzip) | Lazy load, progress bar, persistent cache (0 requests on repeat visits **[V]**), stored outputs viewable without compiling, brotli where the host supports it |
| yowasp is young and built with LLVM assertions on | Pin the exact version and vendor the files; `CompilerBackend` interface; live-codes as the tested fallback |
| JSPI missing on Chromium older than 137 | Pre-filled stdin box (works, but unsupported) |
| Browser storage cleared or evicted | Export reminders; `persist()`; namespaced keys |
| macOS/arm64/Windows outputs can't be produced on Linux | CI runners per target, with outputs committed through a manifest |
| HyperFrames CLI is pre-1.0 and releases daily | Pin the version; MP4s committed; `check --strict` in CI |
| Completion tokens can be forged | An honour system by design (no backend), stated openly |
| The AI tutor is wrong, or gives the answer away | It only sees real run results and must quote them; replies pass a leak guard against the reference solution; it is off in checkpoints and on variants (§2.6) |
| A learner's API key leaks from the browser | The key is the learner's own, kept in its own storage key, never exported; Settings recommends a key with a spending limit and offers "Remove key" (§2.6) |

---

## 12. Decisions (confirmed by the client, Stage 1 review)
1. **Hosting.** The repo is public, so we deploy to GitHub Pages via Actions. The macOS, arm64-Linux and Windows CI runners are free.
2. **Rendered animations.** Commit the MP4s; WebM is transcoded at deploy. Each re-render adds a new copy to git history, but at ≈2 MB per animation this is negligible.
3. **Course length.** Keep ≈200 h (40 weeks at 5 h/week), with the fast lane as defined.
4. **Capstone.** The allocator only; Speller Pro is dropped. CS50's Speller parity is already met in M9.
5. **Browser floor.** Accepted: Chromium-based browsers with JSPI (137+) get interactive `scanf`; older ones get the pre-filled stdin box. Superseded in part by item 9.
6. **Animation palette.** A single dark render per animation, shown as-is in both app themes.
7. **Videos.** "Only when it clearly beats the app" is the bar.
8. **Local toolchain timing.** Module 3 (weeks 5–6) stays.
9. **Chromium only (2026-10-17).** The owner runs the course in Chromium-based browsers only. Firefox and Safari (including iOS) are not supported, tested or tracked: no cross-browser tickets, no WebKit or Firefox Playwright projects, no manual Safari check.
10. **AI tutor (2026-10-17).** The owner chose bring-your-own-key over a server proxy: an optional tutor that calls an OpenAI-compatible chat API (OpenRouter by default) from the browser with the learner's own key and model. The site stays static and the course pays nothing for it (§2.6).
