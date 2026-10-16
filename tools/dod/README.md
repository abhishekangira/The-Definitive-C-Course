# `npm run dod`: per-module definition of done

```
npm run dod -- --module m01 [--fast] [--json]
npm run -s dod -- --module m01 --json     # machine-readable: -s hides npm's own "> pkg dod" banner
```

Runs the checks of PLAN.md §3.6 for one module **sequentially** and prints one table (`PASS`, `FAIL`, `SKIPPED (reason)`), with the last 15 lines of output for each failure. For `verify:exercises` the failure output also lists every `✗` row and its `- problem` lines first, because the tail alone can cut off the exercise that failed. Exit status: 0 if nothing failed, 1 on any `FAIL`, 2 on a usage error. A failing step does not stop the later ones, so one run lists everything that is wrong.

The steps run one after another on purpose: the checks (browser compiler, e2e) are timing-sensitive on small machines and flake when run in parallel.

| Order | Step | §3.6 point |
|---|---|---|
| 1 | `toolchain:prepare` (writes the gitignored `src/generated/toolchain-version.json` that typecheck imports; a no-op when already prepared, so a fresh clone works after `npm ci`) | 6 |
| 2 | `typecheck` | 6 |
| 3 | `lint:content --strict --module mNN` | 3 |
| 4 | `verify --check --module mNN` | 1 |
| 5 | `trace --check --module mNN` | 1 |
| 6 | `verify:exercises --module mNN` | 2 |
| 7 | `videos:check` (covers every module; it has no module filter) | 5 |
| 8 | `anim:check --static <id>` for each `<Animation id>` the lessons use; skipped when there is none | 4 |
| 9 | all unit tests (`npm test`: `tools/` and `src/`, so §3.6 point 6 is covered in full; it is the slowest of the quick steps, about 1 to 2 minutes, because the verifier fixture tests compile C) | 6 |
| 10 | `npm run build` (skipped by `--fast`) | 6 |
| 11 | `npm run e2e` with `E2E_MODULE=mNN` (skipped by `--fast`) | 6 |
| 12 | platform targets: always `SKIPPED`, the Targets workflow checks them in CI | 7 |

- `--fast` skips build and e2e.
- `--json` prints `{module, fast, ok, steps[{id, point, name, status, reason?, durationMs, tail?, failing?}]}` and nothing else from `dod` on stdout. Use `npm run -s` (silent): plain `npm run dod` makes npm print its banner to stdout before the program starts, which `dod` cannot suppress.
- `anim:check` runs with `--static` (no browser: validation, `hyperframes lint`, manifest freshness). The full browser gate stays in CI.
- Paste the table into the PR description.

Tests: `tools/dod/dod.test.ts` uses the fixture modules in `tools/dod/fixtures/content/` (one plain, one with animations).
