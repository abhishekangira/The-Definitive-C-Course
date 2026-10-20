# 0003: Unreleased modules stay out of the app; `?preview=` opens them

Status: Accepted (2026-10-20, issue #73, PR 1 of the Module 3 stack)

## Context
`available` in `content/course.yaml` was read only by `lint:content` and by the e2e helper. The app registered every `content/modules/*/module.yaml` on disk, so the day a half-built Module 3 was merged, every learner who had finished Module 2 could open it. Module 3 is delivered as a stack of pull requests that are merged one at a time, so a draft will sit on `main` for weeks. The same registry keyed exercises by folder name across modules, so a draft's `exercises/cash/` would also have replaced Module 1's.

## Decision
1. **One guard, at the registry.** `buildRegistry` (`src/content-runtime/release.ts`) registers a module only when `course.yaml` says `available: true`, or when `?preview=` names it. Gating, "up next", the map, every page, the lesson, project and quiz loaders and the exercise index all start from that registry, so a module that is not in it is not openable, not unlocked and not counted. A draft is skipped before its lessons are read, so a half-built one cannot make the app throw while it loads.
2. **A runtime preview switch.** `?preview=m03` (comma list allowed) is read once from the page URL, before the `#`, so it survives in-app links and a reload (`src/content-runtime/preview.ts`). It opens only ids that `course.yaml` lists as unreleased and that have a folder, so a link that outlives the release does nothing. A banner on every page says "Preview: Module 3 is not released yet", with a link out. The preview does **not** skip the lock: the earlier modules must be complete in the real progress.
3. **Preview progress is its own document.** While a draft is previewed the progress store reads the real document, merges its own over it (`mergeProgress`) and writes only `tdcc:v1:progress-preview`. The real `tdcc:v1:progress` is never written, so nothing done in a half-built module (a checkpoint pass, a project) carries into the release.
4. **Lint treats a draft as work in progress.** For a module with `available: false`, the completeness rules (`quiz-missing`, `module-project`, `module-exercise`, `module-time`, `course-yaml`) report a note (`info`), which never fails `--strict`. Every rule on a file that exists still applies. A new `duplicate-exercise` rule makes exercise folder names unique across the whole course.

## Options not taken
- **A check in every consumer** (gating, `next`, the map, each page). Many places, and the next page added would forget one.
- **A build-time flag.** `ci.yml` runs one `npm run build` and uses that `dist/` for the e2e and, on `main`, for the Pages deploy (`upload-pages-artifact`), so a build that includes the draft for e2e would publish it.
- **A Settings toggle.** Learners could find it, and its state would live in the learner's storage.
- **Preview progress in memory only.** The click-through asserts on stored progress, and a reload would send the reviewer back to the warm-up quiz.
- **Preview writes the real document.** A reviewer's checkpoint pass in a draft would still be there after the release.

## Evidence
- `src/content-runtime/release.test.ts`, `src/progress/gating.test.ts` and `next.test.ts` (their fake courses are built by the real `buildRegistry`) fail when the guard is reverted (6 failures); `src/progress/store.preview.test.ts` fails (4 failures) when the preview writes the real key.
- `e2e/unreleased-modules.spec.ts` runs the real app over a two-module fixture in `e2e/fixtures/unreleased/`: the draft is closed, opens with `?preview=`, and leaves the real progress byte-identical; the same two mutations fail it.

## Consequences
- A reviewer opens a draft with `<site>/?preview=m03`. Their preview progress stays in that browser's `tdcc:v1:progress-preview` (clear it in the browser's storage to start over); what the real document gains meanwhile still flows in at the next load.
- Anyone who guesses the URL can read a draft. The content is in the public repository anyway.
- `E2E_MODULE=m03` opens a draft through the preview (`e2e/lib.ts` `clickThroughModules`); `availableModules()` still means the released ones.
- Exercise folder names must be unique across modules; new modules prefix theirs (`m03-gdb-hunt`).
