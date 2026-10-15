// npm run verify:exercises (PLAN §3.3): every reference solution passes, every starter fails at
// least one test, and every variant is checked the same way.
//   - browser exercises (CT/FB): the browser toolchain in Node (WasmNodeBackend) + src/testing/runner.ts;
//   - Parsons (PA): every accepted ordering compiles and passes; the scrambled starter is not accepted;
//   - native exercises (LT) and projects: the bundled check.mjs, run natively on the unzipped project
//     layout (gcc + ASan here and in CI); the completion token / progress code must verify.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TestsSpec } from '../../src/content-model/types';
import type { ExecBackend } from '../../src/testing/exec';
import { describeResult } from '../../src/testing/format';
import { projectZipEntries } from '../../src/testing/project-zip';
import { runTests, type TestReport, type TestResult } from '../../src/testing/runner';
import { validateTestsSpec } from '../../src/testing/spec';
import { isExerciseId, verifyCode } from '../../src/testing/token';
import { buildCheck, LEARNC_H } from '../check/build.mjs';
import { listFiles, readProjectSource, writeFiles } from '../check/src/project-files';
import { discover, variantDirs, type ExerciseDir, type ProjectDir } from './discover';
import { blockLines, planParsons } from './parsons';
import { validateExerciseMeta, type VerifiedMeta } from './validate';
import { WasmNodeBackend } from './wasm-backend';

/** Seed written into .learner for native runs; the codes check.mjs prints must verify against it. */
export const VERIFY_SEED = '0123456789abcdef';

export interface ItemReport {
  module: string;
  /** "ct-sum-digits", "ct-sum-digits/v1" (a variant) or "caesar" (a project). */
  id: string;
  kind: 'ct' | 'fb' | 'pa' | 'lt' | 'project';
  runsIn: string;
  ok: boolean;
  /** Short facts for the one-line summary, e.g. "solution 5/5", "starter 2/5". */
  summary: string[];
  problems: string[];
  warnings: string[];
  /** With --verbose: why a reference solution failed, check by check. */
  details: string[];
  ms: number;
}

export interface VerifyOptions {
  contentRoot: string;
  module?: string;
  only?: string;
  /** Native compiler for check.mjs (default: check.mjs's own choice: $CC, cc, clang, gcc). */
  cc?: string;
  /** A prebuilt check.mjs; otherwise one is bundled into a temporary folder. */
  checkMjs?: string;
  verbose?: boolean;
  onItem?(item: ItemReport): void;
}

export interface VerifySummary {
  items: ItemReport[];
  ok: boolean;
  ms: number;
}

const AUTHORING_FILES = ['exercise.yaml', 'tests.json', 'starter.c', 'solution.c', 'variants'];

const failing = (r: TestReport) => r.results.filter(x => x.status !== 'pass' && !(x.kind === 'make' && x.status === 'skip'));
const allPass = (r: TestReport) => failing(r).length === 0;
const passedCount = (r: TestReport) => r.results.filter(x => x.status === 'pass' || (x.kind === 'make' && x.status === 'skip')).length;
const names = (rs: TestResult[]) => (rs.length > 3 ? [...rs.slice(0, 3).map(r => r.name), `+${rs.length - 3} more`] : rs.map(r => r.name)).join('; ');

function explain(label: string, r: TestReport): string[] {
  const out: string[] = [];
  for (const res of failing(r)) {
    out.push(`${label}: ✗ ${res.name}`);
    for (const l of describeResult(res, 0)) out.push(`${label}:     ${'    '.repeat(l.indent ?? 0)}${l.mark ? (l.mark === 'pass' ? '✓ ' : '✗ ') : ''}${l.text}`);
  }
  return out;
}

/** Reads and validates tests.json/check.json; harness paths are looked up in `dirs` (variant first). */
function readSpec(file: string, runsIn: 'browser' | 'native', dirs: string[], item: ItemReport): TestsSpec | undefined {
  if (!existsSync(file)) { item.problems.push(`${path.basename(file)} is missing`); return undefined; }
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { item.problems.push(`${path.basename(file)} is not valid JSON: ${(e as Error).message}`); return undefined; }
  const p = validateTestsSpec(raw, { runsIn, exists: f => dirs.some(d => existsSync(path.join(d, f))) });
  item.problems.push(...p.errors.map(e => `${path.basename(file)}: ${e}`));
  item.warnings.push(...p.warnings.map(w => `${path.basename(file)}: ${w}`));
  return p.errors.length ? undefined : (raw as TestsSpec);
}

/** Text files of an exercise folder that tests may need (harnesses, data), minus authoring files. */
function exerciseFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of listFiles(dir, AUTHORING_FILES)) files[f] = readFileSync(path.join(dir, f), 'utf8');
  return files;
}

