# tools/check: the local runner (`check.mjs`) and the project zip

`check.mjs` is what learners run on their own machine (`node check.mjs`, or `make test`). It is one
zero-dependency ES module for Node 18+, bundled from `tools/check/src/check.ts` and `src/testing/`
by `tools/check/build.mjs`. It has the same test semantics as the in-browser runner because both run
`src/testing/runner.ts`; only the `ExecBackend` differs (the learner's compiler here, the wasm
toolchain in the browser).

## Building

```
node tools/check/build.mjs                  # dist-tools/check.mjs
node tools/check/build.mjs --into dist      # ... and dist/downloads/check.mjs (npm run build does this)
node tools/check/build.mjs --zip <dir> --out <file.zip> [--solution] [--seed HEX]
```

`--zip` is the CI reference implementation of the download: `<dir>` is a project folder
(`content/modules/*/project/<id>/`), an LT exercise folder or a variant folder. `--solution` ships the
reference solution instead of the starter (CI only), `--seed` writes a `.learner` file.

## Running

```
node check.mjs [folder] [--hint] [--only "check name"] [--cc gcc] [--json] [--verbose] [--keep]
```

| Option | Meaning |
|---|---|
| `--hint` | Reveal one more hint tier for the first failing check that has one. Tiers already revealed stay visible (`.check-state`). |
| `--only NAME` | Run only the check called NAME (the compile check always runs). Such a run prints no progress code and does not count as a run: unselected checks would read as failures. |
| `--cc COMPILER` | Compiler to use; default `--cc`, then `$CC`, `cc`, `clang`, `gcc`. |
| `--json` | Machine-readable report (used by `tools/exercises`). |
| `--verbose` | Also print the full compiler output. `--keep` keeps the temporary build folder. |
| `--doctor` | Print the environment report instead of running checks (below). Takes `--cc`. |

Exit status: `0` every check passed, `1` some failed, `2` the folder or `check.json` is unusable.
Output is plain text with colour on a TTY (`NO_COLOR` is respected, `FORCE_COLOR` forces it) and an
ASCII fallback for `✓ ✗` on Windows consoles that are not Windows Terminal.

Other environment variables (for tests): `CHECK_PLATFORM=darwin` pretends to be macOS (so the `leaks`
path can be tested on Linux), `CHECK_NO_SANITIZERS=1` pretends no sanitizer runtime exists (valgrind path),
`CHECK_TOOL_TIMEOUT_MS=1000` replaces the time limit of `leaks` and valgrind (so a tool that never finishes can be tested in seconds).

### `--doctor`

