# 0002: Playwright e2e runs on 2 workers in CI and 3 locally

Status: Accepted (2026-10-18, PR #46)

## Context
`workers: 1` was set in the first harness commit (178daf8) with no comment, and issue #28 did not change it. `fullyParallel` stays false because `test.describe.serial` groups share one page, so workers only run spec files side by side.

## Decision
`playwright.config.ts` sets `workers: process.env.CI ? 2 : 3`. `npm run e2e:stress` passes no `--workers`, so it uses the same count.

## Evidence
CI, on ubuntu-24.04 (`nproc=4`, about 16 GB; load average was not logged):
- A same-day bench had 2 workers at about 1.6 min (3 runs, 95–98 s, run 39053711079) and 4 workers at about 1.5–1.6 min (3 runs, 39053714847), then about 1.7–1.8 min (10 runs, 39058531615). 4 was not clearly faster.
- A later 2-worker bench was about 2.1–2.2 min, 10/10 clean, 0 retries (39066202287). The check on that commit was `68 passed (2.2m)` with 0 flakes (39066183837, e2e step 135 s).
- Of 16 suite runs at 4 workers, 14 were clean and 2 were flaky: `toolchain-download.spec.ts` test 2 (truncated download) hung to the 10 min timeout and passed on retry (39061303176 at 11.2 min, 39063039817 at 11.9 min). The review saw that test fail about 1/30 at 1 worker (a different assertion); the cause was not found then (issue #58 later found two app causes; fixed in PR #67).
- The first 2-worker bench had 2 animation still-load flakes in 3 runs; a later repeat of that spec did not show a worker-count effect (review: 1/100 at 2 workers, 0/100 at 1 and at 4).
- One worker was about 2.5 min on `main` (149 s, run 39030536834, 1 animation flake) and about 3.0 min on the bench (39053707416).

Locally, on a shared 8-CPU machine, 4, 3 and 2 workers each passed 3/3 with retries off. 4 was heavy (load about 7 of 8, CPU about 85%) while 3 stayed around 65% CPU. `min(4, cores/2)` is 4 on 8 CPUs, so it is not a lighter local default here.

## Consequences
- CI uses 2 because a clean 4-worker run is only a little faster and 2 of those 16 runs cost about 11 min.
- No run failed with the CPU-time limit message; headroom under the 5 s watchdog was not measured. Bench again before changing either number.