// ---------------------------------------------------------------- browser exercises

async function verifyBrowserPair(
  item: ItemReport, exec: ExecBackend<unknown>, spec: TestsSpec, learnerFile: string, files: Record<string, string>,
  solution: string, starter: string | undefined, verbose: boolean,
) {
  const sol = await runTests(spec, { [learnerFile]: solution }, files, exec);
  item.summary.push(`solution ${passedCount(sol)}/${sol.total}`);
  if (!allPass(sol)) {
    item.problems.push(`the reference solution fails: ${names(failing(sol))}`);
    if (verbose) item.details.push(...explain('solution', sol));
  }
  if (starter === undefined) return;
  const st = await runTests(spec, { [learnerFile]: starter }, files, exec);
  item.summary.push(`starter ${passedCount(st)}/${st.total}`);
  if (allPass(st)) item.problems.push('the starter passes every test (it must fail at least one: are the tests strong enough?)');
}

async function verifyParsons(item: ItemReport, exec: ExecBackend<unknown>, spec: TestsSpec, meta: VerifiedMeta, dir: string, files: Record<string, string>, verbose: boolean) {
  const learnerFile = meta.file ?? spec.sources[0];
  const solution = readFileSync(path.join(dir, 'solution.c'), 'utf8');
  const starterPath = path.join(dir, 'starter.c');
  const starter = existsSync(starterPath) ? readFileSync(starterPath, 'utf8') : undefined;
  const plan = planParsons(solution, meta.parsons?.accepted, meta.parsons?.distractors, starter);
  item.problems.push(...plan.errors);
  for (const p of plan.programs) {
    const r = await runTests(spec, { [learnerFile]: p.code }, files, exec);
    if (!allPass(r)) {
      item.problems.push(`${p.label} fails: ${names(failing(r))}`);
      if (verbose) item.details.push(...explain(p.label, r));
    }
  }
  item.summary.push(`${plan.programs.length} accepted ${plan.programs.length === 1 ? 'ordering' : 'orderings'} pass`, `${blockLines(solution).length} lines`);
  if (starter !== undefined && plan.starterOrder && !plan.errors.length) {
    // An unlisted order that passes would be marked wrong in the app: the author must list it.
    const pool = solution.split('\n').filter(l => l.trim() !== '');
    const code = plan.starterOrder.map(l => pool.splice(pool.findIndex(o => o.trim() === l), 1)[0]).join('\n') + '\n';
    const r = await runTests(spec, { [learnerFile]: code }, files, exec);
    if (allPass(r)) item.problems.push('the scrambled starter.c order passes every test: add it to parsons.accepted, or make the tests stricter');
    else item.summary.push('starter scramble is rejected');
  } else if (starter === undefined) item.summary.push('no starter.c (the app scrambles)');
}

// ---------------------------------------------------------------- native exercises and projects

interface NativeRun { allPassed: boolean; passed: number; total: number; progressCode?: string; completionToken?: string; results: TestResult[] }

function runCheckMjs(dir: string, cc: string | undefined): NativeRun | string {
  const r = spawnSync(process.execPath, ['check.mjs', '--json', ...(cc ? ['--cc', cc] : [])], { cwd: dir, encoding: 'utf8', timeout: 600_000 });
  try {
    return JSON.parse(r.stdout) as NativeRun;
  } catch {
    return `check.mjs did not produce a report (exit ${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`;
  }
}

