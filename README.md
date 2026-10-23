<div align="center">

# The Definitive C Course

**Learn C17 and how computers really work, by predicting, breaking and fixing real programs, with a compiler that runs in your browser.**

[**Start learning**](https://abhishekangira.github.io/The-Definitive-C-Course/) · [Course outline](PLAN.md) · [Contribute](AGENTS.md) · [MIT licence](LICENSE)

</div>

---

## What is this?

An interactive course for **front-end engineers** who know JavaScript and want to understand what is underneath it: memory, pointers, the CPU, linking, the OS. There is no backend and nothing to install to begin. Open the site in a Chromium-based browser (Chrome, Edge, Brave and similar; Chrome 137 or newer), and you are compiling and running C within seconds. Firefox and Safari, including iOS, are not supported.

The course has 13 modules and a capstone (about 200 hours, or 40 weeks at 5 hours a week). Modules 1 and 2 are live; the rest are planned in [`PLAN.md`](PLAN.md).

| | Module | Hours |
|---|---|---|
| 1 | C in Your Browser: From JS to C | 10 |
| 2 | Bits, Bytes & Numbers | 10 |
| 3 | Going Native: Toolchain, Debugger, Sanitizers & Make | 10 |
| 4 | Arrays, Strings & the Command Line | 10 |
| 5 | Algorithms, Recursion, Structs & Big-O | 18 |
| 6 | Pointers & Dynamic Memory | 15.5 |
| 7 | Structs, Files & Binary Formats | 15 |
| 8 | Data Structures I: Lists, Stacks, Queues, Trees | 15 |
| 9 | Data Structures II: Hash Tables, Tries & Speller | 15.5 |
| 10 | Inside the CPU: Instructions, Registers & Assembly | 17 |
| 11 | Linking, Loading, Libraries & the C ABI | 10 |
| 12 | Memory Hierarchy & Performance | 13.5 |
| 13 | The Operating System (POSIX) | 15.5 |
| Capstone | Build `malloc` | 25 |

## Features

### A real C compiler in your tab
- **Clang 22 compiled to WebAssembly** (`-std=c17 -Wall -Wextra -pedantic`), running programs in a sandboxed per-run worker. No server, no install, no sign-up.
- **Real stdin**, command-line arguments, exit codes, and compiler diagnostics shown exactly as the compiler printed them.
- **Guardrail mode** adds UBSan so undefined behaviour is caught instead of silently "working", and leak checks report `file:line` for every block you forgot to free.
- **A cache-first toolchain download** that heals itself after a corrupt or truncated load.
- **A free Playground** at `#/playground`: an ungated editor on the same compiler, with your draft saved in your own browser.

### You are never a passive reader
- **Predict before you run.** Every code sample asks what it will print (or whether it will compile, crash or misbehave) before it lets you press Run.
- **At most about 250 words, or one animation, between interactions.** Lessons are cards, and each card ends in something you do.
- **Four kinds of exercise:** write it from scratch, fix a bug from a symptom, arrange the lines (Parsons problems), or run a task on your own machine.
- **Three graduated hints** per exercise (a nudge, the concept, partial code), and the reference solution only unlocks after real effort.
- **Variants** let you prove you have mastered an exercise rather than memorised it.
- **Checkpoints** run in assessment mode: no hints, no solutions, one transfer question.
- **Spaced retrieval quizzes** bring earlier modules back.
- **Perfect lessons** track lessons where every prediction is exact, with a short Rio power-up celebration. Predict again to improve an answer; the count follows your current predictions.

### Interactive visualizers
Step through a program line by line with real debugger traces, explore the compiler pipeline stage by stage, draw memory diagrams, hit **compiler-error drills**, practise number-base conversion, and play with a number playground. Later modules add visualizers for lists, trees, hash tables, a tiny CPU and a cache simulator.

### Every answer is generated, never typed
- Every expected output and prediction answer comes from **actually running the code** with `tools/verify` on **gcc 13**, **clang 22** and the **browser compiler**, with stored results from **macOS arm64** and **Linux arm64** (plus **Windows MSVC** for the platform-specific samples).
- Samples must compile cleanly and run **ASan + UBSan clean** unless the lesson deliberately shows an error.
- Output that differs between 32-bit WebAssembly and your 64-bit machine is **flagged automatically** and shown side by side.
- Undefined behaviour is only ever asked about categorically (crash? same every run? what does the sanitizer say?), and garbage values are never shown.
- **gdb stepper traces** come from real debugger runs. Exercise tests are produced by running the reference solution.
- **Every lesson is clicked through by Playwright** in CI, and every reference solution passes while every starter fails.

### Projects that run on your machine
From Module 3 on, you build real projects with your own toolchain and `make`. A zero-dependency runner, `check.mjs`, tests your work locally and prints a **progress code and completion token** you paste back into the app.

### Animations and video
Short, deterministic explainer animations rendered with **HyperFrames**, each followed by an interaction, plus a hand-picked few CS50 lecture segments only where they clearly beat the app. The clips are embedded from YouTube (nothing loads until you press play), and each comes with a transcript of the segment from its CC BY-NC-SA 4.0 captions, credited under the clip. Every animation has captions and a still-frame fallback.

### An AI tutor, on your terms
- **Bring your own key.** Nothing is sent until you accept a notice that names the exact host and what goes with the request. Exercises and lessons each ask for their own consent.
- **On exercises** it only appears after a failed attempt on a browser exercise, sees the real failing output and only the hints you have already opened, and is told never to give the solution away. A guard checks every reply against the reference solution and replaces code that would leak it with a pointer to the next hint.
- **In lessons** a chat panel answers questions about the parts you have reached (with your edits to the samples and the video transcripts). Highlight a passage and choose Explain or Reply to start from it. The tutor's text appears as it streams in.
- Works with OpenRouter (with a sensible default model list) or any compatible host, including `localhost`.

### Streaks, spirit beans and Rio
Submit something each day to build a streak. Spirit beans save a missed day, and **Rio**, an original pixel-art warrior, powers up as your streak grows: Warrior at 3 days, Golden Warrior at 7, Golden Mane at 14, Crimson Fur at 30 and Great Ape at 50. Skip too long and Rio is defeated.

### Your progress is yours
- Everything lives in `localStorage`; there are no course accounts and no tracking.
- **Export and import** your progress as a file, with safe merge and validation of untrusted input.
- **Optional Google Drive sync** (Settings): connect once and your progress saves to a hidden app folder in your own Drive and merges into every browser you sign in on. Nothing loads from Google until you click to connect.
- Playground drafts and tutor settings sit outside the progress document, so a reset never wipes them.

### Designed to be used by everyone
- **WCAG AA contrast** in light *and* dark, checked by tests on the design tokens.
- **axe-core runs on every page** in both themes in CI, with no serious or critical violations allowed.
- Full keyboard support, `prefers-reduced-motion` respected, inline SVG icons instead of Unicode glyphs, and a layout that works at phone width.
- A restrained "achromatic ledger" look: ink on grey, one blue for data, Geist type self-hosted so no request leaves the site.

## Run it locally

You need Node 22.22.2 or newer.

```sh
npm ci
npm run dev        # prepares the in-browser toolchain, then starts Vite
```

For **cloud agents and contributors running native verification** (Linux/WSL),
start with `npm run setup`. It reuses an existing toolchain or prepares the CI
tools using Docker or Ubuntu installation privileges, installs npm dependencies,
and checks real compilation and debugging. Later tasks use `npm run doctor`,
then `npm run env -- npm test` or `npm run env -- npm run verify`. A cloud agent
environment runs `bash tools/environment/cloud-setup.sh` as its setup script.
CI and cloud setup use the same native installer. See
[`tools/environment/README.md`](tools/environment/README.md) for prerequisites,
browser setup and troubleshooting.

If a cloud task denies access to Docker's socket, retry the doctor with the
platform's approved expanded execution permissions. That error does not mean
the prepared image is missing; rebuilding cannot repair a sandbox denial.

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and produce the static site in `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run verify` | Compile and run every sample with this machine's gcc, clang and the browser compiler (CI owns the committed results; don't commit them) |
| `npm run verify:exercises` | Check that solutions pass and starters fail |
| `npm run lint:content` | Enforce word budgets, cadence and fence rules |
| `npm run e2e` | Playwright click-through of every lesson, plus axe (run `build` first) |
| `npm run dod -- --module m01` | The whole per-module definition of done in one table |

