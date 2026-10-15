// npm run verify:exercises (PLAN §3.3): every reference solution passes, every starter fails at
// least one test, and every variant is checked the same way.
//   - browser exercises (CT/FB): the browser toolchain in Node (WasmNodeBackend) + src/testing/runner.ts,
//     fed exactly the files the app gives the browser runner (see browserSupportFiles);
//   - Parsons (PA): every accepted ordering compiles and passes; the scrambled starter is not accepted;
//   - native exercises (LT) and projects: the bundled check.mjs, run natively on the unzipped project
//     layout (gcc + ASan here and in CI); the completion token / progress code must verify.
//
// Folder model, the same as the app's (src/content-runtime/course.ts):
//   exercises/<id>/                 exercise.yaml, starter.c, solution.c, tests.json, tests/…
//   exercises/<id>/variants/<n>/    a folder of its own: its own exercise.yaml, tests.json, files. It does
//                                   NOT inherit anything from its parent (the app loads it alone).
//   project/<id>/                   exercise.yaml, check.json, Makefile, README.md, tests/, starter/, solution/
// Their ids are "<id>", "<id>/variants/<n>" and "project/<id>"; exercise.yaml must declare exactly that.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TestsSpec } from '../../src/content-model/types';
import type { ExecBackend } from '../../src/testing/exec';
import { describeResult } from '../../src/testing/format';
import { projectZipEntries, zipFolderName } from '../../src/testing/project-zip';
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
  /** The exercise id the app uses: "cash", "cash/variants/1", "project/mario-more". */
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

const failing = (r: TestReport) => r.results.filter(x => x.status !== 'pass' && !(x.kind === 'make' && x.status === 'skip'));
const allPass = (r: TestReport) => failing(r).length === 0;
const passedCount = (r: TestReport) => r.results.filter(x => x.status === 'pass' || (x.kind === 'make' && x.status === 'skip')).length;
const names = (rs: TestResult[]) => (rs.length > 3 ? [...rs.slice(0, 3).map(r => r.name), `+${rs.length - 3} more`] : rs.map(r => r.name)).join('; ');
const text = (p: string) => readFileSync(p, 'utf8');

function explain(label: string, r: TestReport): string[] {
  const out: string[] = [];
  for (const res of failing(r)) {
    out.push(`${label}: ✗ ${res.name}`);
    for (const l of describeResult(res, 0)) out.push(`${label}:     ${'    '.repeat(l.indent ?? 0)}${l.mark ? (l.mark === 'pass' ? '✓ ' : '✗ ') : ''}${l.text}`);
  }
  return out;
}

/** Reads and validates tests.json/check.json; harness paths are looked up in `dirs`. */
function readSpec(file: string, runsIn: 'browser' | 'native', dirs: string[], item: ItemReport): TestsSpec | undefined {
  if (!existsSync(file)) { item.problems.push(`${path.basename(file)} is missing`); return undefined; }
  let raw: unknown;
  try { raw = JSON.parse(text(file)); } catch (e) { item.problems.push(`${path.basename(file)} is not valid JSON: ${(e as Error).message}`); return undefined; }
  const p = validateTestsSpec(raw, { runsIn, exists: f => dirs.some(d => existsSync(path.join(d, f))) });
  item.problems.push(...p.errors.map(e => `${path.basename(file)}: ${e}`));
  item.warnings.push(...p.warnings.map(w => `${path.basename(file)}: ${w}`));
  return p.errors.length ? undefined : (raw as TestsSpec);
}

/**
 * The files the app hands the browser runner besides the learner's file (src/interactions/Exercise.tsx:
 * isSupportFile(k) || k.startsWith('tests/'), where isSupportFile = a .c/.h that is not starter/solution
 * and not under tests/). Mirrored here so "the solution passes" means it passes in the app: a helper
 * the author forgot to put where the app looks for it fails here too. variants/ is never included:
 * the app loads a variant's folder on its own.
 */
export function browserSupportFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of listFiles(dir, ['variants'])) {
    const support = (/\.(c|h)$/.test(f) && !/^(starter|solution)(\.c$|\/)/.test(f)) || f.startsWith('tests/');
    if (support) files[f] = text(path.join(dir, f));
  }
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

