# tools/content-lint: `npm run lint:content`

PLAN §2.4 (content format) and §2.5 (cadence, checkpoints, retrieval) as a build gate. It reads `content/modules/**`
and fails the build (exit status 1) on any error. Warnings are printed but pass, unless you add `--strict`. Notes (`info`)
are printed and never fail, not even with `--strict`; they are what a draft module is still missing (next section).

```
npm run lint:content [-- --content-root dir] [--module m01] [--strict] [--errors-only] [--stats] [--json]
                      [--videos file] [--public dir] [--animations dir]
```

| Option | Meaning |
|---|---|
| `--content-root dir` | The folder holding `modules/` and `course.yaml` (default `content/`). Everything else is found relative to its parent, the *site root*: `videos.json`, `public/animations/`, `animations/`. |
| `--module m01` | Only report this module (id or directory name). Cross-module checks (duplicate sample ids, lesson ids) still look at everything. |
| `--strict` | Warnings also fail the run. |
| `--errors-only` | Hide warnings and notes in the report. |
| `--stats` | Also print, for every lesson, its minutes, card count and the prose words of each card (red above 250, yellow above 200). |
| `--json` | Machine-readable result instead of the report. |
| `--videos`, `--public`, `--animations` | Override those three locations. |

Output is grouped by module (site-level files such as `course.yaml` first), one message per line, sorted by file and
line, with a clickable path:

```
m01-c-in-your-browser (1 error, 1 warning)
  content/modules/m01-.../lessons/02-types-are-layouts.mdx:91  error    the first fence of <CompilerError> … [interaction-props]
  content/modules/m01-.../lessons/01-hello-compiled-world.mdx:48  warning  <Animation id="a01-press-run"> is not rendered yet … [animation-asset]
```

The bracketed rule id is listed below. There is no way to silence a rule: fix the content, or change the rule here.

## Draft modules (`available: false` in `course.yaml`)

A module that `course.yaml` does not release is a **draft**: the app does not open it (`src/content-runtime/release.ts`)
while it is built. For a draft, the rules that ask whether the module is *complete* report a note (`info`) instead of an
error or warning, so `--strict` passes while the pieces arrive one pull request at a time:

| Rule | Becomes a note when |
|---|---|
| `quiz-missing` | `quizzes/checkpoint.yaml` or `quizzes/retrieval.yaml` does not exist yet |
| `module-project` | the project folder, or its `check.json`, `project.mdx` or `exercise.yaml`, does not exist yet |
| `module-exercise` | `problemSet` or `coreExercises` lists an exercise whose folder does not exist yet, or a core exercise has no variants yet |
| `module-time` | the lesson minutes written so far do not add up to `time.lessons` (lessons are added one by one) |
| `course-yaml` | the folder exists but `available` is `false` (always a note, since that is what a draft is) |

**Every other rule still applies to a draft**, on every file that exists (so `exercise-unused` still warns, and `--strict` fails on it: add an exercise in the same pull request as the lesson, problem set, core list or quiz that uses it): a lesson over its word budget, a listed lesson
with no file, a bad `module.yaml` field, a broken exercise reference, a duplicate exercise id. A draft is not an excuse for
a broken file. Setting `available: true` turns the notes back into the errors and warnings above.

## How lessons are read