async function verifyNative(item: ItemReport, dir: string, o: { exerciseVariant?: string; cc?: string; checkMjs: string; verbose: boolean }) {
  const checkText = readFileSync(o.checkMjs, 'utf8');
  const learncH = readFileSync(LEARNC_H, 'utf8');
  for (const variant of ['solution', 'starter'] as const) {
    let src;
    try { src = readProjectSource(dir, { variant, exerciseVariant: o.exerciseVariant }); } catch (e) { item.problems.push((e as Error).message); return; }
    if (!isExerciseId(src.id)) { item.problems.push(`id "${src.id}" cannot appear in progress codes (use lowercase letters, digits, "-", "_", ".")`); return; }
    const work = mkdtempSync(path.join(tmpdir(), `verify-${src.id}-`));
    try {
      writeFiles(work, projectZipEntries({
        id: src.id, title: src.title, spec: src.spec, files: src.files, checkMjs: checkText, learncH,
        learner: { version: 1, seed: VERIFY_SEED, exercise: src.id },
      }));
      const r = runCheckMjs(work, o.cc);
      if (typeof r === 'string') { item.problems.push(`${variant}: ${r}`); continue; }
      item.summary.push(`${variant} ${r.passed}/${r.total}`);
      if (variant === 'solution') {
        if (!r.allPassed) {
          item.problems.push(`the reference solution fails natively: ${names(r.results.filter(x => x.status !== 'pass'))}`);
          if (o.verbose) item.details.push(...explain('solution', { results: r.results } as TestReport));
        } else if (!r.completionToken || !(await verifyCode(r.completionToken, VERIFY_SEED, { exercise: src.id })).ok) {
          item.problems.push(`the completion token check.mjs printed does not verify: ${r.completionToken ?? '(none)'}`);
        } else item.summary.push('token verified');
      } else {
        if (r.allPassed) item.problems.push('the starter passes every check natively (it must fail at least one)');
        if (!r.progressCode || !(await verifyCode(r.progressCode, VERIFY_SEED, { exercise: src.id })).ok) {
          item.problems.push(`the progress code check.mjs printed does not verify: ${r.progressCode ?? '(none)'}`);
        }
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------- per item

function newItem(module: string, id: string, kind: ItemReport['kind'], runsIn: string): ItemReport {
  return { module, id, kind, runsIn, ok: false, summary: [], problems: [], warnings: [], details: [], ms: 0 };
}

async function verifyExercise(ex: ExerciseDir, ctx: Ctx): Promise<ItemReport[]> {
  const t0 = performance.now();
  const item = newItem(ex.module.id, ex.id, 'ct', '?');
  const reports = [item];
  const finish = () => {
    for (const r of reports) r.ok = r.problems.length === 0;
    if (!item.ms) item.ms = performance.now() - t0;
    return reports;
  };

  let raw: unknown;
  try { raw = parseYaml(readFileSync(path.join(ex.dir, 'exercise.yaml'), 'utf8')); } catch (e) { item.problems.push(`exercise.yaml: ${(e as Error).message}`); return finish(); }
  const v = validateExerciseMeta(raw, ex.id);
  item.problems.push(...v.errors.map(e => `exercise.yaml: ${e}`));
  item.warnings.push(...v.warnings.map(w => `exercise.yaml: ${w}`));
  if (!v.meta) return finish();
  const meta = v.meta;
  item.kind = meta.kind;
  item.runsIn = meta.runsIn;
  if (!isExerciseId(meta.id)) item.problems.push(`exercise.yaml: id "${meta.id}" must be lowercase letters, digits, "-", "_" or "."`);

  const existing = variantDirs(ex.dir);
  for (const name of meta.variants) if (!existing.includes(name)) item.problems.push(`variant "${name}" is listed but variants/${name}/ does not exist`);
  for (const name of existing) if (!meta.variants.includes(name)) item.warnings.push(`variants/${name}/ exists but is not listed in exercise.yaml`);

  const spec = readSpec(path.join(ex.dir, 'tests.json'), meta.runsIn, [ex.dir], item);
  if (!spec) return finish();
  const learnerFile = meta.file ?? (meta.runsIn === 'browser' ? 'main.c' : spec.sources[0]);
  if (!spec.sources.includes(learnerFile)) item.problems.push(`tests.json "sources" must include the learner's file ${learnerFile}`);
  const need = (f: string) => { if (!existsSync(path.join(ex.dir, f))) item.problems.push(`${f} is missing`); };
  need('solution.c');
  if (meta.kind !== 'pa') need('starter.c');
  if (item.problems.length) return finish();

  if (meta.runsIn === 'native') {
    await verifyNative(item, ex.dir, { cc: ctx.cc, checkMjs: await ctx.checkMjs(), verbose: ctx.verbose });
  } else if (meta.kind === 'pa') {
    await verifyParsons(item, ctx.wasm(), spec, meta, ex.dir, exerciseFiles(ex.dir), ctx.verbose);
  } else {
    await verifyBrowserPair(item, ctx.wasm(), spec, learnerFile, exerciseFiles(ex.dir), readFileSync(path.join(ex.dir, 'solution.c'), 'utf8'),
      readFileSync(path.join(ex.dir, 'starter.c'), 'utf8'), ctx.verbose);
  }
  item.ms = performance.now() - t0;

  // Variants: same checks; a variant may override starter.c, solution.c and tests.json.
  for (const name of meta.variants.filter(n => existing.includes(n))) {
    const t1 = performance.now();
    const vdir = path.join(ex.dir, 'variants', name);
    const vi = newItem(ex.module.id, `${ex.id}/${name}`, meta.kind, meta.runsIn);
    reports.push(vi);
    const vspec = existsSync(path.join(vdir, 'tests.json')) ? readSpec(path.join(vdir, 'tests.json'), meta.runsIn, [vdir, ex.dir], vi) : spec;
    if (!vspec) continue;
    if (!existsSync(path.join(vdir, 'solution.c'))) { vi.problems.push(`variants/${name}/solution.c is missing`); continue; }
    if (meta.kind !== 'pa' && !existsSync(path.join(vdir, 'starter.c'))) { vi.problems.push(`variants/${name}/starter.c is missing`); continue; }
    if (meta.runsIn === 'native') {
      await verifyNative(vi, ex.dir, { exerciseVariant: name, cc: ctx.cc, checkMjs: await ctx.checkMjs(), verbose: ctx.verbose });
    } else {
      const files = { ...exerciseFiles(ex.dir), ...exerciseFiles(vdir) };
      const vstarter = existsSync(path.join(vdir, 'starter.c')) ? readFileSync(path.join(vdir, 'starter.c'), 'utf8') : undefined;
      await verifyBrowserPair(vi, ctx.wasm(), vspec, learnerFile, files, readFileSync(path.join(vdir, 'solution.c'), 'utf8'), vstarter, ctx.verbose);
    }
    vi.ms = performance.now() - t1;
  }
  return finish();
}

async function verifyProject(pr: ProjectDir, ctx: Ctx): Promise<ItemReport> {
  const t0 = performance.now();
  const runsIn = pr.module.projectRunsIn ?? 'native';
  const item = newItem(pr.module.id, pr.id, 'project', runsIn === 'both' ? 'browser+native' : runsIn);
  const spec = readSpec(path.join(pr.dir, 'check.json'), runsIn === 'browser' ? 'browser' : 'native', [pr.dir, path.join(pr.dir, 'solution')], item);
  for (const d of ['starter', 'solution']) if (!existsSync(path.join(pr.dir, d))) item.problems.push(`${d}/ is missing`);
  if (spec && !item.problems.length) {
    // Projects always ship as zips with check.mjs, so they are always verified natively.
    await verifyNative(item, pr.dir, { cc: ctx.cc, checkMjs: await ctx.checkMjs(), verbose: ctx.verbose });
    if (runsIn === 'browser' || runsIn === 'both') {
      const sol = readProjectSource(pr.dir, { variant: 'solution' });
      const st = readProjectSource(pr.dir, { variant: 'starter' });
      const others = (src: typeof sol) => Object.fromEntries(Object.entries(src.files).filter(([f]) => !src.learnerFiles.includes(f)));
      const pick = (src: typeof sol) => Object.fromEntries(src.learnerFiles.map(f => [f, src.files[f]]));
      const before = item.summary.length;
      const r1 = await runTests(spec, pick(sol), others(sol), ctx.wasm());
      const r2 = await runTests(spec, pick(st), others(st), ctx.wasm());
      item.summary.splice(before, 0, `browser: solution ${passedCount(r1)}/${r1.total}, starter ${passedCount(r2)}/${r2.total}`);
      if (!allPass(r1)) { item.problems.push(`the reference solution fails in the browser toolchain: ${names(failing(r1))}`); if (ctx.verbose) item.details.push(...explain('browser solution', r1)); }
      if (allPass(r2)) item.problems.push('the starter passes every test in the browser toolchain');
    }
  }
  item.ok = item.problems.length === 0;
  item.ms = performance.now() - t0;
  return item;
}

interface Ctx {
  cc?: string;
  verbose: boolean;
  wasm(): WasmNodeBackend;
  checkMjs(): Promise<string>;
}

/** Verifies everything under the content root; calls onItem as each item finishes. */
export async function verifyAll(o: VerifyOptions): Promise<VerifySummary> {
  const t0 = performance.now();
  const found = discover(o.contentRoot, { module: o.module, only: o.only });
  let wasm: WasmNodeBackend | undefined;
  let built: Promise<string> | undefined;
  let tmp: string | undefined;
  const ctx: Ctx = {
    cc: o.cc,
    verbose: !!o.verbose,
    wasm: () => (wasm ??= new WasmNodeBackend()),
    checkMjs: () => (built ??= o.checkMjs
      ? Promise.resolve(o.checkMjs)
      : (async () => { tmp = mkdtempSync(path.join(tmpdir(), 'verify-check-')); return (await buildCheck({ outfile: path.join(tmp, 'check.mjs') })).outfile; })()),
  };
  const items: ItemReport[] = [];
  try {
    for (const ex of found.exercises) for (const r of await verifyExercise(ex, ctx)) { items.push(r); o.onItem?.(r); }
    for (const pr of found.projects) { const r = await verifyProject(pr, ctx); items.push(r); o.onItem?.(r); }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  return { items, ok: items.every(i => i.ok), ms: performance.now() - t0 };
}
