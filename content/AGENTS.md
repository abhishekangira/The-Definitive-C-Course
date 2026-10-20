# content/: lessons, exercises, projects and quizzes

Notes for anyone editing course content. The root `AGENTS.md` comes first: its non-negotiables decide what a lesson may say and ask. The lint rules are in `tools/content-lint/README.md` and the exercise checks in `tools/exercises/README.md`. To add an exercise, follow the `add-exercise` skill (`.agents/skills/add-exercise/SKILL.md`).

## Format
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
- **Exercises:** `kind` is `ct` (write), `fb` (fix a bug from a symptom), `pa` (Parsons) or `lt` (runs on the learner's machine). Exactly three hints (nudge → concept → partial code). A variant inherits nothing from its parent. `tests.json` is `{version, sources, warnings, tests[{name, run{stdin,args}, expect{stdout,exit}, hint}]}`. For single-file stdin/args/stdout/exit exercises it is **generated**: write `cases.yaml` (`cases: [{name, stdin?, args?, hint?}]`) and run `npm run exercises:expect` (see `tools/exercises/README.md`); never type an expectation. Hand-written unit/make tests remain hand-written. How the app gates an LT exercise's solution and variant is in `src/progress/AGENTS.md`.
- **Quiz items:** `predict`, `outcome`, `choice`, `ce`, `md`, `sp`, `exercise`, `np`, `order`. A `choice` with `code` has no `answer` (the verified output must equal one choice). A `ce` needs `answer`. An `md` needs `sample`, `line`, `items` and `meta: trace predict=none`. Checkpoints run in assessment mode: no hints, no solutions, explicit skip counts as wrong, one `transfer: true` item.

## Conventions
- **C standard and POSIX.** C17 + the standard library. POSIX only in M11 (`dlopen`), M13 and the capstone's provided `memlib`. POSIX samples start with `#define _POSIX_C_SOURCE 200809L` (add `_DEFAULT_SOURCE` for glibc `d_type`, `_DARWIN_C_SOURCE` for macOS `MAP_ANON`) and mark the fence `posix`.
- **`learnc.h`** (`src/runtime/c/`) is the course helper (MIT, our own). Don't ship libcs50 (licensing is ambiguous). No libc `rand()` in prediction answers; use the `learnc.h` PRNG.
- **Normalisation.** Only `%p` output is normalised to `<addrN>`. On those lines `0`, `0x0` and `(nil)` mean NULL.
- **Traces** come from x86-64 Linux gdb and are labelled as such. Variables whose declaration has not run are recorded as `declared: false` with a placeholder value, never the stack bytes.
- **Unit-test harness:** `#define main learner_main` plus `#include` of the file defining `main`, with `-Wreturn-type` and `-Wmissing-prototypes` silenced. Never trust its return value. Multi-file projects are tested through `make` targets in `check.json`.
- **Project Makefiles must work with GNU make 3.81**, the `make` of macOS 14, where the `project-runner` job runs them (see `.github/AGENTS.md`).

## Pitfalls
- **Compiler output quoted in prose comes from the generated data, not memory.** Lesson 6 once showed `did you mean 'count'?` for the typo `cuont`; clang 22 offers no suggestion there (it does for `cont`), so the lesson contradicted the diagnostics panel. Copy messages from `src/generated/samples` (`raw`), and re-read the sentences around them whenever a sample changes.
- **A `scan` exercise must also reject ways to hide code from the scan:** digraphs and trigraphs (`%:` is a `#`), backslash-newline, a second definition of the function, and casts in the body (see `src/testing/scan.ts`). `unit` tests trust `@@PASS` lines on stdout, so such a file also rejects `@`, `__attribute__` and `exit`-style calls (issue #42 comment; a harness token would fix it properly). Read "Operator-restricted exercises" in `tools/exercises/README.md` (`exclusive`) before writing one.
