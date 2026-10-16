# `npm run dod`: per-module definition of done

```
npm run dod -- --module m01 [--fast] [--json]
```

Runs the checks of PLAN.md §3.6 for one module **sequentially** and prints one table (`PASS`, `FAIL`, `SKIPPED (reason)`), with the last 15 lines of output for each failure. Exit status: 0 if nothing failed, 1 on any `FAIL`, 2 on a usage error. A failing step does not stop the later ones, so one run lists everything that is wrong.

The steps run one after another on purpose: the checks (browser compiler, e2e) are timing-sensitive on small machines and flake when run in parallel.

| Order | Step | §3.6 point |
|---|---|---|
| 1 | `typecheck` | 6 |
| 2 | `lint:content --strict --module mNN` | 3 |
| 3 | `verify --check --module mNN` | 1 |
| 4 | `trace --check --module mNN` | 1 |
| 5 | `verify:exercises --module mNN` | 2 |
| 6 | `videos:check` (covers every module; it has no module filter) | 5 |
| 7 | `anim:check --static <id>` for each `<Animation id>` the lessons use; skipped when there is none | 4 |
| 8 | unit tests of `tools/` (`npm test -- tools`) | 6 |
| 9 | `npm run build` (skipped by `--fast`) | 6 |
| 10 | `npm run e2e` with `E2E_MODULE=mNN` (skipped by `--fast`) | 6 |
| 11 | platform targets: always `SKIPPED`, the Targets workflow checks them in CI | 7 |

- `--fast` skips build and e2e.
- `--json` prints `{module, fast, ok, steps[{id, point, name, status, reason?, durationMs, tail?}]}` and nothing else on stdout.
- `anim:check` runs with `--static` (no browser: validation, `hyperframes lint`, manifest freshness). The full browser gate stays in CI.
- Paste the table into the PR description.

Tests: `tools/dod/dod.test.ts` uses the fixture modules in `tools/dod/fixtures/content/` (one plain, one with animations).
