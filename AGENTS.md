# AGENTS.md: The Definitive C Course

An interactive, static (no backend) React + TypeScript web app that teaches C17 and low-level fundamentals to front-end engineers. **Read `PLAN.md` first.** It is the source of truth for architecture, the content format (§2.4), the verification pipeline (§3), the course outline (§6) and the per-module definition of done (§3.6). This file is the working summary for any coding agent (Claude Code, Codex, Cursor, Copilot, …). `CLAUDE.md` only imports this file.

## Start here: when you are handed a ticket
You were told to read this file and given a ticket. Do this, in order:
1. Read this whole file, then the PLAN.md sections your ticket cites. The non-negotiables and "Pitfalls we already hit" apply to every change.
2. Branch from the latest `main` (`ticket/<short-name>`). **One ticket = one pull request.** Never push to `main` and never force-push.
3. Stay in scope. Don't start Module 2, change the licence, edit PLAN.md decisions, or add a dependency without saying why (pin exact versions).
4. Don't hand-edit `src/generated/` (regenerate it with `npm run verify`) and don't hand-type expected outputs.
5. Before opening the PR, run the commands that cover your change (see **Commands**). If you touched the app, run `npm ci && npm run build && npm run e2e`. Outside the cloud container, install a browser first with `npx playwright install chromium` (`playwright.config.ts` falls back to Playwright's own Chromium; set `CHROMIUM_PATH` to use another).
6. Write the PR description with the template in **Pull request rules** below. Say plainly what you could not verify; never claim a pass you didn't see.
7. If the ticket is wrong, ambiguous or blocked, stop and say so (in the PR, or to the person who gave it to you) instead of working around it.
8. No repository access, or can't run commands (for example a plain chat window)? Say so, return your change as a unified diff plus the exact commands a human should run to check it, and label everything unverified.
9. **Keep this file current.** When you hit a gotcha or learn a practice that would have saved you time, add one concise bullet under **Pitfalls we already hit** (or the relevant section) in the same PR, and delete a bullet once the bug it describes is fixed. Only write down what you observed or verified.

## Raising issues (for the owner and the lead session)
- Raise a GitHub issue only for **big** work: about M or L (half a day of human work or more, or several files), parallelizable and independently testable. Fix small things (S) directly instead of filing them: an issue costs a PR plus a review, which is more than a small fix.
- Every issue states the goal, the **files the PR may touch** (and must not), and acceptance criteria that are each checkable with a command or a test, never "make sure X works". Add `Depends on #N` when another open issue edits the same files, and don't run two tickets that edit the same file in parallel.
- Label it `complexity: M|L` plus an `area:` label. Don't write a criterion the code can only satisfy vacuously (for example "test that a constant equals itself").

## Pull request rules (what makes review cheap)
1. **Small and single-purpose.** One ticket, no unrelated edits (formatting, renames, drive-by fixes). If the diff is over about 400 changed lines (not counting fixtures and generated files), say why or split it.
2. **The simplest thing that meets the acceptance criteria.** No speculative features or extra abstractions. If you add a mechanism of more than about 50 lines, say why a simpler one would not do.
3. **Rebase first.** Rebase on the latest `main` before opening or updating the PR. If another open PR edits the same files, name it in the description and rebase after it merges.
4. **Tests that can fail.** Every behaviour change has a test that fails without it (say how you checked, for example by reverting the fix). Tests call the real code: never recompute the expected value inside the test, never assert a constant against itself, and type your mocks (`satisfies` or the real type).
5. **Evidence, not narration.** Paste the tail of each command's real output. Use the CI toolchain (Ubuntu 24.04, gcc 13, clang 22, gdb 15, valgrind 3.22, Node 22). If yours differs, say exactly how, and don't call a failure "pre-existing" unless you also ran it on a clean `main`. Once CI is green on `main`, CI is the evidence: link the green run.
6. **Generated files.** Don't commit regenerated `src/generated/{samples,traces}` files: CI owns them and a bot commit updates your branch when behaviour changes (see **Pitfalls**). Never commit files that differ only because your toolchain's version strings or UB garbage differ from CI's.
7. **Post the report on the right PR**, once, in the description or in a single comment that names the PR number and head SHA. Never post a report on another PR.
8. **Answer review with commits.** Push a new commit (no force-push) and reply to each point: fixed (commit), not fixed (why), or disagree (why). Don't mark a point resolved without one.
9. **UI changes** also report the axe result in light and dark (`npm run e2e`) and how the change behaves with the keyboard.

PR description template (under about 300 words):
```
Closes #N
Summary: (at most 5 lines)
Files touched and why:
Acceptance criteria: (copied from the issue; each with ✓ or ✗ and the evidence)
Commands run: (pasted output tails; for a module change, paste the `npm run dod -- --module mNN` table)
Could not verify:
Risk: (does it touch learner-facing app code, the generated-data format, or CI/deploy? yes or no, and what)
```

Review depth, so you know where evidence matters most: the maintainer reviews thoroughly when a PR touches learner-facing app code, the verifier's data format, or CI/deploy. For tests-only changes, content text and refactors whose output can be diffed, it runs the checks and reads the diff.

## Status
- Stage 1 (research + PLAN.md) is approved; the client's decisions are in PLAN.md §12 (public repo → GitHub Pages; MP4s committed; allocator-only capstone; dark-only animation renders).
- Stage 2 (app shell + Module 1) is **built and awaiting client review**. Open items are listed in the review hand-off; do not start Module 2 before the client signs off.
- The client reviews after each stage and after each module, so stop and ask for review at those points.

## Non-negotiables (client spec)
- **The learner is never passive.** At most ~250 words or one animation/video before an interaction.
- **Every `id` code fence is predict-before-run.** Run without a prediction is allowed only inside CT/FB editors and inside `<Stepper>`, `<CompilerError>`, `<PipelineExplorer>`, `<MemoryDiagram>`. Every C fence in prose has `id=` or `fragment`.
- **Every expected output and prediction answer is generated by running code** (`tools/verify`, `tools/exercises`), never typed by hand. This includes `tests.json` expectations: produce them by running the reference solution.
- **UB appears in a prediction only when UB is the lesson.** The question is then categorical (crash? same value every run? what does UBSan/ASan/the compiler report?). The answer is the set of outcomes observed across targets and 3 runs. Garbage values are never asked or shown.
- **Samples compile cleanly with `-std=c17 -Wall -Wextra -pedantic`** in gcc 13, clang 22 *and* the browser compiler, and run ASan+UBSan-clean natively, unless the lesson deliberately shows an error.
- **Output differences between the browser (wasm32) and any native target are flagged automatically.** A flagged sample needs `platform` plus `predict64=…` or `predict64=none reason=…`. It shows the browser result and the learner's platform result.
- **Reference solutions pass; starters fail** (variants too). Every lesson is clicked through with Playwright.
- **Progress lives in `localStorage`** under `tdcc:v1:*` keys, with export and import as a file.
- **Content lives in `content/`** (MDX/YAML), separate from `src/`.
- **Outside resources:** at most 1–2 per module, each naming an exact chapter or lecture.
- **YouTube:** at most 2 segments per module, only when they clearly beat the app. Each goes in `videos.json` with `why`.
- **Accessibility:** axe must report no serious or critical violation on any page in light *and* dark. Contrast is WCAG AA (4.5:1). Never dim with `opacity`, and never use Unicode glyphs as icons (fonts lack them; use inline SVG).

## Commands (keep in sync with `package.json`)
| Command | What it does |
|---|---|
| `npm run dev` | prepare the toolchain, copy `check.mjs` to `public/downloads/`, start Vite |
| `npm run build` | prepare toolchain → `tsc --noEmit` → `vite build` → copy `check.mjs` into `dist/downloads/` |
| `npm run verify [-- --module m01 --check --force]` | compile/run every sample on gcc, clang, the browser compiler (+ stored macOS/arm/Windows results); writes `src/generated/samples/` and traces |
| `npm run trace` | gdb stepper traces for `trace` samples → `src/generated/traces/` |
| `npm run verify:exercises` | every solution passes, every starter fails, every variant passes (browser and native) |
| `npm run exercises:expect [-- --check]` | regenerate `tests.json`/`check.json` from each folder's `cases.yaml` by running the reference solution (gcc `-Werror` + ASan/UBSan); `--check` only reports drift |
| `npm run lint:content [-- --strict --stats]` | word budget, cadence, fence ids, analogies, quiz and module rules |
| `npm run anim:check` / `anim:render` | HyperFrames lint, check and deterministic render (needs Chromium + ffmpeg; see `animations/README.md`); CI runs only `node tools/anim/check.mjs --static`, the full check is local |
| `npm run videos:check [-- --online]` | `videos.json` schema and transcript anchors (CI never calls yt-dlp) |
| `npm test` / `npm run typecheck` | Vitest / `tsc --noEmit` |
| `npm run dod -- --module m01 [--fast] [--json]` (use `npm run -s dod` for clean `--json`) | the per-module definition of done (PLAN §3.6) in one table: toolchain:prepare, typecheck, strict lint, `verify --check`, `trace --check`, exercises, videos, static animation check, all unit tests (`npm test`), build, e2e (`E2E_MODULE` limits e2e to the module); `--fast` skips build and e2e. See `tools/dod/README.md` |
| `npm run e2e` | Playwright click-through of every lesson, problem set, project and checkpoint, plus axe (run `npm run build` first) |

CI (`.github/workflows/ci.yml`) logs the runner image and every tool version, regenerates `src/generated/{samples,traces}` on same-repo PRs (see **Pitfalls**), runs all of these, then deploys `dist` to GitHub Pages. The `Targets` workflow runs samples on macOS arm64, Linux arm64 and Windows MSVC and a bot commits `src/generated/targets/`, so **`git pull --rebase` before you push**.

## Repo map
| Path | Contents |
|---|---|
| `content/course.yaml`, `content/modules/<mNN-slug>/` | Course content (below) |
| `src/` | App: `app/` pages, `interactions/`, `visualizers/`, `lesson/` card engine, `progress/` store and gating, `runtime/` browser compiler, `testing/` shared test runner and tokens, `generated/` machine output |
| `tools/` | `verify`, `trace`, `exercises`, `check` (check.mjs), `content-lint`, `anim`, `videos`, `toolchain`, `mdx` (remark plugin), `shared` |
| `animations/` | HyperFrames projects; `public/animations/<id>/` holds the committed MP4, VTT, `steps.json`, stills |
| `e2e/` | Playwright specs and helpers (`lib.ts` completes every interaction from generated data) |
| `.github/workflows/` | `ci.yml`, `targets.yml` |
| `research/` | Stage-1 reports and prototypes. Reference only; never built or shipped |

## Content format
```
content/modules/m01-c-in-your-browser/
  module.yaml                  id number title why hours weeks time{…} lessons problemSet project coreExercises resources retrieval
  lessons/NN-name.mdx          frontmatter: id (m01-l1), title, minutes (25–60), summary
  exercises/<id>/              exercise.yaml  starter.c  solution.c  cases.yaml  tests.json   (+ variants/<n>/ as standalone folders)
  project/<id>/                project.mdx  exercise.yaml  cases.yaml  check.json  Makefile  README.md  starter/  solution/
  quizzes/retrieval.yaml, quizzes/checkpoint.yaml
```
- **Lessons** are MDX. `tools/mdx/remark-course.ts` turns ```` ```c ```` fences into `<CodeSample>` (needs `id=`) or `<CodeBlock>` (`fragment`) and groups content into gated `<Card>`s, each ending in one interaction. Components available without imports: `Choice`, `CompilerError`, `MemoryDiagram`, `Stepper`, `NumberDrill`, `NumberPlayground`, `PipelineExplorer`, `Exercise`, `Analogy` (`js`, `c`, `breaksDown`), `Callout`, `Animation`, `YouTube`, `TestExample`.
- **Fence meta keys:** `id`, `fragment` (or `fragment=partial`), `predict` (`output|outcome|choice|none`), `choices="a|b|c"`, `stdin`, `args`, `expect` (`success|warning|compile-error|runtime-error|ub|exit:N`), `expect.<gcc|clang|wasm|apple|msvc>`, `warn=-Wflag` and `warn.<compiler>=`, `platform`, `predict64`, `reason`, `target=native`, `stdout=tty|pipe|both`, `posix`, `guardrail`, `sanitize=off`, `trace`, `timeout`, `norm`, `files`, `run`.
- **Exercises:** `kind` is `ct` (write), `fb` (fix a bug from a symptom), `pa` (Parsons) or `lt` (runs on the learner's machine). Exactly three hints (nudge → concept → partial code). A variant inherits nothing from its parent. `tests.json` is `{version, sources, warnings, tests[{name, run{stdin,args}, expect{stdout,exit}, hint}]}`. For single-file stdin/args/stdout/exit exercises it is **generated**: write `cases.yaml` (`cases: [{name, stdin?, args?, hint?}]`) and run `npm run exercises:expect` (see `tools/exercises/README.md`); never type an expectation. Hand-written unit/make tests remain hand-written.
- **Quiz items:** `predict`, `outcome`, `choice`, `ce`, `md`, `sp`, `exercise`, `np`, `order`. A `choice` with `code` has no `answer` (the verified output must equal one choice). A `ce` needs `answer`. An `md` needs `sample`, `line`, `items` and `meta: trace predict=none`. Checkpoints run in assessment mode: no hints, no solutions, explicit skip counts as wrong, one `transfer: true` item.
- **Generated files:** `src/generated/{samples,traces}` are **owned by CI**. Don't commit regenerated copies and never edit them by hand. For a same-repo PR, CI regenerates them on the `ubuntu-24.04` runner and a bot commit lands on your branch (so `git pull --rebase` before you push again). If you resolve a conflict in these files, take either side; CI regenerates them. `src/generated/targets/` is written by the `Targets` workflow on `main`. Run `npm run verify` locally to look at output, not to commit it: it keeps a committed file whose only difference is a compiler version string, but your machine's toolchain can still differ from CI's in behaviour.
- **Progress schema** (`src/progress/store.ts`): one JSON document at `tdcc:v1:progress` (`version, seed, cards, lessons, samples, exercises, quizzes, projects, settings`). Gating rules live in `src/progress/gating.ts`.

## Conventions
- **C standard and POSIX.** C17 + the standard library. POSIX only in M11 (`dlopen`), M13 and the capstone's provided `memlib`. POSIX samples start with `#define _POSIX_C_SOURCE 200809L` (add `_DEFAULT_SOURCE` for glibc `d_type`, `_DARWIN_C_SOURCE` for macOS `MAP_ANON`) and mark the fence `posix`.
- **`learnc.h`** (`src/runtime/c/`) is the course helper (MIT, our own). Don't ship libcs50 (licensing is ambiguous). No libc `rand()` in prediction answers; use the `learnc.h` PRNG.
- **Normalisation.** Only `%p` output is normalised to `<addrN>`. On those lines `0`, `0x0` and `(nil)` mean NULL.
- **Traces** come from x86-64 Linux gdb and are labelled as such. Variables whose declaration has not run are recorded as `declared: false` with a placeholder value, never the stack bytes.
- **Line endings are LF everywhere** (`.gitattributes`). Windows CRLF changes sample hashes and marks stored results stale.
- **Routing.** HashRouter with Vite `base: './'`. The toolchain URL is resolved on the main thread and passed to the workers.
- **Licensing.** The repo's own licence and copyright holder are the client's decision (open item); `learnc.h` is MIT.

## Key technical decisions (details in PLAN.md §1–§4)
- **In-browser compiler:** `@yowasp/clang@22.0.0-git20542-10` (pinned). Programs run with `@bjorn3/browser_wasi_shim@0.4.2` in a per-run worker, under `WebAssembly.promising` when JSPI exists (Chromium), otherwise with preset stdin.
- **Browser flags:**
  ```
  -std=c17 -Wall -Wextra -pedantic -O0 -g -fno-color-diagnostics -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_SIGNAL
  -lc-printscan-long-double -lwasi-emulated-process-clocks -lwasi-emulated-signal
  -Wl,-z,stack-size=1048576 -Wl,--max-memory=268435456
  ```
  - Always link `course_rt.c`, which flushes stdout before stdin reads.
  - Guardrail mode adds `-fsanitize=undefined -fno-sanitize-recover=all` plus `ubsan_rt.c`, which must implement *all* handlers.
  - Leak checks link `leakcheck.c` with `-Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc,--wrap=free`, which is what makes them correct for every translation unit. `-include leakcheck.h` only adds `file:line` tags through function-like macros, so `free` passed as a function pointer still reaches the wrapped function; blocks with no learner location are ignored.
- **Gotchas found in research:** prefetch with `runClang(null, {}, {fetchProgress})`; pass `{debug:false}` to `new WASI(...)`; pass `decodeASCII:false`; patch `fetch` before importing the yowasp bundle; never `await cache.put()` in the fetch hook; override `poll_oneoff` (`sleep` busy-waits).
- **Native CI toolchain:** Ubuntu 24.04 with gcc 13, clang 22 (apt.llvm.org) + `libclang-rt-22-dev`, gdb 15, valgrind 3.22, Node ≥22, FFmpeg. Stored targets: macOS arm64 and ubuntu-24.04-arm (all samples), windows-latest (`platform` samples).
- **Reference environment:** CI on the GitHub Actions `ubuntu-24.04` runner is the authority for every check. Local and sandbox runs are advisory: say how your toolchain differs and let CI decide. There is no Docker (the agent sandboxes have no Docker daemon). The `check` job logs the runner image (`ImageOS`, `ImageVersion`) and the versions of gcc-13, clang-22, gdb, valgrind, node and ffmpeg; the `deploy` job installs nothing and logs nothing. We select the gcc major version by package name (`gcc-13`) and accept patch drift in clang 22 (apt.llvm.org) and the other apt tools. `verify --check` ignores version strings (`generatedBy`, each target's `compiler`) and compares behaviour only, so drift cannot turn it red.
- **Local project runner:** `check.mjs` (zero dependencies, Node 18+) via `make test`. It reads `.learner` (the seed) and prints progress codes and completion tokens via `src/testing/token.ts`. Project ids with a slash are written with a dot in codes.
- **Unit-test harness:** `#define main learner_main` plus `#include` of the file defining `main`, with `-Wreturn-type` and `-Wmissing-prototypes` silenced. Never trust its return value. Multi-file projects are tested through `make` targets in `check.json`.

## Pitfalls we already hit (don't repeat)
- `update()` in the progress store is a no-op when nothing changed. Keep effects idempotent: an effect that always writes state loops forever (React error 185).
- `?frontmatter` imports use a virtual module id (`vite.config.ts`) so the MDX plugin cannot replace the data with the compiled lesson.
- The PTY runner (`tools/verify/pty_run.py`) must hold the slave open until output is drained; macOS drops unread output otherwise.
- Test harness: `AxeBuilder` needs pages from `browser.newContext()`; scope `summary` locators with `:scope >` because exercises contain nested `<details>`.
- Never commit machine-dependent output (stack garbage, ASLR addresses). `verify --check` and `trace --check` must be stable across runs.
- **Judge a failure on a clean `main` under the same load before blaming a PR.** The e2e suite and the verifier fixture tests are timing-sensitive on a busy 4-CPU machine; we saw one-off failures at load 5 to 7 that passed on rerun. Run gates one at a time and don't run e2e while other heavy jobs run.
- **Wait for a signal that identifies the page.** A bare `h1` also matches the page you are leaving; use the specific heading text or a `data-*` attribute.
- **Tests that make their own context** (`browser.newContext()`, needed for axe) get no automatic Playwright trace or failure screenshot; start `context.tracing` yourself when debugging.
- **Compiler diagnostics depend on the locale.** gcc and clang print Unicode quotes in UTF-8 locales, while the generated files and tests assume ASCII. Run `verify`, `trace` and the tests with `LC_ALL=C`.
- **Parallel PRs that edit the same file conflict** (for example `tools/mdx/remark-course.ts`). Detect it before merging with `git merge-tree --write-tree <main> <pr-head>` (prints `CONFLICT` lines; GitHub's `mergeable` can stay `null` for minutes), merge one, then merge `main` into the other (no force-push) and fix the conflict.
- **GitHub closes issues on negated keywords.** "Do not close #1" in a PR description closed #1 when the PR merged. For partial work write "Partial progress on #N" and never use close, closes, fix, fixes, resolve or resolves next to an issue number; the maintainer also re-checks the issue state after every merge.
- **Stacked PRs.** PRs are squash-merged, so a PR whose base is another PR's branch no longer matches `main` once that PR merges. Retarget it (`PATCH /pulls/N` with `base=main`), merge `main` in and resolve conflicts before asking for review.
- `import.meta.glob` hands a plugin's `resolveId` importer-relative paths; resolve them against `importer` (see the `?frontmatter` plugin).
- **Compiler output quoted in prose comes from the generated data, not memory.** Lesson 6 once showed `did you mean 'count'?` for the typo `cuont`; clang 22 offers no suggestion there (it does for `cont`), so the lesson contradicted the diagnostics panel. Copy messages from `src/generated/samples` (`raw`), and re-read the sentences around them whenever a sample changes.
- **CI-owned generated files.** On a same-repo PR, the `check` job runs `npm run verify` with a read-only token. If `src/generated/{samples,traces}` changes in behaviour, it uploads the files, fails on purpose, and the separate `commit-generated` job (the only one with `contents: write` and `actions: write`; it runs none of the PR's build or test code, only `tools/ci/unpack-generated.mjs`, which accepts nothing but regular files strictly under `src/generated/{samples,traces}/`) commits them as `github-actions[bot]` to the PR branch and dispatches CI for the new head (a push made with `GITHUB_TOKEN` triggers no workflow, `workflow_dispatch` is exempt). The checks on the final head SHA come from the dispatched run. If the branch moved meanwhile, the bot skips the push and your own push gets its own run. Fork PRs cannot be pushed to and just fail `verify --check`. Timed-out runs are never cached (`cacheRuns` in `tools/verify/cache.ts`).

## Environment recipes (verified in the cloud container)
- **YouTube.** Check a video: `curl "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json"`. Transcript: `yt-dlp --js-runtimes node --extractor-args "youtube:player_client=web_embedded" --ignore-no-formats-error --skip-download --write-subs --write-auto-subs --sub-langs "en" --sub-format vtt -o "%(id)s" "https://www.youtube.com/watch?v=<ID>"`. Default clients hit a bot check and bursts get 429s, so fetch slowly. Commit transcript excerpts; CI must not call yt-dlp. Node's `fetch` needs `NODE_USE_ENV_PROXY=1` behind the proxy.
- **HyperFrames.** Needs Node ≥22 and FFmpeg. `tools/anim` sets `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_BROWSER_PATH=…` itself and pins `hyperframes@0.8.162` via npx. Read `animations/README.md` and PLAN.md §4.6 before authoring. Commit only the MP4; WebM is transcoded at deploy.
- **Chromium** is at `/opt/pw-browsers`. Don't run `playwright install` there. Open-source Chromium can't play H.264, so e2e tests use a WebM fixture.
- **GitHub.** Web and API access is limited to repos attached to the session. `gh repo create` and GraphQL are blocked; use repo-scoped REST.
- **GitHub API details.** Use REST (`gh api repos/<owner>/<repo>/...`). In list endpoints (`pulls?state=open`) `additions`, `deletions`, `changed_files` and `mergeable` come back `null`: read a single PR (`pulls/N`), and retry `mergeable` after a few seconds (it stays `null` while GitHub computes it).
- **Review a PR locally without touching your working tree:** `git fetch origin pull/N/head && git update-ref refs/review/prN FETCH_HEAD`, then `git worktree add --detach <dir> refs/review/prN`, `ln -sfn <repo>/node_modules <dir>/node_modules`, `mkdir -p <dir>/public && ln -sfn <repo>/public/toolchain <dir>/public/toolchain`, `cp <repo>/src/generated/toolchain-version.json <dir>/src/generated/`. Run the gates there with a distinct port (`E2E_PORT=4181`) and `E2E_RUN_TIMEOUT=120000`, and remove the worktree afterwards (`git worktree remove --force <dir>`). Use `ln -sfn`, not `ln -s`: onto an existing link, plain `ln -s` creates a link *inside* the target, which once put `public/toolchain/toolchain` (pointing at itself) into the shared directory and broke every build with `ELOOP`. If you see that, delete just that link (`rm public/toolchain/toolchain`, no trailing slash).

## Git
- The lead session works on `main`; everyone else uses a branch and a pull request (see **Start here**). Commit messages are descriptive; add the attribution lines your harness supplies.
- Pull with rebase before you push (the Targets bot commits to `main`). Never force-push.
