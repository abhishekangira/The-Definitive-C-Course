// Orchestrates `npm run verify` (PLAN §3.1–§3.4): discover → compile/run on every target (cached)
// → check → write src/generated/samples/<module>.json (+ traces), or compare with it (--check).
// Also implements `--target-run`, which records one native target's outputs on a CI runner.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import type { SampleResult, SamplesFile, TargetId, TargetResult } from '../../src/content-model/types';
import { sortKeysDeep, stableStringify } from '../shared/stable-json';
import { sampleHash } from '../shared/sample-hash';
import { ResultCache, cacheRuns, environmentFingerprint } from './cache';
import { checkSample } from './checks';
import { discover, type DiscoveredFragment, type DiscoveredSample } from './discover';
import { resolveToolchain, type NativeToolchain } from './native';
import { runSample } from './run';
import { mapLimit } from './proc';
import { NATIVE_TARGETS, STORED_TARGETS, type SampleRuns, type TargetsFile, type VerifiedSample } from './types';
import { WasmTarget } from './wasm';
import { runTraces } from '../trace/run-traces';

export interface VerifyOptions {
  contentRoot: string;
  generatedRoot: string;
  cacheDir: string;
  module?: string;
  /** Verify only this sample id (nothing is written). */
  only?: string;
  force?: boolean;
  check?: boolean;
  /** Generate stepper traces for `trace` samples (default true). */
  trace?: boolean;
  log?: (line: string) => void;
}

export interface SampleReport {
  sample: DiscoveredSample;
  result: VerifiedSample;
  problems: string[];
  notes: string[];
  cached: boolean;
}

export interface VerifyReport {
  problems: string[];
  notes: string[];
  samples: SampleReport[];
  fragments: { checked: number; partial: DiscoveredFragment[]; warnings: string[] };
  files: { written: string[]; unchanged: string[]; stale: string[] };
  /** module id → generated file text (also when --check or --only, for tests). */
  outputs: Record<string, string>;
}

/** Per-process scratch space (build dirs, probes); removed when the process exits. */
let scratchPath: string | null = null;
function scratchDir(): string {
  if (!scratchPath) {
    const d = (scratchPath = path.join(tmpdir(), `tdcc-verify-${process.pid}`));
    process.once('exit', () => rmSync(d, { recursive: true, force: true }));
  }
  mkdirSync(scratchPath, { recursive: true });
  return scratchPath;
}

/** Removes the scratch space now (for hosts like test runners that skip process 'exit'). */
export function cleanupScratch(): void {
  if (scratchPath) rmSync(scratchPath, { recursive: true, force: true });
}

// ---------- fragments ----------

const FRAGMENT_PRELUDE = ['stdio.h', 'stdlib.h', 'string.h', 'stdint.h', 'stdbool.h', 'stddef.h', 'limits.h', 'ctype.h', 'math.h']
  .map(h => `#include <${h}>`).join('\n') + '\n';

/**
 * Fragments are syntax-checked with gcc, first at file scope and then inside a function body
 * (for statement snippets). Errors fail; warnings are only reported.
 */
