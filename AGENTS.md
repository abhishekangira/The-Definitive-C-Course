# AGENTS.md: The Definitive C Course

An interactive, static (no backend) React + TypeScript web app that teaches C17 and low-level fundamentals to front-end engineers. **Read `PLAN.md` first.** It is the source of truth for architecture, the content format (§2.4), the verification pipeline (§3), the course outline (§6) and the per-module definition of done (§3.6). This file is the working summary for any coding agent (Claude Code, Codex, Cursor, Copilot, …). It holds what applies to every change; each area keeps its own notes, listed under **Where to find what**. There is deliberately no `CLAUDE.md` (see **Where new knowledge goes**).

## Start here: when you are handed a ticket
You were told to read this file and given a ticket. Do this, in order:
1. Read this whole file, then the notes that **Where to find what** lists for every folder you will edit, then the PLAN.md sections your ticket cites. The non-negotiables, **Ask first** and the pitfalls apply to every change. (Claude Code attaches a folder's `AGENTS.md` only when its Read tool opens a file there, never after `cat` in Bash, a search or a new file, and never a `README.md`; other tools differ. Open the listed notes yourself.)
2. Branch from the latest `main` (`ticket/<short-name>`). **One ticket = one pull request.** Never push to `main` and never force-push.
3. **Install the CI toolchain before you run anything.** Run the commands of the `Install the native toolchain` step in `.github/workflows/ci.yml` (with `sudo` unless you are root), then check `gcc-13`, `clang-22`, `lldb-22`, `gdb`, `valgrind` and `node` with `--version` against **Pull request rules** 5. `tools/verify` falls back to plain `clang` with a warning, and those outputs are not comparable. A version mismatch is your setup to fix, not a finding to report. Only if the install fails (no network or no `sudo`), name your versions under **Could not verify**.
4. Stay in scope, and stop at anything under **Ask first**. A new dependency needs a reason in the PR description and an exact pinned version.
5. Don't hand-edit `src/generated/` (regenerate it with `npm run verify`) and don't hand-type expected outputs.
6. Before opening the PR, run the commands that cover your change (see **Commands**). If you touched the app, run `npm ci && npm run build && npm run e2e`. Outside the cloud container, install a browser first with `npx playwright install chromium`. Browser setup: `e2e/AGENTS.md`.
7. Write the PR description with the template in **Pull request rules** below. Say plainly what you could not verify; never claim a pass you didn't see.
8. If the ticket is wrong, ambiguous or blocked, stop and say so (in the PR, or to the person who gave it to you) instead of working around it.
9. No repository access, or can't run commands (for example a plain chat window)? Say so, return your change as a unified diff plus the exact commands a human should run to check it, and label everything unverified.
10. **Keeping these notes up to date is the PR author's duty.** Before you open the PR, make sure this file and the `AGENTS.md` (or README) of every folder you touched are still true after your change. Correct any path, command, rule or number your change made wrong, delete a bullet whose bug you fixed, and write down a gotcha or practice that would have saved you time, in the place **Where new knowledge goes** names. Only write down what you observed or verified, and check each sentence you add against the code that makes it true. **Check the root `README.md` on every PR, whatever folders you touched:** it is the first page a person reads (what the app is, how to run it, where to read next, the licence), so a change to any of those updates it in the same PR.

## Ask first
Stop and ask the owner (in the PR, or the person who gave you the ticket) before you:
- change the licence,
- change a decision in PLAN.md, in **Decisions** below or in `docs/adr/` (propose a new decision record instead),
- add support or tests for a browser other than Chromium (see **Decisions**).

## Filing an issue
Before you write, split or label a GitHub issue, read `.agents/skills/write-issue/SKILL.md`.

## Pull request rules (what makes review cheap)
1. **Small and single-purpose.** One ticket, no unrelated edits (formatting, renames, drive-by fixes). If the diff is over about 400 changed lines (not counting fixtures and generated files), say why or split it. When a ticket will need splitting, choose the split and post it on the issue before you write code, not after.
2. **The simplest thing that meets the acceptance criteria.** No speculative features or extra abstractions. If you add a mechanism of more than about 50 lines, say why a simpler one would not do.
3. **Rebase first.** Rebase on the latest `main` before opening or updating the PR. If another open PR edits the same files, name it in the description and rebase after it merges.
4. **Tests that can fail.** Every behaviour change has a test that fails without it (say how you checked, for example by reverting the fix). Tests call the real code: never recompute the expected value inside the test, never assert a constant against itself, and type your mocks (`satisfies` or the real type). Code that decides pass or fail (grading, gating, an exit code, a CI step) needs a case where it fails: a test with a wrong input, and for CI a linked run that went red. A fix that makes failures impossible to see is a regression.
5. **Evidence, not narration.** Paste the tail of each command's real output. Use the CI toolchain (Ubuntu 24.04, gcc 13, clang 22, lldb 22, gdb 15, valgrind 3.22, Node 22). If yours differs, say exactly how, and don't call a failure "pre-existing" unless you also ran it on a clean `main`. Once CI is green on `main`, CI is the evidence: link the green run.
6. **Generated files.** Don't commit regenerated `src/generated/{samples,traces}` files: CI owns them and a bot commit updates your branch when behaviour changes (see **Decisions**). Never commit files that differ only because your toolchain's version strings or UB garbage differ from CI's.
7. **Post the report on the right PR**, once, in the description or in a single comment that names the PR number and head SHA. Never post a report on another PR.
8. **Answer review with commits.** Push a new commit (no force-push) and reply to each point: fixed (commit), not fixed (why), or disagree (why). Don't mark a point resolved without one.
9. **UI changes** also report the axe result in light and dark (`npm run e2e`) and how the change behaves with the keyboard.
10. **Subscribe to the PR you open.** Right after creating it, watch it for CI results and review comments, and drive it to green and mergeable without waiting to be asked.
11. **UI changes need screenshots** at desktop (about 1400px) and phone (390px) widths, in the PR description, hosted by GitHub (drag them in) and never committed as files. Add light and dark only when the PR is about colours or themes. If you cannot upload images, say so and give the Playwright command that takes them.

PR description template (under about 300 words; run history and long evidence go in one comment on the PR, not here):
```
Closes #N
Summary: (at most 5 lines)
Files touched and why:
Notes: (the AGENTS.md or README files you updated, or why none needed it; always say you checked the root README.md)
Acceptance criteria: (copied from the issue; each with ✓ or ✗ and the evidence)
Commands run: (pasted output tails; for a module change, paste the `npm run dod -- --module mNN` table)
Could not verify:
Risk: (does it touch learner-facing app code, the generated-data format, or CI/deploy? yes or no, and what; a yes gets a thorough review)
```

**Reviews** (by the maintainer, a review agent or any agent asked to review) follow the `review-and-merge-pr` skill (`.agents/skills/review-and-merge-pr/SKILL.md`). Its notes check is a merge rule: a note or the root `README.md` that the change made untrue blocks the merge, like a missing test.

## Status
- **Live site:** https://abhishekangira.github.io/The-Definitive-C-Course/ (GitHub Pages; the `deploy` job in `ci.yml` publishes `main`).
- Modules 1 and 2 are open to learners. **Module 3 is not started** (`available: false` in `content/course.yaml`, no folder); its brief is issue #73. **There is no review gate between modules** (PLAN.md §12 item 11): the owner audits the course while it is built and files issues for any gap, so start the next module when its ticket is assigned. Other open work, such as the AI tutor (#47), is in issues and PRs.

## Non-negotiables (client spec)
- **The learner is never passive.** At most ~250 words or one animation/video before an interaction.
- **Every `id` code fence is predict-before-run.** Run without a prediction is allowed only inside CT/FB editors and inside `<Stepper>`, `<CompilerError>`, `<PipelineExplorer>`, `<MemoryDiagram>`. Every C fence in prose has `id=` or `fragment`.
- **Every expected output and prediction answer is generated by running code** (`tools/verify`, `tools/exercises`), never typed by hand. This includes `tests.json` expectations (produce them by running the reference solution) and test fixtures of tool output: generate them with the tool, and add a test that regenerates the fixture and fails when it differs.
- **Never invent or relabel tool output.** Show normalised placeholders (`<addrN>`, `<pid>`, `<dir>`) as placeholders, never as realistic values. When a platform's result is missing or stale, say so on screen; never hide it silently or label one platform's output as another's.
- **UB appears in a prediction only when UB is the lesson.** The question is then categorical (crash? same value every run? what does UBSan/ASan/the compiler report?). The answer is the set of outcomes observed across targets and 3 runs. Garbage values are never asked or shown.
- **Samples compile cleanly with `-std=c17 -Wall -Wextra -pedantic`** in gcc 13, clang 22 *and* the browser compiler, and run ASan+UBSan-clean natively, unless the lesson deliberately shows an error.
- **Output differences between the browser (wasm32) and any native target are flagged automatically.** A flagged sample needs `platform` plus `predict64=…` or `predict64=none reason=…`. It shows the browser result and the learner's platform result.
- **Reference solutions pass; starters fail** (variants too). Every lesson is clicked through with Playwright.
- **Progress lives in `localStorage`** under `tdcc:v1:*` keys, with export and import as a file.
- **Content lives in `content/`** (MDX/YAML), separate from `src/`.
- **Outside resources:** at most 1–2 per module, each naming an exact chapter or lecture.
- **YouTube:** at most 2 segments per module, only when they clearly beat the app. Each goes in `videos.json` with `why`.
- **Accessibility:** axe must report no serious or critical violation on any page in light *and* dark. Contrast is WCAG AA (4.5:1). Never dim with `opacity`, and never use Unicode glyphs as icons (fonts lack them; use inline SVG: `<Icon>` and `<Mark>` in `src/components/Icon.tsx`; `Icon.test.ts` fails on a check mark, cross, play triangle or arrow glyph in a control).

## Commands (keep in sync with `package.json`)
| Command | What it does |
|---|---|
| `npm run dev` | prepare the toolchain, build `check.mjs` into `public/downloads/` (`tools/check/README.md`), start Vite |
| `npm run build` | prepare the toolchain, typecheck, `vite build`, build `check.mjs` into `dist/downloads/` |
| `npm run verify [-- --module m01 --check --force]` | compile/run every sample on gcc, clang, the browser compiler (+ stored macOS/arm/Windows results); writes `src/generated/samples/`, traces and native sessions (`src/generated/sessions/`, `docs/adr/0005-native-sessions.md`) |
| `npm run trace` | gdb stepper traces for `trace` samples → `src/generated/traces/` |
| `npm run verify:exercises` | every solution passes, every starter fails, every variant passes (browser and native) |
| `npm run exercises:expect [-- --check]` | regenerate `tests.json`/`check.json` from `cases.yaml` by running the reference solution; `--check` reports drift (`tools/exercises/README.md`) |
| `npm run lint:content [-- --strict --stats]` | word budget, cadence, fence ids, analogies, quiz and module rules |
| `npm run anim:check` / `anim:render` | HyperFrames check and render (`animations/README.md`) |
| `npm run videos:check [-- --online]` | `videos.json` schema and transcript anchors |
| `npm test` / `npm run typecheck` | Vitest / `tsc --noEmit` |
| `npm run dod -- --module m01 [--fast] [--json]` | the per-module definition of done (PLAN §3.6) as one table of every gate (`tools/dod/README.md`) |
| `npm run e2e` | Playwright click-through of every lesson, problem set, project and checkpoint, plus axe (run `npm run build` first) |
| `npm run e2e:stress [-- <playwright args>]` | the e2e suite repeated under CPU load (`e2e/AGENTS.md`) |

CI (`.github/workflows/ci.yml`) runs all of these and deploys `dist` to GitHub Pages; a PR that changes only notes (root docs, `AGENTS.md` files, skills), `LICENSE` or `research/` skips the heavy steps. The `Targets` workflow runs samples on macOS arm64, Linux arm64 and Windows MSVC and a bot commits `src/generated/targets/`. Details of both workflows: `.github/AGENTS.md`.

## Where to find what
| Path | Contents | Read before editing |
|---|---|---|
| `content/course.yaml`, `content/modules/<mNN-slug>/` | Course content: lessons, exercises, projects, quizzes | `content/AGENTS.md`, `tools/content-lint/README.md` |
| `src/` | App: `app/` pages, `interactions/`, `visualizers/`, `lesson/` card engine, `progress/` store and gating, `runtime/` browser compiler, `testing/` shared test runner and tokens, `generated/` machine output | `src/AGENTS.md` |
| `src/progress/`, `LocalTask`, the streak components | Progress document, gating, local tasks, the streak and Rio | `src/progress/AGENTS.md` |
| `src/runtime/` | In-browser compiler and runtime, `learnc.h` | `src/runtime/AGENTS.md` |
| `src/tutor/` | The optional AI tutor: settings, prompt, client, leak guard, and the lesson chat (highlight, Explain, Reply) | `src/tutor/AGENTS.md`, PLAN.md §2.6 |
| `src/testing/`, `tools/check/` | Shared test runner, tokens, the local runner `check.mjs` | `tools/check/README.md` |
| `e2e/` | Playwright specs and helpers (`lib.ts` completes every interaction from generated data) | `e2e/AGENTS.md` |
| `animations/`, `public/animations/<id>/`, `tools/anim/` | HyperFrames projects; the committed MP4, VTT, `steps.json`, stills; the check and render pipeline | `animations/README.md`, PLAN.md §4.6 |
| `tools/exercises/` | `verify:exercises`, `exercises:expect` | `tools/exercises/README.md` |
| `tools/videos/`, `videos.json` | YouTube segments and transcript excerpts | `tools/videos/README.md` |
| `tools/dod/` | The definition-of-done table | `tools/dod/README.md` |
| `tools/` (the rest) | `verify`, `trace`, `toolchain`, `mdx` (remark plugin), `shared`, `ci`, `docs` | — |
| `.github/` | `workflows/ci.yml`, `workflows/targets.yml` | `.github/AGENTS.md` |
| `docs/adr/` | Decision records: what was decided, the options and the evidence | `docs/adr/README.md` |
| `.agents/skills/` (each linked from `.claude/skills/`) | Procedures: `add-exercise`, `review-and-merge-pr`, `write-issue`; the HyperFrames skills are vendored (`skills-lock.json`) | that skill's `SKILL.md` |
| `research/` | Stage-1 reports and prototypes. Reference only; never built or shipped | — |

## Where new knowledge goes
- **Applies to every change:** this file. Keep it short; `tools/docs/agents-docs.test.ts` fails when it grows past its word limit.
- **Applies to one area:** that area's `AGENTS.md`, or its `README.md` when it has one. A new `AGENTS.md` goes in the table above (the same test fails otherwise).
- **A trap in one function:** a comment at that code, not a bullet here.
- **Something a test or lint rule can check:** write the check, with a failure message that says how to fix it; then no bullet is needed.
- **Steps for a recurring task:** a skill, `.agents/skills/<name>/SKILL.md` (frontmatter `name` and `description`), plus the symlink `.claude/skills/<name>` → `../../.agents/skills/<name>`.
- **A decision, with its options and evidence:** a new record in `docs/adr/`. Lead each note with the rule; keep run IDs and measurements in the record or the PR.
- **A fixed bug that a test now covers:** delete its bullet.
- **Detailed status and plans:** issues and PRs. The **Status** section above keeps only the current stage.
- **Never add a `CLAUDE.md` or `CLAUDE.local.md`** in the repo, and don't keep one in a folder above your checkout (for example `~/CLAUDE.md`): either stops Claude Code from reading every `AGENTS.md` (`docs/adr/0001-agent-docs-layout.md`). The test in `tools/docs/` guards only the repo. Personal notes go in `~/.claude/CLAUDE.md`, which is safe.

## Decisions (details in PLAN.md §1–§4, the client's in §12, and `docs/adr/`)
- **Browsers: Chromium-based only** (Chrome, Edge, Brave and similar; JSPI needs Chrome 137 or newer). Firefox and Safari, including iOS, are not supported and not tested; the owner decided this on 2026-10-17. Don't raise cross-browser tickets or add Firefox/WebKit Playwright projects. (A pre-filled stdin box still exists for a Chromium without JSPI, as a graceful fallback; nothing tests it.)
- **Reference environment:** CI on the GitHub Actions `ubuntu-24.04` runner is the authority for every check. Local and sandbox runs are advisory: say how your toolchain differs and let CI decide. There is no Docker (the agent sandboxes have no Docker daemon). Toolchain versions and what CI logs: `.github/AGENTS.md`.
- **Generated files:** `src/generated/{samples,traces}` are **owned by CI**. Don't commit regenerated copies and never edit them by hand. For a same-repo PR, CI regenerates them on the `ubuntu-24.04` runner and a bot commit lands on your branch (so `git pull --rebase` before you push again). If you resolve a conflict in these files, take either side; CI regenerates them. `src/generated/targets/` is written by the `Targets` workflow on `main`. Run `npm run verify` locally to look at output, not to commit it: it keeps a committed file whose only difference is a compiler version string, but your machine's toolchain can still differ from CI's in behaviour. How the bot commit works: `.github/AGENTS.md`.
- **Line endings are LF everywhere** (`.gitattributes`). Windows CRLF changes sample hashes and marks stored results stale.
- **Licensing.** MIT for the code and the course content (the client's decision): `LICENSE`, copyright (c) 2026 Abhishek Angira. `package.json`, the About page and `learnc.h` agree. Don't change it.

## Pitfalls for every change
- **Judge a failure on a clean `main` under the same load before blaming a PR.** The e2e suite and the verifier fixture tests are timing-sensitive on a busy 4-CPU machine; we saw one-off failures at load 5 to 7 that passed on rerun. Run gates one at a time and don't run e2e while other heavy jobs run.
- Never commit machine-dependent output (stack garbage, ASLR addresses). `verify --check` and `trace --check` must be stable across runs.
- **Compiler diagnostics depend on the locale.** gcc and clang print Unicode quotes in UTF-8 locales, while the generated files and tests assume ASCII. Run `verify`, `trace` and the tests with `LC_ALL=C`.
- **GitHub closes issues on negated keywords.** "Do not close #1" in a PR description closed #1 when the PR merged. For partial work write "Partial progress on #N" and never use close, closes, fix, fixes, resolve or resolves next to an issue number; the maintainer also re-checks the issue state after every merge.

## Environment (the cloud container)
- **Chromium** is at `/opt/pw-browsers`. Don't run `playwright install` there.
- **GitHub.** Web and API access is limited to repos attached to the session. `gh repo create` and GraphQL are blocked; use repo-scoped REST. API quirks, local PR review and branch clean-up: the `review-and-merge-pr` skill.

## Git
- The lead session works on `main`; everyone else uses a branch and a pull request (see **Start here**). Commit messages are descriptive; add the attribution lines your harness supplies.
- Pull with rebase before you push (the Targets bot commits to `main`). Never force-push.
