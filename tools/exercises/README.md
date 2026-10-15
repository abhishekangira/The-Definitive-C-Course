# tools/exercises: `npm run verify:exercises` and `npm run exercises:expect`

PLAN §3.3: every reference solution passes, every starter fails at least one test, every variant is
checked the same way. A single command, no flags needed:

```
npm run verify:exercises [-- --module m01] [--only cash] [--content-root dir] [--cc gcc] [--verbose] [--json]
```

Exit status 1 if any exercise, variant or project has a problem. `--only` matches an exercise id (which
includes its variants) or a project id (`mario-more` or `project/mario-more`).

## Folder model (the same as the app's)

```
content/modules/<module>/
  exercises/<id>/                  exercise.yaml  starter.c  solution.c  tests.json  tests/...
  exercises/<id>/variants/<n>/     a folder of its own: exercise.yaml  starter.c  solution.c  tests.json  tests/...
  project/<id>/                    exercise.yaml  check.json  Makefile  README.md  tests/  starter/  solution/
```

Ids are `<id>`, `<id>/variants/<n>` and `project/<id>`, and `exercise.yaml` must declare exactly that `id`.
**A variant inherits nothing from its parent**: the app loads a variant's folder alone, so a variant that
needs a harness keeps its own `tests/`. Its learner file is its own `tests.json` `sources[0]`.

## What is checked

- `exercise.yaml`: required fields (`id kind title prompt runsIn hints variants`), `kind` in `ct fb pa lt`,
  **exactly three non-empty hints**, `variants` is a list of folder names (quote numeric ones: `'1'`), `file`
  equals `tests.json`'s first source, LT and native rules (`lt` runs native, `pa` runs in the browser). Unknown
  keys are warnings with a "did you mean" for the usual typos (`runs-in`, `hint`).
- `tests.json` / `check.json` (`validateTestsSpec`): names, one of `run`/`unit`/`make` per test, harness files exist,
  negative tests supply stdin and assert on output, make tests only for native exercises.
- Listed variants exist, and unlisted variant folders are warned about. A variant has `variants: []`, runs where its
  exercise runs, and passes the same checks.
- **Browser exercises (CT, FB)**: `runsIn: browser` runs the browser toolchain in Node
  (`tools/shared/wasm-node.ts`, same flags and runtime as the app) through `src/testing/runner.ts`. The runner is
  given exactly what the app gives it besides the learner's file: `.c`/`.h` files (not `starter`/`solution`) and
  `tests/*` of the folder (`browserSupportFiles`). The solution must pass every test; the starter must fail at least one.
- **Parsons (PA)**: see below.
- **Native exercises (LT) and projects**: the starter and the reference solution are zipped exactly as the app
  builds the download, then `check.mjs --json` is run on each with the local compiler (gcc + ASan here). The solution
  must pass everything and print a completion token that `verifyCode()` accepts; the starter must fail at least one
  check and print a progress code that verifies. Projects whose `exercise.yaml` says `runsIn: browser` (M1, M2) are
  additionally run in the browser toolchain, with only the first source from `starter/` and `solution/`.

## Parsons exercises

`solution.c` is the canonical program: **one block per non-blank line**, in order. `exercise.yaml` adds:

```yaml
parsons:
  distractors:                 # extra wrong lines mixed into the pool (must not be lines of the solution)
    - "int tmp = a;"
  indent: false                # true: learners also indent the lines
  accepted:                    # OPTIONAL: other valid orderings; each is a block of lines (any indentation)
    - |
      int y = 2;
      int x = 1;
```

`accepted` is optional and defaults to "the canonical order only". Every accepted ordering must be a reordering of
`solution.c`'s lines (same multiset, trimmed); it is rebuilt from solution.c's own lines, compiled and tested.
`starter.c` may be absent for PA (the app scrambles solution.c with the learner's seed). When it is present it must
be a scramble of the solution plus distractors, and it **must not** pass the tests: the learner would start with a
program that already works. If the scramble passes because the tests accept another valid order, scramble it into a
failing order and list the valid order in `accepted` (documented and compiled), or tighten the tests. The app itself accepts
any program that passes the tests, so `accepted` is documentation plus a CI guarantee, not a runtime allow-list.
(`ExerciseMeta.parsons` in `src/content-model/types.ts` does not declare `accepted` yet.)

## Generating expectations: `npm run exercises:expect`

AGENTS.md: every expected output is produced by running code, never typed. `tests.json` (projects: `check.json`) is
therefore **generated** from the reference solution and a hand-written case list:

```
npm run exercises:expect [-- --module m01] [--only cash] [--content-root dir] [--cc gcc] [--check]
```

Next to each `tests.json` (and each variant's, and each project's `check.json`) keep a `cases.yaml`:

```yaml
sources: [cash.c]          # optional; default: `file` in exercise.yaml
warnings: error            # optional; default: error
cases:
  - name: "41 cents"
    stdin: "41\n"          # optional, default ""; use double quotes for escapes
    args: ["--flag"]       # optional
    hint: "Keep asking while the amount is not greater than 0."   # optional
    timeoutMs: 2000        # optional, copied to tests.json
```

For every folder the tool builds the reference (`solution.c`; projects: `solution/<source>`) with
`gcc -std=c17 -Wall -Wextra -pedantic -Werror -I src/runtime/c` and again with `-fsanitize=address,undefined`
(LeakSanitizer on), runs every case on both builds and writes `{version: 1, sources, warnings, tests[{name, run, expect: {stdout, exit}, hint?}]}`
with the real stdout and exit code. It **rejects** a solution that does not build warning-free, reports an ASan, UBSan or leak error,
behaves differently under the sanitizers, or times out; nothing is written for a rejected folder.
`--check` writes nothing and exits 1 when a file would change (use it to prove the committed files are current).
Output is deterministic: run it twice and `git status` stays clean.

Scope: single-file, stdin/args/stdout/exit cases (what Module 1 uses). Unit-harness and `make` tests, stderr expectations and
multi-file sources are still written by hand; `exercises:expect` does not touch a folder without `cases.yaml` (it reports it).
Tests: `expect.test.ts`, fixtures in `fixtures/expect/`.

## Files

| File | Role |
|---|---|
| `cli.ts` | the command line |
| `expect.ts`, `expect-cli.ts` | `npm run exercises:expect`: `cases.yaml` + reference solution → `tests.json` |
| `discover.ts` | finds modules, exercises, variants and projects |
| `validate.ts` | `exercise.yaml` schema |
| `parsons.ts` | accepted orderings and the scramble check |
| `verify.ts` | the checks above (`verifyAll()`) |
| `wasm-backend.ts`, `wasm-run-worker.ts` | `ExecBackend` for the browser toolchain in Node; programs run in a worker thread so a timeout can kill them |
| `fixtures/` | one CT with a variant, an FB, a PA with a variant, an LT, a project (`npx vitest run tools/exercises`); `fixtures/expect/` has the `exercises:expect` fixtures |