export function checkFragment(code: string, gcc = 'gcc'): { ok: boolean; diagnostics: string } {
  const attempt = (src: string) => {
    const r = spawnSync(gcc, ['-fsyntax-only', '-std=c17', '-Wall', '-Wextra', '-pedantic', '-fdiagnostics-color=never', '-x', 'c', '-'], { input: src, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    return { ok: r.status === 0, diagnostics: (r.stderr ?? '').replace(/^<stdin>: /gm, '') };
  };
  const fileScope = attempt(`${FRAGMENT_PRELUDE}#line 1 "fragment.c"\n${code}`);
  if (fileScope.ok) return fileScope;
  const inFunction = attempt(`${FRAGMENT_PRELUDE}void tdcc_fragment(void) {\n#line 1 "fragment.c"\n${code}\n}\n`);
  if (inFunction.ok) return inFunction;
  // Report whichever reading the fragment was closer to (fewer errors).
  const errors = (d: string) => (d.match(/: error: /g) ?? []).length;
  return errors(inFunction.diagnostics) < errors(fileScope.diagnostics) ? inFunction : fileScope;
}

// ---------- stored targets ----------

export function readTargetsFile(generatedRoot: string, target: TargetId, module: string): TargetsFile | null {
  const f = path.join(generatedRoot, 'targets', target, `${module}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as TargetsFile) : null;
}

// ---------- --check projection ----------

/** A copy without the version strings (provenance, not behaviour: apt.llvm.org clang carries a build timestamp). */
export function withoutVersions(file: SamplesFile): SamplesFile {
  const clone = JSON.parse(JSON.stringify(file)) as SamplesFile;
  clone.generatedBy = '<version>';
  for (const s of Object.values(clone.samples)) for (const t of Object.values(s.results) as TargetResult[]) t.compiler = '<version>';
  return clone;
}

/**
 * What --check compares: behaviour only, so `generatedBy` and each target's `compiler` string are
 * ignored (kept in the files as provenance). Undefined-behaviour runs legitimately differ between runs (garbage values,
 * ASLR), and display rebasing can regroup addresses, so those parts are reduced to what is stable.
 */
export function checkProjection(file: SamplesFile): unknown {
  const clone = withoutVersions(file);
  for (const s of Object.values(clone.samples)) {
    const ub = s.meta.expect === 'ub';
    for (const t of Object.values(s.results) as TargetResult[]) {
      for (const r of [t.run, t.guardrail, ...(t.observed ?? []), (t as { runPipe?: TargetResult['run'] }).runPipe]) {
        if (!r) continue;
        delete r.stdoutDisplay;
        if (ub) { r.stdout = '<ub>'; r.stderr = '<ub>'; if (r.signal === null) delete r.signal; }
      }
      // Committed files written before the canonical form (tools/verify/ub.ts) hold raw garbage in `observed` and
      // have no `ub` summary; both are compared only once the files are regenerated (see the PR for #5).
      if (ub) { delete t.observed; delete t.ub; }
    }
    if (ub) {
      s.answer.stdout = '<ub>';
      if (s.answer.native) s.answer.native.stdout = '<ub>';
      delete s.diffs;
    }
  }
  return sortKeysDeep(clone); // key order must not matter (in-memory vs. parsed file)
}

// ---------- verify ----------

export async function verify(o: VerifyOptions): Promise<VerifyReport> {
  const log = o.log ?? (() => {});
  const report: VerifyReport = { problems: [], notes: [], samples: [], fragments: { checked: 0, partial: [], warnings: [] }, files: { written: [], unchanged: [], stale: [] }, outputs: {} };
  const found = discover({ contentRoot: o.contentRoot, module: o.module });
  report.problems.push(...found.errors);
  if (o.module && !found.modules.includes(o.module)) report.problems.push(`module ${o.module} not found under ${o.contentRoot}`);
  const samples = o.only ? found.samples.filter(s => s.id === o.only) : found.samples;
  if (o.only && !samples.length) report.problems.push(`sample ${o.only} not found`);

  const scratch = scratchDir();
  const toolchains: NativeToolchain[] = NATIVE_TARGETS.map(t => resolveToolchain(t, scratch));
  for (const tc of toolchains) if (tc.warning) report.notes.push(`WARNING: ${tc.warning}`);
  const wasm = new WasmTarget();
  const versions = { ...Object.fromEntries(toolchains.map(t => [t.target, t.version])), wasm: wasm.version };
  const generatedBy = `tools/verify; gcc: ${toolchains[0].version}; clang22: ${toolchains[1].version}; wasm: ${wasm.version}`;
  const env = environmentFingerprint();
  const cache = new ResultCache<SampleRuns>(o.cacheDir, { read: !o.force, write: true });
  log(`verify: ${samples.length} sample(s) · ${toolchains.map(t => t.version).join(' · ')} · ${wasm.version}`);

  const modules = [...new Set(o.only ? samples.map(s => s.module) : found.modules.filter(m => !o.module || m === o.module))];
  const storedByModule = new Map<string, Map<TargetId, TargetsFile>>();
  for (const m of modules) {
    const map = new Map<TargetId, TargetsFile>();
    for (const t of STORED_TARGETS) { const f = readTargetsFile(o.generatedRoot, t, m); if (f) map.set(t, f); }
    storedByModule.set(m, map);
  }

  try {
    // Samples overlap: native compiles/runs are child processes, so they run while the wasm
    // compiler (single-threaded, in this process) works on another sample.
    const reports = await mapLimit(samples, Math.max(1, Math.min(4, cpus().length)), async (s): Promise<SampleReport> => {
      const key = ResultCache.key(['sample', s.code, s.metaString, s.meta, s.ext, versions, env]);
      let runs = cache.get(key);
      const cached = !!runs;
      if (!runs) {
        const t0 = performance.now();
        runs = await runSample(s, { native: toolchains, wasm, tmpRoot: path.join(scratch, 'runs') });
        log(`  ran ${s.id} in ${Math.round(performance.now() - t0)} ms`);
        cacheRuns(cache, key, runs);
      }
      const hash = sampleHash({ code: s.code, stdin: s.meta.stdin, args: s.meta.args, guardrail: s.meta.guardrail });
      const stored: Array<{ target: TargetId; result: TargetResult }> = [];
      const notes = [...runs.notes];
      for (const [target, file] of storedByModule.get(s.module) ?? []) {
        const entry = file.samples[s.id];
        if (!entry) continue;
        if (entry.hash !== hash) notes.push(`stored ${target} output is stale (code changed); rerun the targets workflow`);
        else stored.push({ target, result: entry.result });
      }
      const c = checkSample({ id: s.id, code: s.code, meta: s.meta, ext: s.ext, results: runs.results, stored });
      // Flagged samples carry the stored macOS / Linux arm / Windows results too, so the app can show the
      // learner's own platform next to the browser result (other samples never show a native panel).
      const results = { ...runs.results };
      if (c.flagged) for (const st of stored) results[st.target] = st.result;
      const result: VerifiedSample = {
        id: s.id, module: s.module, lesson: s.lesson, code: s.code, meta: s.meta, hash,
        results, flagged: c.flagged, answer: c.answer,
      };
      if (c.diffs.length) result.diffs = c.diffs;
      return { sample: s, result, problems: [...runs.errors, ...c.problems], notes: [...notes, ...c.notes], cached };
    });
    report.samples.push(...reports);
  } finally {
    await wasm.close();
  }

  // Fragments (syntax only, gcc).
  for (const f of found.fragments) {
    if (o.only) break;
    if (f.partial) { report.fragments.partial.push(f); continue; }
    report.fragments.checked++;
    const r = checkFragment(f.code);
    if (!r.ok) report.problems.push(`${f.file}:${f.line}: fragment does not compile (-fsyntax-only); fix it or mark it fragment=partial\n${r.diagnostics.trimEnd().replace(/^/gm, '  ')}`);
    else if (r.diagnostics.trim()) report.fragments.warnings.push(`${f.file}:${f.line}: ${r.diagnostics.trim()}`);
  }

  for (const sr of report.samples) report.problems.push(...sr.problems.map(p => `${sr.sample.file}:${sr.sample.line} [${sr.sample.id}] ${p}`));

  // Generated files.
  const outDir = path.join(o.generatedRoot, 'samples');
  for (const m of modules) {
    const file: SamplesFile = { module: m, generatedBy, samples: {} };
    for (const sr of report.samples) if (sr.sample.module === m) file.samples[sr.sample.id] = sr.result as SampleResult;
    const text = stableStringify(file);
    report.outputs[m] = text;
    if (o.only) continue;
    const target = path.join(outDir, `${m}.json`);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === text) { report.files.unchanged.push(target); continue; }
    // Same behaviour (only version strings, UB garbage or display text differ): keep the committed file,
    // so a toolchain change or a rerun alone never dirties src/generated/ (CI would otherwise commit noise).
    const same = current !== null && JSON.stringify(checkProjection(JSON.parse(current))) === JSON.stringify(checkProjection(file));
    if (same) { report.files.unchanged.push(target); continue; }
    if (o.check) {
      report.files.stale.push(target);
      const changed = current === null ? ['(file missing)'] : diffSampleIds(JSON.parse(current) as SamplesFile, file);
      report.problems.push(`${path.relative(process.cwd(), target)} is stale; run npm run verify and commit. Changed: ${changed.join(', ')}`);
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(target, text);
    report.files.written.push(target);
  }

  // Traces.
  if (o.trace !== false && !o.only) {
    const tr = runTraces(samples, { generatedRoot: o.generatedRoot, cacheDir: path.join(o.cacheDir, 'traces'), workDir: path.join(scratch, 'traces'), check: o.check, force: o.force, log });
    report.problems.push(...tr.problems);
    report.notes.push(...tr.notes);
    for (const id of tr.stale) report.problems.push(`traces/${id}.json is stale; run npm run verify (or npm run trace) and commit`);
    report.files.written.push(...tr.written.map(id => path.join(o.generatedRoot, 'traces', `${id}.json`)));
  }
  return report;
}

function diffSampleIds(a: SamplesFile, b: SamplesFile): string[] {
  const ids = new Set([...Object.keys(a.samples ?? {}), ...Object.keys(b.samples)]);
  const pa = checkProjection(a) as SamplesFile;
  const pb = checkProjection(b) as SamplesFile;
  const out = [...ids].filter(id => JSON.stringify(pa.samples?.[id]) !== JSON.stringify(pb.samples[id])).sort();
  return out.length ? out : ['(formatting)'];
}

// ---------- --target-run ----------

export interface TargetRunOptions {
  target: TargetId;
  outDir: string;
  contentRoot: string;
  cacheDir: string;
  module?: string;
  force?: boolean;
  log?: (line: string) => void;
}

/** Which samples a stored target runs (PLAN §3.2 table). */
export function targetRunsSample(target: TargetId, s: DiscoveredSample): boolean {
  if (target === 'windows-x64-msvc') return !!s.meta.platform && !s.meta.posix;
  return true;
}

export async function targetRun(o: TargetRunOptions): Promise<{ problems: string[]; written: string[] }> {
  const log = o.log ?? (() => {});
  const found = discover({ contentRoot: o.contentRoot, module: o.module });
  const problems = [...found.errors];
  const scratch = scratchDir();
  const tc = resolveToolchain(o.target, scratch);
  if (tc.warning) log(`WARNING: ${tc.warning}`);
  const env = environmentFingerprint();
  const cache = new ResultCache<SampleRuns>(o.cacheDir, { read: !o.force, write: true });
  const written: string[] = [];
  const modules = found.modules.filter(m => !o.module || m === o.module);
  mkdirSync(o.outDir, { recursive: true });
  for (const m of modules) {
    const file: TargetsFile = { module: m, target: o.target, generatedBy: `tools/verify --target-run; ${tc.version}`, samples: {} };
    const todo = found.samples.filter(x => x.module === m && targetRunsSample(o.target, x));
    const all = await mapLimit(todo, Math.max(1, Math.min(4, cpus().length)), async s => {
      const key = ResultCache.key(['target-run', o.target, tc.version, s.code, s.metaString, s.meta, env]);
      let runs = cache.get(key);
      if (!runs) {
        runs = await runSample(s, { native: [tc], wasm: null, tmpRoot: path.join(scratch, 'runs'), noSanitizer: true, noWerror: true });
        cacheRuns(cache, key, runs);
      }
      return { s, runs };
    });
    for (const { s, runs } of all) {
      problems.push(...runs.errors.map(e => `${s.id}: ${e}`));
      const result = runs.results[o.target];
      if (!result) continue;
      const warnings = result.compile.diagnostics.filter(d => d.severity === 'warning');
      if (warnings.length) log(`  note: ${s.id}: ${o.target} warns: ${warnings.map(d => `${d.line}: ${d.message}`).join('; ')}`);
      file.samples[s.id] = { hash: sampleHash({ code: s.code, stdin: s.meta.stdin, args: s.meta.args, guardrail: s.meta.guardrail }), result };
    }
    const target = path.join(o.outDir, `${m}.json`);
    writeFileSync(target, stableStringify(file));
    written.push(target);
    log(`wrote ${target} (${Object.keys(file.samples).length} samples)`);
  }
  return { problems, written };
}