The lesson is parsed with the same unified pipeline as the site (`remark-parse`, `remark-mdx`, `remark-frontmatter`,
`remark-gfm`). Its ` ```c ` fences are then replaced by `<CodeSample>` (with `id=`) or `<CodeBlock>` (`fragment`) exactly
as `tools/mdx/remark-course.ts` does, but reporting problems instead of throwing, and the top-level nodes are grouped
into cards with `groupCards()` and counted with `countWords()` from `src/content-model/cards.ts`. So the word budget
is measured on the cards learners see: a fence that has an `id` ends a card, a `fragment` fence does not.

## Rules

### Lessons (`lessons/*.mdx`)

| Rule id | Severity | What it enforces |
|---|---|---|
| `mdx-parse` | error | The MDX parses. |
| `frontmatter` | error / warning | `id`, `title`, `minutes`, `summary` present with the right types; unknown keys warn. |
| `lesson-minutes` | error | `minutes` is 25 to 60. |
| `lesson-id` | error / warning | Lesson ids are unique across the course (progress is keyed by them); an id that does not look like `m01-l<N>[-slug]` warns. |
| `card-count` | warning | A lesson has 2 to 14 cards. |
| `word-budget` | error | A card has at most 250 words of prose (paragraphs, headings, lists, tables, inline code; not fences, JSX props or analogies). |
| `media-needs-interaction` | error | An `<Animation>` or `<YouTube>` is in a card that ends with an interaction (so not in the final, ungated card). |
| `media-per-card` | error | At most one animation or video per card. |
| `fence-id` | error | Every ` ```c ` / ` ```h ` fence has `id=` or `fragment`. |
| `fence-meta` | error | Fence meta parses: unknown keys (`toSampleMeta` throws), bad `expect=`, bad quoted JSON strings. |
| `fence-lang` | error / warning | ` ```C ` / ` ```H ` would silently bypass every check (error); an untagged fence that looks like C warns. |
| `hand-typed-output` | error | A `text`, `txt`, `console`, `sh`, `bash`, `shell` or untagged fence contains tool output (`runtime error:`, `==N==` or `==PID==`, `undefined reference`, `AddressSanitizer`, `(gdb)`, `(lldb)`, `make: ***`): tool output is never typed by hand, so show it with `<Transcript>` from a native session (`content/AGENTS.md`). |
| `fence-nesting` | warning | A sample fence inside a list or blockquote is not a card interaction. |
| `sample-id` | error | Sample ids are lower-case kebab-case (they name generated files). |
| `duplicate-sample` | error | Sample ids are unique across the whole course (lessons and quiz code together). |
| `predict-before-run` | error | A top-level `id` fence is predict-before-run: `predict=none` / `run` is only allowed for fences nested in a component (`<Stepper>`, `<CompilerError>`, `<PipelineExplorer>`, `<MemoryDiagram>`…) or in a quiz item type that has no prediction. |
| `ub-prediction` | error | A sample with `expect=ub` (also `expect.gcc=ub`…) must not ask for its exact output: use `predict=outcome` or `choices=…` (PLAN §3.4). |
| `platform-predict64` | error | `platform` needs `predict64="…"` or `predict64=none reason="…"`; `predict64` needs `platform` (PLAN §3.2). |
| `posix-scope`, `posix-flag` | error | `posix` only in M11, M13 and the capstone; a `#define _POSIX_C_SOURCE` requires the `posix` flag (PLAN §4.4). |
| `analogy` | error / warning | `<Analogy>` has non-empty `js`, `c` and `breaksDown` (string or literal expression); a very short breakdown warns. |
| `analogy-review` | warning | `breaksDown` contains "exactly" or "same": check it names a real difference (PLAN §2.5). |
| `interaction-props` | error / warning | `<Choice>` / `<CompilerError>`: `question`, `options` (at least 2, unique), `answer` (a number, in range), `explain` (warning); `<CompilerError>` has a nested fence whose first program produces a message (`expect=compile-error`, `expect=warning`, or `warn=-W…`), or `session="id"` with a `fix` of `"compile"`, `"ubsan"`, `"leak"` or `{false}` (a checked fix nests exactly one fence, the fixed program, which compiles cleanly with defined behaviour; `{false}` nests none; `stage="link"` needs the stored report at that `step`, on every platform, to be a linker's: "undefined reference", "multiple definition", "ld returned", Apple ld's "Undefined symbols" or "duplicate symbol"); its `stage`, if any, is `preprocess`, `compile`, `assemble`, `link` or `run`; `<MemoryDiagram>` has `ask`; `<NumberDrill>` bases and width (`kind="float"`: 32-bit, hex to dec or dec to hex, decode values with an exact short decimal form). Props that are not literals (`options={opts}`) or elements with spread props are not judged. |
| `exercise-ref` | error | `<Exercise id>` and any `exercise="…"` prop resolve to `exercises/<id>/exercise.yaml` (or `<id>/variants/<n>`, `project/<id>`) **in the same module**. |
| `sample-ref` | error | `<Stepper sample>`, `<MemoryDiagram sample>` / `trace`, `<CodeSample sample>`, `<TraceTable sample>` name a sample defined in the same module's lessons or quizzes; a Stepper/MemoryDiagram with neither `sample` nor a nested fence is an error. |
| `sample-trace` | error | The sample used by a Stepper or MemoryDiagram has the `trace` flag. |
| `animation-asset` | error / warning | `<Animation id>`: `public/animations/<id>/steps.json` exists. Missing but `animations/<id>/` exists: warning (not rendered yet). Neither: error. |
| `video-ref` | error / warning | `<YouTube video>` is a key of `videos.json`; a video registered for another module warns. |
| `video-limit` | error | At most 2 distinct videos per module. |
| `unknown-component` | warning | An element that is not a known lesson component (`KNOWN_ELEMENTS` in `lesson.ts`: the sets in `cards.ts` plus `Card`, `TestExample`, `Kbd`). |

### `module.yaml` and `course.yaml`

| Rule id | Severity | What it enforces |
|---|---|---|
| `module-yaml` | error / warning | Every `ModuleMeta` field present and well-formed (`id`/`number` match the directory, `lessonsRunIn`/`projectRunsIn` in `browser\|native\|both`, `successCriteria` entries `{ sc: SC<N>, level: I\|D\|A }`, `retrieval.sources`); unknown fields warn. |
| `module-time` | error / warning | `time.*` adds up to `hours` (±0.1); `weeks` ≈ `hours / hoursPerWeek` (warning); lesson minutes ≈ `time.lessons` (warning, ±0.75 h; a note in a draft). |
| `module-resources` | error | At most 2 outside resources, each with a `title` and a non-empty `detail` (the exact chapter or lecture); `url` is http(s). |
| `module-lesson` | error / warning | Every listed lesson file exists; a lesson on disk that is not listed warns. |
| `module-exercise` | error / warning | `problemSet` and `coreExercises` exist under `exercises/`; a core exercise with no variants warns (both notes in a draft). |
| `module-project` | error | `project/<id>/` exists with `check.json`, `project.mdx` and `exercise.yaml` (a note in a draft). |
| `exercise-unused` | warning | An exercise that no lesson, quiz, problem set or core list uses. |
| `duplicate-exercise` | error | Exercise folder names (and `project/<id>`) are unique across the whole course: the app keys an exercise by its folder name without the module, so a second module with `cash` would replace the first one's. Applies to drafts too. New modules prefix their folders (`m03-gdb-hunt`). A variant collides only with its exercise. The error is reported on the module that comes later in `course.yaml` order (the first one owns the name). |
| `quiz-missing` | error | `quizzes/checkpoint.yaml` and `quizzes/retrieval.yaml` exist (a note in a draft). |
| `quiz-file` | warning | Another file in `quizzes/` (the app reads only those two). |
| `course-yaml` | error / warning / note | `course.yaml` lists every module directory with matching `dir`, `number`, `hours`; `available: true` modules exist; a folder whose entry says `available: false` is a draft (note). |
| `yaml-syntax` | error | Any YAML file parses. |

### Quizzes (`quizzes/checkpoint.yaml`, `quizzes/retrieval.yaml`)

A quiz file is a YAML list of items (or an object with `items`, `pool` or `questions`, as `tools/verify` accepts).

| Field | Meaning |
|---|---|
| `id` | kebab-case; unique in the module. Items with `code` are samples too, so their ids are unique course-wide. |
| `type` | `predict` \| `outcome` \| `choice` \| `ce` \| `md` \| `sp` \| `exercise` \| `np` \| `order` |
| `prompt` | The question (Markdown). Required. |
| `explain` | Shown after answering. Required for every type except `exercise` and `np`. |
| `code?` | A C program. It is a verified sample: its output, diagnostics or trace come from running it. |
| `meta?` | Fence meta for that sample (`expect=compile-error`, `stdin="3\n"`, `trace`…). Must not set `id=`. |
| `choices?` | 2 to 6 distinct options, for `choice` and `ce`. Strings or `{ text }`. |
| `answer?` | Index into `choices`. **Only** for items whose answer cannot come from running code: a `choice` **without** `code`, and every `ce` (which explanation of the message is right). Forbidden on `predict`, `outcome`, `md`, `sp`, `np`, `order`, `exercise`, and on `choice` with `code` (there the right choice is the one equal to the program's output). |
| `exercise?` | Exercise id (in this module), for `type: exercise`. |
| `sample?`, `line?`, `items?` | `md`/`sp`: the traced sample (it needs `trace`), the source line the diagram pauses before (`md`), the cells to fill in (`md`, e.g. `["add.a", "main.x"]`). `np`: `[value, from, to, width]` (`from`/`to` in `dec\|bin\|hex`, width 8/16/32/64). `order`: at least two distinct lines in their correct order. |
| `transfer?` | `true` on the checkpoint item set in an unfamiliar context. |
| `from?` | Retrieval only: the module the item comes from (`m01`…), or `js` for Module 1's diagnostic. |

| Rule id | Severity | What it enforces |
|---|---|---|
| `quiz-schema` | error / warning | The per-type fields above, including the `answer` rules; unknown fields warn. |
| `quiz-id` | error | Item ids are unique within the module. |
| `quiz-meta` | error | The item's `meta` parses (same parser as `tools/verify`) and does not set `id=`. |
| `checkpoint-composition` | error | 8 to 12 items, including: a **write-code** item (`exercise` whose exercise has kind `ct`, or `lt`), a **fix-a-bug** item (kind `fb`, or `lt`; the two must be different items, so one `lt` cannot be both), a **memory/stepper** item (`md` or `sp`), a **compiler/tool-message** item (`ce`), and at least one **transfer** item (`transfer: true`). Every missing part is reported. |
| `retrieval-composition` | error / warning | 6 to 10 items; for modules 2 and up, a warning when no item comes from the previous module, or (module 3 and up) all items come from one module. |
| `retrieval-from` | error | Every item has `from`: `js` in Module 1 (and only there), an earlier module that is in `course.yaml` elsewhere. `module.yaml` `retrieval.sources` must list exactly the modules the items come from (`module-yaml`). |

The sample rules of the lesson section (`ub-prediction`, `platform-predict64`, `posix-*`, `sample-id`, `duplicate-sample`)
also apply to the code of quiz items; `predict` items are predicted by output, `outcome` by outcome, `choice` by choices,
and `ce`, `md`, `sp` have no prediction.

## Code map

| File | Contents |
|---|---|
| `cli.ts` | Argument parsing, report and `--stats` rendering, exit status. |
| `lint.ts` | `lintContent(options)`: discovers modules, loads everything (phase 1), then runs the rules (phase 2), so references resolve against complete modules. No printing. |
| `lesson.ts` | MDX parsing, fence lowering, cadence and element rules. |
| `quiz.ts` | Quiz loading and the item, checkpoint and retrieval rules. |
| `module.ts` | `module.yaml` and `course.yaml` rules. |
| `samples.ts` | The fence-meta rules shared by lesson fences and quiz code. |
| `jsx.ts`, `yaml-file.ts`, `messages.ts`, `context.ts` | JSX attribute evaluation (literal expressions from the ESTree), YAML with line positions, the message collector, shared run state. |
| `lint.test.ts` | About 100 tests. `fixtures/good` is a complete two-module site that must produce **no** message; most tests copy it to a temp folder, make one change and assert exactly the rule that should fire (boundaries included: 250/251 words, 25/60 minutes, ±0.1 h, 8/12 items). `fixtures/bad` is one module of bad lessons, one of bad `module.yaml` fields and one of bad quizzes, asserted down to the line. |

## Limits

- It checks what can be decided from text. Whether a sample compiles, prints what a prediction expects, or has a trace
  is `tools/verify` and `tools/trace`; whether an exercise's solution passes is `tools/exercises`.
- `answer` on a `choice` item *with* code is rejected on purpose. A "why" question about a program that has a clear
  conceptual answer should be a `choice` without code (quote the relevant lines in the prompt) or a `ce` item.
- `tools/mdx/remark-course.ts` and `lowerFences()` in `lesson.ts` implement the same fence-to-component step; if one
  changes, change the other (the tests compare card counts against the renderer's grouping rules).