`node check.mjs --doctor` (`src/doctor.ts`, lesson 3.1) needs no project folder. It prints the architecture
(`uname -m` and Node's `process.arch`), the OS, the compiler `findCompiler` picks and its version, Node,
whether gdb, lldb, Valgrind and `leaks` are on `PATH`, which memory checks work (`NativeBackend.capabilities`),
the cache-line and page size (`getconf` on Linux, `sysctl` on macOS), the `sizeof` table of a small program
built with that compiler, and the "my machine" value to pick in the course (`mac-arm`, `mac-intel`, `wsl`,
`linux-x86` or `linux-arm`; `assess()` returns it, and `doctor-lesson.test.ts` checks lesson 3.1's question against it). On an Apple-chip Mac whose Node runs under Rosetta (`process.arch` is `x64`) it
says so and how to change it. A value it cannot read prints as `unknown`, never as 0.

Exit status: `1` when there is no C compiler or Node is older than 18, each with the command to install it;
otherwise `0`. A missing gdb, lldb, Valgrind or `leaks` is a note. `CHECK_PLATFORM` and `CHECK_NO_SANITIZERS`
apply to it too.

### Order of checks (this order is also the bits of the progress code)

1. `compiles without warnings` (`compiles` when `warnings: "allow"`). Builds the learner's *unmodified*
   sources with `-std=c17 -Wall -Wextra -pedantic -g -O0 -lm`. If this fails, every other check is skipped.
2. Each entry of `tests`, in order: I/O tests, unit tests (harness), make tests, scan tests, file tests.
3. `no memory errors or leaks`, when `memory` (or `leakcheck`) is set.

Memory check by platform: Linux and WSL use ASan + UBSan, with LeakSanitizer for leaks (a container that
forbids ptrace falls back to valgrind). macOS uses ASan + UBSan with `detect_leaks=0` and runs
`leaks --atExit` on a plain build. A compiler without sanitizer runtimes (for example clang without
compiler-rt) falls back to valgrind when it is installed; otherwise the check is skipped with a message.
`leaks` and valgrind run as their own process group, which is killed at the time limit and as soon as the tool
exits. Ctrl+C, closing the terminal or a SIGTERM while one runs kills that group too before `check.mjs` ends, so nothing
they start outlives `check.mjs`. A memory tool that gives no result fails the check with a message
that says what was not checked, for example `leaks did not finish within 40 s, so leaks were not checked`. That covers
a tool that times out, is missing or can't be started (for example `valgrind could not be started (EACCES)`), a `leaks` that exits without its `N leaks for M total leaked bytes` line, and a
program that doesn't finish under ASan. It is never a pass, a note or a skip.

## `check.json`

`check.json` is a `TestsSpec` (`src/content-model/types.ts`); exercises call the same file `tests.json`.
`validateTestsSpec()` in `src/testing/spec.ts` is the schema; unknown keys are warnings.

```jsonc
{
  "version": 1,
  "title": "Caesar cipher",          // optional, shown in the header
  "binary": "caesar",                // optional: executable name in "ran: ./caesar 23"; default sources[0] minus ".c"
  "sources": ["caesar.c"],           // files the learner submits; the first one defines main
  "warnings": "error",               // "error" (default) or "allow"
  "memory": true,                    // native memory check (browser exercises use "leakcheck")
  "tests": [
    { "name": "encrypts \"a\" with key 1",
      "run": { "args": ["1"], "stdin": "a\n", "timeoutMs": 2000 },
      "expect": { "stdout": "ciphertext: b\n", "exit": 0 },         // stdout/stderr: string = exact, or
      "hints": ["nudge", "concept", "partial code"] },              // { equals | contains[] | notContains[] | matches | trim }
    { "name": "rotate() unit tests", "unit": { "harness": "tests/test_rotate.c" }, "hint": "one hint" },
    { "name": "make tracks the header", "make": { "target": "greet", "expectRebuild": ["greet.h"] } },
    { "name": "bit_and uses only ~ and |", "scan": { "function": "bit_and", "allow": ["~", "|"], "maxOps": 4 } },
    { "name": "hello.i is preprocessed", "file": { "path": "hello.i", "expect": { "contains": ["int main"] } } }
  ]
}
```

- A negative test (`exit` non-zero) must supply `run.stdin` and check stdout or stderr: an empty stdin
  can make a starter "pass" by accident, so the spec validator rejects it.
- `hint` is one tier; `hints` is a list of tiers shown one at a time. Every failing check shows its first
  tier; `--hint` reveals the next.
- **Unit tests.** A harness is an ordinary C file with `int main(void)` that includes `check.h` and calls
  `CHECK`, `CHECK_EQ_INT`, `CHECK_EQ_LL`, `CHECK_EQ_CHAR`, `CHECK_EQ_STR`, `CHECK_EQ_DBL(a, e, eps, name)`.
  The runner generates one translation unit that `#define`s `main` to `learner_main`, `#include`s the
  learner's first source (warnings `-Wreturn-type`/`-Wmissing-prototypes` silenced around the include) and
  then the harness, so static helpers are testable and the learner's `main` return value is never trusted
  (`src/testing/harness.ts`). A check that never reports counts as failed.
- **Make tests** run `make <target>`; `expectRebuild` touches each listed file and checks that `make -q`
  then considers the target out of date, which verifies the Makefile's prerequisites.
- **File tests** (`file`, native only) check a file the learner made, relative to the project folder: it
  must exist (else "there is no file …") and its text must match `expect`, a `TextExpect` as for stdout.
  With `binary: true` each byte is read as one character, so `matches` can test bytes (`"^\\x7fELF"`).
  They run after the compile check, in order, so a `make` test can build the file first. A backend without
  the learner's folder (the browser) skips them with the reason; a skip is never a pass.
- **Scan tests** (`scan`) limit what one function of the learner's first source may contain, for
  operator-restricted puzzles: only its parameters, its own locals, type names and `return`; integer
  literals up to `maxLiteral` (default 255); only the operators in `allow`; at most `maxOps` operator
  tokens (`=`, parentheses, braces, commas and semicolons are free); no calls, loops, `if`, `?:` or
  `sizeof`; no casts (except `(void)`); and no `#` line anywhere in the file except `#include`. These
  are also rejected anywhere in the file: digraphs and trigraphs (`%:`, `<:`, `:>`, `<%`, `%>`, `??`),
  a backslash-newline, a second definition of the function, `@` in a string, and `__attribute__`, asm,
  `_Pragma` or `exit`-style names. With `exclusive: [names]` the whole file may hold only
  `#include <stdint.h>`, definitions of those functions and `main`, and no string or character literal
  (this is what stops a learner file from redefining `printf` to forge a unit report). Comments are
  blanked first, so they never count. It needs no compiler and runs the same code (`src/testing/scan.ts`) in the browser, in
  `tools/exercises` and here. Pair it with a unit test that checks behaviour: the scan alone says nothing
  about correctness.

## Progress codes and completion tokens

Defined in `src/testing/token.ts`, shared by `check.mjs` and the app, and pinned by the vectors in
`src/testing/token.test.ts`:

```
progress code     TDCC1-R1-<exercise>-<bits>-<run>-<src8>-<mac8>     e.g. TDCC1-R1-project.caesar-01000000-3-1a2b3c4d-...
completion token  TDCC1-R1-<exercise>-DONE-<mac8>
```

`R1` is the runner version (the app accepts `ACCEPTED_RUNNER_VERSIONS`), `bits` has one digit per check
in the order above, `run` counts runs in this folder (`.check-state`), `src8` hashes the learner's
sources, and `mac8` is the first 8 hex digits of `SHA-256(payload|seed|public salt)`. The seed is the
learner's 16-hex-digit seed from `.learner`. The exercise id is the app's id with `/` written `.`
(`project/mario-more` becomes `project.mario-more`). Codes are tamper-evident, not tamper-proof.

## The project zip

One layout for the app (built in the browser by `buildZipFromFolder()`) and for CI (`build.mjs --zip`),
both from `src/testing/project-zip.ts`:

```
<name>/                      <name> = last part of the exercise id ("project/mario-more" -> mario-more)
  README.md                  the project's README, or one generated from the title and prompt
  Makefile                   the project's Makefile, or a generated GNU Make 3.81-safe one
                             (make = build, make test = node check.mjs, make hint, make clean)
  check.json                 the tests (a project's check.json, or an exercise's tests.json)
  check.mjs                  this runner (executable bit set)
  learnc.h                   the course helper header (src/runtime/c/learnc.h)
  compile_flags.txt          Module 3 exercises ("m03-…") only: -std=c17 -Wall -Wextra -pedantic, one per line, for clangd
  .learner                   {"version":1,"seed":"<16 hex>","exercise":"<id>"}   (only with a seed)
  tests/...                  unit-test harnesses and data
  *.c, *.h                   the starter files: starter/* of a project, starter.c of an exercise
                             (named after check.json's first source)
```

Never in the zip: `solution/`, `solution.c`, `variants/`, `exercise.yaml`, `project.mdx`. The zip is
byte-for-byte deterministic for the same input (fixed timestamps).

`folderToProjectFiles()` maps a content folder to these files and is what both builders call; a variant
is an ordinary folder of its own, so zip it by pointing at the variant folder.

## Tests

`npx vitest run tools/check` runs `check.mjs` end to end on `fixtures/caesar` (a project with a buggy
starter, a reference solution, a unit-test harness and a memory check) using gcc + ASan/UBSan/LSan:
the solution passes everything and earns the token; the starter fails with explanations and a progress
code that `verifyCode()` accepts; a leak-only variant fails only the memory check; a syntax error
skips everything after the compile check; the valgrind fallback (clang-18, no sanitizers), the macOS
`leaks` path (simulated, including stand-ins that print nothing, never exit, leave a process holding the pipes, keep running after Ctrl+C, or can't be started), a
valgrind that never exits, a program that times out under ASan, make tests, file tests (present, missing, wrong, binary), `--doctor` (this machine,
`CHECK_PLATFORM=darwin` with and without stand-in macOS commands, `CHECK_NO_SANITIZERS=1`, no compiler), the zips
and the generated Makefile are covered too.

## Platforms verified by CI

The `project-runner` job in `.github/workflows/targets.yml` builds the Mario and Credit project zips, the `fixtures/caesar` zip and the zip of the LT exercise
`m03-doctor` (lesson 3.1; its codes name `m03-doctor`, so the matrix entry sets `exercise:`), runs `make test` on the starter
(must exit non-zero and print a progress code) and on the `--solution` zip (must exit 0 and print a completion token), and
checks each code with `verifyCode()`. Before that, once per runner (in the Mario job), it runs `node check.mjs --doctor`; the
grading steps don't use its output, but a non-zero exit fails the job, because these runners have a compiler and Node 22. For caesar,
which has a memory check, one more step copies `fixtures/caesar-variants/leaky.c` into the solution and requires `make test`
to fail with `✗ no memory errors or leaks` and a `memory leak:` line. It runs on pull requests that touch these files. On pushes to `main` the workflow runs only for changes under `content/**`, `src/runtime/c/**` or `tools/verify/**`, so a push that touches only `tools/check` or `src/testing` doesn't run it.

| Platform | Status |
|---|---|
| Linux x86-64 (Ubuntu 24.04, gcc 13 / clang 22) | `npm test` runs `check.mjs` on `fixtures/caesar` (`ci.yml`) |
| macOS arm64 (`macos-14`, Apple clang) | `project-runner` |
| Linux arm64 (`ubuntu-24.04-arm`, gcc) | `project-runner` |
| Windows | **not run**: use WSL Ubuntu 24.04 (the Linux path); native Windows is unsupported and untested |

Caesar's memory check runs the real `leaks --atExit` on `macos-14` (issue #101), on the solution and on the leaky variant. `m03-doctor`'s runs it too, on the starter and the solution, and prints `✓ no memory errors or leaks  (AddressSanitizer, UBSan, leaks)`; each grading step takes a few seconds.