async function verifyParsons(
  item: ItemReport, exec: ExecBackend<unknown>, spec: TestsSpec, meta: VerifiedMeta, learnerFile: string, dir: string,
  files: Record<string, string>, verbose: boolean,
) {
  const solution = text(path.join(dir, 'solution.c'));
  const starterPath = path.join(dir, 'starter.c');
  const starter = existsSync(starterPath) ? text(starterPath) : undefined;
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
    if (allPass(r)) item.problems.push('the scrambled starter.c order passes every test: it is already a valid program, so scramble it into a failing order (list valid alternatives in parsons.accepted) or make the tests stricter');
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

/** Zips `dir` the way the app does (starter, then reference solution), runs check.mjs on each, verifies the codes. */
async function verifyNative(item: ItemReport, dir: string, o: { cc?: string; checkMjs: string; verbose: boolean }) {
  const checkText = text(o.checkMjs);
  const learncH = text(LEARNC_H);
  for (const variant of ['solution', 'starter'] as const) {
    let src;
    try { src = readProjectSource(dir, { variant }); } catch (e) { item.problems.push((e as Error).message); return; }
    if (!isExerciseId(src.id)) { item.problems.push(`id "${src.id}" cannot appear in progress codes (use lowercase letters, digits, "-", "_", "." and "/")`); return; }
    const work = mkdtempSync(path.join(tmpdir(), `verify-${zipFolderName(src.id)}-`));
    try {
      writeFiles(work, projectZipEntries({
        id: zipFolderName(src.id), title: src.title, prompt: src.prompt, spec: src.spec, files: src.files, checkMjs: checkText, learncH,
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

// ---------------------------------------------------------------- one folder: exercise, variant or project

function newItem(module: string, id: string, kind: ItemReport['kind'], runsIn: string): ItemReport {
  return { module, id, kind, runsIn, ok: false, summary: [], problems: [], warnings: [], details: [], ms: 0 };
}

interface Unit {
  dir: string;
  /** The id exercise.yaml must declare. */
  id: string;
  /** For a variant: its parent's meta (a variant must run in the same place). */
  parent?: VerifiedMeta;
  /** "tests.json" for exercises and variants, "check.json" for projects. */
  specFile: 'tests.json' | 'check.json';
}

interface Loaded { meta: VerifiedMeta; spec: TestsSpec; learnerFile: string }

/** exercise.yaml + tests file of one folder, validated; problems go to `item`. */
function loadUnit(item: ItemReport, u: Unit): Loaded | undefined {
  const yamlPath = path.join(u.dir, 'exercise.yaml');
  if (!existsSync(yamlPath)) { item.problems.push(`exercise.yaml is missing (the app reads the prompt and the hints from it)`); return undefined; }
  let raw: unknown;
  try { raw = parseYaml(text(yamlPath)); } catch (e) { item.problems.push(`exercise.yaml: ${(e as Error).message}`); return undefined; }
  const v = validateExerciseMeta(raw, u.id, { variant: !!u.parent });
  item.problems.push(...v.errors.map(e => `exercise.yaml: ${e}`));
  item.warnings.push(...v.warnings.map(w => `exercise.yaml: ${w}`));
  if (!v.meta) return undefined;
  const meta = v.meta;
  item.kind = u.specFile === 'check.json' ? 'project' : meta.kind;
  item.runsIn = meta.runsIn;
  if (!isExerciseId(meta.id)) item.problems.push(`exercise.yaml: id "${meta.id}" cannot appear in progress codes (use lowercase letters, digits, "-", "_", "." and "/")`);
  if (u.parent) {
    if (meta.runsIn !== u.parent.runsIn) item.problems.push(`exercise.yaml: a variant must run where its exercise runs (${u.parent.runsIn}), not ${meta.runsIn}`);
    if (meta.kind !== u.parent.kind) item.warnings.push(`exercise.yaml: kind "${meta.kind}" differs from the exercise's "${u.parent.kind}"`);
  }
  const spec = readSpec(path.join(u.dir, u.specFile), meta.runsIn, [u.dir], item);
  if (!spec) return undefined;
  // The app edits the first source and tests against it; everything else must agree.
  const learnerFile = spec.sources[0];
  if (meta.file !== undefined && meta.file !== learnerFile) {
    item.problems.push(`exercise.yaml: "file" is ${meta.file} but ${u.specFile}'s first source (the file the learner edits) is ${learnerFile}`);
  }
  return { meta, spec, learnerFile };
}

/** Solution passes, starter fails, in the place the exercise runs. */
async function checkUnit(item: ItemReport, dir: string, l: Loaded, ctx: Ctx) {
  const need = (f: string) => { if (!existsSync(path.join(dir, f))) item.problems.push(`${f} is missing`); };
  need('solution.c');
  if (l.meta.kind !== 'pa') need('starter.c');
  if (item.problems.length) return;
  if (l.meta.runsIn === 'native') {
    await verifyNative(item, dir, { cc: ctx.cc, checkMjs: await ctx.checkMjs(), verbose: ctx.verbose });
  } else if (l.meta.kind === 'pa') {
    await verifyParsons(item, ctx.wasm(), l.spec, l.meta, l.learnerFile, dir, browserSupportFiles(dir), ctx.verbose);
  } else {
    await verifyBrowserPair(item, ctx.wasm(), l.spec, l.learnerFile, browserSupportFiles(dir), text(path.join(dir, 'solution.c')), text(path.join(dir, 'starter.c')), ctx.verbose);
  }
}

async function verifyExercise(ex: ExerciseDir, ctx: Ctx): Promise<ItemReport[]> {
  const t0 = performance.now();
  const item = newItem(ex.module.id, ex.id, 'ct', '?');
  const reports = [item];
  const loaded = loadUnit(item, { dir: ex.dir, id: ex.id, specFile: 'tests.json' });
  if (loaded) {
    const existing = variantDirs(ex.dir);
    for (const name of loaded.meta.variants) if (!existing.includes(name)) item.problems.push(`variant "${name}" is listed but variants/${name}/ does not exist`);
    for (const name of existing) if (!loaded.meta.variants.includes(name)) item.warnings.push(`variants/${name}/ exists but is not listed in exercise.yaml`);
    await checkUnit(item, ex.dir, loaded, ctx);
  }
  item.ms = performance.now() - t0;

  // Variants: the same checks, each on its own folder (own exercise.yaml, tests.json and files).
  for (const name of (loaded?.meta.variants ?? []).filter(n => variantDirs(ex.dir).includes(n))) {
    const t1 = performance.now();
    const vdir = path.join(ex.dir, 'variants', name);
    const vi = newItem(ex.module.id, `${ex.id}/variants/${name}`, loaded!.meta.kind, loaded!.meta.runsIn);
    reports.push(vi);
    const vl = loadUnit(vi, { dir: vdir, id: vi.id, parent: loaded!.meta, specFile: 'tests.json' });
    if (vl) await checkUnit(vi, vdir, vl, ctx);
    vi.ms = performance.now() - t1;
  }
  for (const r of reports) r.ok = r.problems.length === 0;
  return reports;
}

async function verifyProject(pr: ProjectDir, ctx: Ctx): Promise<ItemReport> {
  const t0 = performance.now();
  const id = `project/${pr.id}`;
  const item = newItem(pr.module.id, id, 'project', '?');
  const loaded = loadUnit(item, { dir: pr.dir, id, specFile: 'check.json' });
  for (const d of ['starter', 'solution']) if (!existsSync(path.join(pr.dir, d))) item.problems.push(`${d}/ is missing`);
  if (loaded && !item.problems.length) {
    const { meta, spec, learnerFile } = loaded;
    const inModule = pr.module.projectRunsIn;
    if (inModule && inModule !== 'both' && inModule !== meta.runsIn) item.warnings.push(`module.yaml says the project runs in the ${inModule}, exercise.yaml says ${meta.runsIn}`);
    const browser = meta.runsIn === 'browser' || inModule === 'both';
    item.runsIn = browser && meta.runsIn !== 'browser' ? 'browser+native' : meta.runsIn;
    // Projects always ship as zips with check.mjs, so they are always verified natively.
    await verifyNative(item, pr.dir, { cc: ctx.cc, checkMjs: await ctx.checkMjs(), verbose: ctx.verbose });
    if (browser) {
      // The app gives the browser runner the learner's first source plus support files, nothing from starter/.
      const code = (d: 'starter' | 'solution') => ({ [learnerFile]: text(path.join(pr.dir, d, learnerFile)) });
      if (!existsSync(path.join(pr.dir, 'starter', learnerFile)) || !existsSync(path.join(pr.dir, 'solution', learnerFile))) {
        item.problems.push(`starter/ and solution/ must both contain ${learnerFile}`);
      } else {
        const files = browserSupportFiles(pr.dir);
        const before = item.summary.length;
        const r1 = await runTests(spec, code('solution'), files, ctx.wasm());
        const r2 = await runTests(spec, code('starter'), files, ctx.wasm());
        item.summary.splice(before, 0, `browser: solution ${passedCount(r1)}/${r1.total}, starter ${passedCount(r2)}/${r2.total}`);
        if (!allPass(r1)) { item.problems.push(`the reference solution fails in the browser toolchain: ${names(failing(r1))}`); if (ctx.verbose) item.details.push(...explain('browser solution', r1)); }
        if (allPass(r2)) item.problems.push('the starter passes every test in the browser toolchain');
      }
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