The full command list is in [`AGENTS.md`](AGENTS.md).

## How it is built

| Path | What lives there |
|---|---|
| `content/` | The course itself: MDX lessons, YAML modules, exercises, quizzes and projects |
| `src/` | The React + TypeScript app, in-browser compiler runtime, progress store and visualizers |
| `tools/` | The verifier, tracer, exercise generator, content linter, animation and video checkers |
| `animations/` | HyperFrames projects (rendered MP4s are committed under `public/animations/`) |
| `e2e/` | Playwright specs |
| `research/` | Stage-1 research, for reference only |

CI checks every pull request that touches code: it regenerates and checks all sample output and runs the unit and end-to-end suites with axe. Pushes to `main` deploy the site to **GitHub Pages**.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first (the workflow, commands, pull-request rules, and the notes to read for each folder), then [`PLAN.md`](PLAN.md) (architecture and the course outline). Decisions and their evidence are in [`docs/adr/`](docs/adr/README.md). One ticket is one pull request, and every claim of "it passes" needs pasted evidence.

## Licence

MIT, for the code and the course content: see [`LICENSE`](LICENSE). Third-party notices (LLVM, wasi-libc, browser_wasi_shim, fonts, the CS50 clips and caption excerpts, which are CC BY-NC-SA 4.0, and others) are listed on the site's About page.
