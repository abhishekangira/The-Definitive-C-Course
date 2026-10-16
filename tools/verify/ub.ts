// Canonical, deterministic form of `expect=ub` runs (PLAN §3.4, AGENTS.md "UB appears in a prediction only when
// UB is the lesson"). The raw output of an undefined-behaviour program (stack garbage, ASLR) differs on every run,
// so committing it makes src/generated/ churn and puts garbage into data the app can read. What is stored instead
// is what the lesson may ask about: the set of outcome categories seen. (The number of distinct values is NOT
// stored: it varies between invocations, e.g. an uninitialised local that held the same value in 3 runs one time and
// 2 distinct values the next, so storing it would keep the files changing.)
import type { RunOutcome, UbSummary } from '../../src/content-model/types';
import { runOutcome } from './checks';

/** Run identity without the output: runs that only differ in garbage share a category. */
const category = (r: RunOutcome) => JSON.stringify([runOutcome(r), r.exit, r.signal ?? null, r.trap ?? null, r.timedOut ?? false]);

export interface CanonicalUb {
  /** The representative run: the first category in sorted order, with empty output. */
  run: RunOutcome;
  /** One output-free entry per outcome category, sorted, so the order of the runs never matters. */
  observed: RunOutcome[];
  ub: UbSummary;
}

/** Reduces the repeated runs of an expect=ub sample to its canonical form. Needs at least one run. */
export function canonicalUb(runs: RunOutcome[]): CanonicalUb {
  const byCategory = new Map<string, RunOutcome>();
  for (const r of runs) if (!byCategory.has(category(r))) byCategory.set(category(r), r);
  const observed = [...byCategory.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, r]): RunOutcome => {
      const out: RunOutcome = { stdout: '', stderr: '', exit: r.exit };
      if (r.signal != null) out.signal = r.signal;
      if (r.trap != null) out.trap = r.trap;
      if (r.timedOut) out.timedOut = true;
      return out;
    });
  const outcomes = [...new Set(runs.map(runOutcome))].sort();
  return { run: observed[0], observed, ub: { runs: runs.length, outcomes } };
}
