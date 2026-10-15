// Generates (or checks) src/generated/traces/<sampleId>.json for every sample with `trace`.
// Shared by `npm run trace` and `npm run verify` (which traces after verifying).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TraceFile } from '../../src/content-model/types';
import type { DiscoveredSample } from '../verify/discover';
import { ResultCache, environmentFingerprint } from '../verify/cache';
import { sortKeysDeep } from '../shared/stable-json';
import { generateTrace, toolVersions, MAX_STEPS } from './trace';

export interface TraceRunOptions {
  generatedRoot: string;
  cacheDir: string;
  workDir: string;
  /** Compare with the committed files instead of writing them. */
  check?: boolean;
  /** Ignore cached traces. */
  force?: boolean;
  valgrind?: boolean;
  log?: (line: string) => void;
}

export interface TraceRunReport {
  written: string[];
  unchanged: string[];
  stale: string[];
  problems: string[];
  notes: string[];
}

/** Traces are large: compact JSON (sorted keys, one line) keeps the committed files small. */
export const serialiseTrace = (t: TraceFile) => JSON.stringify(sortKeysDeep(t)) + '\n';

export function traceFilePath(generatedRoot: string, id: string): string {
  return path.join(generatedRoot, 'traces', `${id}.json`);
}

export function runTraces(samples: DiscoveredSample[], o: TraceRunOptions): TraceRunReport {
  const report: TraceRunReport = { written: [], unchanged: [], stale: [], problems: [], notes: [] };
  const todo = samples.filter(s => s.meta.trace);
  if (!todo.length) return report;
  const versions = toolVersions();
  const valgrind = o.valgrind ?? process.env.TRACE_VALGRIND === '1';
  const env = environmentFingerprint();
  const cache = new ResultCache<TraceFile>(o.cacheDir, { read: !o.force, write: true });
  mkdirSync(path.join(o.generatedRoot, 'traces'), { recursive: true });
  for (const s of todo) {
    if (s.meta.expect === 'compile-error') { report.problems.push(`${s.id}: a compile-error sample cannot be traced`); continue; }
    const key = ResultCache.key(['trace', s.code, s.meta.stdin ?? '', s.meta.args ?? [], versions.gcc, versions.gdb, valgrind ? versions.valgrind : '', env, MAX_STEPS]);
    let trace = cache.get(key);
    if (!trace) {
      try {
        const t0 = performance.now();
        const r = generateTrace({ id: s.id, code: s.code, stdin: s.meta.stdin, args: s.meta.args }, { workDir: o.workDir, valgrind });
        trace = r.trace;
        report.notes.push(...r.notes);
        o.log?.(`  traced ${s.id}: ${trace.steps.length} steps${trace.truncated ? ' (truncated)' : ''} in ${Math.round(performance.now() - t0)} ms`);
        cache.set(key, trace);
      } catch (err) {
        report.problems.push(`${s.file}:${s.line}: ${(err as Error).message}`);
        continue;
      }
    }
    if (trace.truncated) report.notes.push(`${s.id}: trace truncated at ${MAX_STEPS} steps; shorten the program`);
    const file = traceFilePath(o.generatedRoot, s.id);
    const text = serialiseTrace(trace);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (current === text) { report.unchanged.push(s.id); continue; }
    if (o.check) { report.stale.push(s.id); continue; }
    writeFileSync(file, text);
    report.written.push(s.id);
  }
  return report;
}
