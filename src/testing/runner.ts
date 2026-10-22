// The shared test runner: one set of semantics for the in-browser runner, the exercise verifier
// (tools/exercises) and the local runner (check.mjs). Pure TypeScript; all compiling and running
// goes through an ExecBackend (exec.ts).
//
// Order of checks (this order is also the progress code's pass bitmap):
//   0. "compiles without warnings" (or "compiles" when spec.warnings is "allow");
//   1…n. spec.tests in order (I/O, unit, make, scan and file tests);
//   n+1. "no memory errors or leaks" when spec.leakcheck or spec.memory is set.
// If the learner's code does not compile, every check after the first is skipped.
import type { Diagnostic, FileTest, IoTest, MakeTest, ScanTest, TestsSpec, UnitTest } from '../content-model/types';
import { checkExit, checkText, commandLine, decodeBytes, describeCrash, findRuntimeError, type FirstDiff, type MatchHow } from './compare';
import type { CompileOutcome, ExecBackend, ExecOutcome } from './exec';
import { buildHarness, CHECK_H, CHECK_H_FILE, extractCheckNames, HARNESS_FILE, NEVER_REPORTED, parseHarnessOutput, type SubtestResult } from './harness';
import { dedupeIssues, leakEventsToIssues, type MemoryIssue } from './memory';
import { scanFunction } from './scan';
import {
  COMPILE_ALLOW_WARNINGS_TEST_NAME, COMPILE_TEST_NAME, hintsOf, isFileTest, isIoTest, isMakeTest, isScanTest, isUnitTest, MEMORY_TEST_NAME, type AnyTest,
} from './spec';

// The backend contract lives in exec.ts; it is re-exported so callers need only one import.
export type { CompileOptions, CompileOutcome, ExecBackend, ExecOutcome, ExecRunOptions, MakeOptions, MakeOutcome } from './exec';
export type { FirstDiff, MatchHow } from './compare';
export type { SubtestResult } from './harness';
export type { MemoryIssue } from './memory';

export type TestStatus = 'pass' | 'fail' | 'skip';
export type TestKind = 'compile' | 'io' | 'unit' | 'make' | 'scan' | 'file' | 'memory';

export interface TestResult {
  name: string;
  kind: TestKind;
  status: TestStatus;
  /** One plain-English sentence: why it failed, or why it was skipped. */
  message?: string;
  /** Further lines (compiler errors, other memory issues, make output…). */
  details?: string[];
  /** I/O tests: the command that was run and its stdin. */
  command?: string;
  stdin?: string;
  /** I/O tests: which stream or the exit code failed, and how. */
  stream?: 'stdout' | 'stderr' | 'exit';
  how?: MatchHow;
  /** Raw (unescaped) expected/actual text; render with escapeForDisplay(). */
  expected?: string;
  actual?: string;
  firstDiff?: FirstDiff;
  /** On failure: the first hint tier, and every tier (for progressive hints). */
  hint?: string;
  hints?: string[];
  subtests?: SubtestResult[];
  diagnostics?: Diagnostic[];
  memory?: MemoryIssue[];
  /** Extra information on a pass, e.g. which memory tools ran. */
  note?: string;
  ms?: number;
}

export interface PlannedTest {
  name: string;
  kind: TestKind;
}

export interface TestReport {
  results: TestResult[];
  passed: number;
  total: number;
  /** Every check ran and passed. */
  allPassed: boolean;
  /** One character per planned check, "1" = passed (skipped counts as "0"). */
  bits: string;
  compile: { ok: boolean; diagnostics: Diagnostic[]; raw: string };
  backend: string;
  ms: number;
}

export interface RunTestsOptions {
  /** Run only the check with this name (the compile check always runs). */
  only?: string;
  /** Default timeout for I/O tests (ms). */
  defaultTimeoutMs?: number;
  /** Default timeout for unit-test programs (ms). */
  unitTimeoutMs?: number;
  /** Timeout for make targets (ms). */
  makeTimeoutMs?: number;
  /** Executable name used in "ran: ./caesar 23" lines. Defaults to spec.binary, else sources[0] without ".c". */
  binary?: string;
  /**
   * Reads a file of the project folder for `file` tests; undefined when there is no such file. Only check.mjs
   * has the learner's folder: without this, file tests are skipped (a skip is never a pass).
   */
  readFile?(path: string): Uint8Array | undefined;
  /** Called as each check finishes (for streaming output). */
  onResult?(result: TestResult, index: number): void;
}

export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_UNIT_TIMEOUT_MS = 5000;
export const DEFAULT_MAKE_TIMEOUT_MS = 120_000;
/** Memory-checked builds run several times slower (ASan, valgrind). */
export const MEMORY_SLOWDOWN = 5;

/** Support files the toolchain links itself; warnings in them are never the learner's. */
const SUPPORT_FILES = new Set(['course_rt.c', 'ubsan_rt.c', 'leakcheck.c', 'leakcheck.h', CHECK_H_FILE, HARNESS_FILE]);
const MAX_DETAIL_LINES = 6;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

/** The checks a spec produces, in report (and bitmap) order. */
export function plannedTests(spec: TestsSpec): PlannedTest[] {
  const plan: PlannedTest[] = [{ name: spec.warnings === 'allow' ? COMPILE_ALLOW_WARNINGS_TEST_NAME : COMPILE_TEST_NAME, kind: 'compile' }];
  for (const t of spec.tests) plan.push({ name: t.name, kind: isIoTest(t) ? 'io' : isUnitTest(t) ? 'unit' : isScanTest(t) ? 'scan' : isFileTest(t) ? 'file' : 'make' });
  if (spec.leakcheck || spec.memory) plan.push({ name: MEMORY_TEST_NAME, kind: 'memory' });
  return plan;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.line}:${d.col}: ${d.severity}: ${d.message}${d.flag ? ` [${d.flag}]` : ''}`;
}

/** Linker and driver errors that parseDiagnostics() cannot see (no file:line:col). */
function linkerErrors(raw: string): string[] {
  return raw.split('\n').filter(l => /\berror\b|undefined (reference|symbol)/i.test(l) && !/^collect2:|^clang(-\d+)?: error: linker command failed/.test(l)
    && !/^\S+:\d+:\d+: /.test(l)).map(l => l.trim()).filter(Boolean);
}

/** A plain-English reading of common link errors. */
function explainLinkError(lines: string[]): string | undefined {
  const text = lines.join('\n');
  if (/undefined (reference to [`']main'|symbol: main\b)|undefined symbol: __main_argc_argv/.test(text)) return 'there is no main() function';
  const m = /undefined (?:reference to [`']|symbol: )(\w+)/.exec(text);
  if (m) return `the function ${m[1]}() is called but never defined (a typo, or a file missing from the build?)`;
  if (/multiple definition of [`'](\w+)|duplicate symbol: (\w+)/.test(text)) {
    const d = /multiple definition of [`'](\w+)|duplicate symbol: (\w+)/.exec(text)!;
    return `${d[1] ?? d[2]} is defined more than once (in two files, or a definition in a header?)`;
  }
  return undefined;
}

function compileFailure(c: CompileOutcome, message: string): Pick<TestResult, 'message' | 'details' | 'diagnostics'> {
  const errors = c.diagnostics.filter(d => d.severity === 'error' || d.severity === 'fatal error');
  const link = errors.length ? [] : linkerErrors(c.raw);
  const why = errors.length ? undefined : explainLinkError(link);
  const details = (errors.length ? errors.map(formatDiagnostic) : link.length ? link : c.raw.trim().split('\n').slice(-MAX_DETAIL_LINES)).slice(0, MAX_DETAIL_LINES);
  return { message: why ? `${message}: ${why}` : message, details, diagnostics: c.diagnostics };
}

function hintFields(t: AnyTest | undefined, fallback?: string): Pick<TestResult, 'hint' | 'hints'> {
  const tiers = t ? hintsOf(t) : [];
  const all = tiers.length ? tiers : fallback ? [fallback] : [];
  return all.length ? { hint: all[0], hints: all } : {};
}

const COMPILE_HINT = 'Fix every warning: the course builds with -std=c17 -Wall -Wextra -pedantic, and warnings often point at real bugs.';

function compileResult(name: string, spec: TestsSpec, c: CompileOutcome): TestResult {
  const base = { name, kind: 'compile' as const, diagnostics: c.diagnostics };
  if (!c.ok) return { ...base, status: 'fail', ...compileFailure(c, "your code doesn't compile yet") };
  const warnings = c.diagnostics.filter(d => d.severity === 'warning' && !SUPPORT_FILES.has(baseName(d.file)));
  if (spec.warnings !== 'allow' && warnings.length) {
    return {
      ...base, status: 'fail',
      message: `the compiler printed ${warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`}`,
      details: warnings.slice(0, MAX_DETAIL_LINES).map(formatDiagnostic),
      ...hintFields(undefined, COMPILE_HINT),
    };
  }
  return { ...base, status: 'pass' };
}

// ---------------------------------------------------------------- I/O tests

const STREAM_LABEL = { stdout: 'output', stderr: 'error output (stderr)' } as const;

/** Evaluates one I/O test against a finished run. Exported for the app's "run one test" button. */
export function evaluateIo(t: IoTest, out: ExecOutcome, ctx: { binary: string; timeoutMs: number }): TestResult {
  const base: TestResult = {
    name: t.name, kind: 'io', status: 'pass',
    command: commandLine(ctx.binary, t.run.args), stdin: t.run.stdin,
  };
  const fail = (f: Partial<TestResult>): TestResult => ({ ...base, ...f, status: 'fail', ...hintFields(t) });

  const crash = describeCrash(out, ctx.timeoutMs);
  if (crash) {
    const details = out.stdout ? [`output before it stopped: ${JSON.stringify(out.stdout.slice(-200))}`] : [];
    return fail({ message: crash, details, actual: out.stdout });
  }
  const ub = findRuntimeError(out.stderr);
  if (ub && t.expect.stderr === undefined) {
    return fail({ message: `undefined behaviour at ${ub.file}:${ub.line}: ${ub.message}`, actual: out.stdout });
  }
  for (const stream of ['stdout', 'stderr'] as const) {
    const c = checkText(t.expect[stream], out[stream]);
    if (c.ok) continue;
    const label = STREAM_LABEL[stream];
    const message =
      c.how === 'exactly' ? `wrong ${label}: ${c.firstDiff?.summary ?? 'it differs'}`
      : c.how === 'containing' ? `the ${label} should contain ${JSON.stringify(c.expected)}, but it doesn't`
      : c.how === 'not containing' ? `the ${label} should not contain ${JSON.stringify(c.expected)}`
      : `the ${label} doesn't match the pattern ${c.expected}`;
    return fail({ message, stream, how: c.how, expected: c.expected, actual: c.actual, firstDiff: c.firstDiff });
  }
  const e = checkExit(t.expect.exit, out.exit);
  if (!e.ok) {
    const details = out.stderr.trim() ? [`error output (stderr): ${JSON.stringify(out.stderr.slice(0, 300))}`] : [];
    return fail({ message: `expected ${e.expected}, but it exited with ${out.exit}`, stream: 'exit', expected: e.expected, actual: String(out.exit), details });
  }
  return base;
}

// ---------------------------------------------------------------- the runner

function skip(p: PlannedTest, message: string): TestResult {
  return { name: p.name, kind: p.kind, status: 'skip', message };
}

/** Collects memory issues from one run (browser leakcheck events or native tool findings). */
function issuesOf(out: ExecOutcome): MemoryIssue[] {
  return [...(out.leakcheck ? leakEventsToIssues(out.leakcheck) : []), ...(out.memory ?? [])];
}

/**
 * Runs every check of `spec` against the learner's files.
 * @param learnerFiles the learner's sources (and any headers they wrote), path → text
 * @param exerciseFiles files that come with the exercise: unit-test harnesses, data files…
 */
export async function runTests<A>(
  spec: TestsSpec,
  learnerFiles: Record<string, string>,
  exerciseFiles: Record<string, string>,
  exec: ExecBackend<A>,
  options: RunTestsOptions = {},
): Promise<TestReport> {
  const t0 = now();
  const plan = plannedTests(spec);
  const results: TestResult[] = [];
  const emit = (i: number, r: TestResult) => { results[i] = r; options.onResult?.(r, i); };
  const files = { ...exerciseFiles, ...learnerFiles };
  const sources = spec.sources;
  const specBinary = (spec as { binary?: unknown }).binary; // optional check.json field
  const binary = options.binary ?? (typeof specBinary === 'string' && specBinary ? specBinary : baseName(sources[0]).replace(/\.c$/, ''));
  const ioTimeout = (t: IoTest) => t.run.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const unitTimeout = options.unitTimeoutMs ?? DEFAULT_UNIT_TIMEOUT_MS;
  const memoryWanted = !!(spec.leakcheck || spec.memory);
  const combined = memoryWanted && !!exec.combinedMemoryBuild;
  const memoryIndex = memoryWanted ? plan.length - 1 : -1;
  const selected = (name: string) => options.only === undefined || options.only === name;

  // Memory findings gathered from instrumented runs, with the run each was first seen in.
  const memory: Array<{ issue: MemoryIssue; context: string }> = [];
  const tools = new Set<string>();
  let leaksUnchecked = false;
  let unavailable: string | undefined;
  const collect = (out: ExecOutcome, context: string) => {
    for (const issue of issuesOf(out)) memory.push({ issue, context });
    out.memoryTools?.forEach(t => tools.add(t));
    if (out.leaksChecked === false) leaksUnchecked = true;
    if (out.memoryUnavailable) unavailable = out.memoryUnavailable;
  };
  const describeRun = (t: IoTest) => `${commandLine(binary, t.run.args)}${t.run.stdin !== undefined ? ` with input ${JSON.stringify(t.run.stdin)}` : ''}`;

  const report = (main: CompileOutcome<A>): TestReport => {
    const passed = results.filter(r => r.status === 'pass').length;
    return {
      results, passed, total: plan.length,
      allPassed: passed === plan.length,
      bits: results.map(r => (r.status === 'pass' ? '1' : '0')).join(''),
      compile: { ok: main.ok, diagnostics: main.diagnostics, raw: main.raw },
      backend: exec.name ?? 'unknown',
      ms: now() - t0,
    };
  };

  // 1. Compile the learner's code (with the leak checker when the backend combines builds).
  const tc = now();
  const main = await exec.compile(files, sources, { guardrail: spec.guardrail, leakcheck: combined, purpose: 'program' });
  emit(0, { ...compileResult(plan[0].name, spec, main), ms: now() - tc });
  if (!main.ok || main.artifact === undefined) {
    for (let i = 1; i < plan.length; i++) emit(i, skip(plan[i], "can't check this until your code compiles"));
    return report(main);
  }
  const artifact = main.artifact;

  // 2. The spec's own tests.
  const unitCache = new Map<string, Promise<TestResult>>();
  for (let k = 0; k < spec.tests.length; k++) {
    const t = spec.tests[k] as AnyTest;
    const i = k + 1;
    const ts = now();
    const wanted = selected(t.name);
    // In combined mode the memory check reads the I/O runs, so they run even when only it was selected.
    const silentForMemory = !wanted && combined && options.only === MEMORY_TEST_NAME && isIoTest(t);
    if (!wanted && !silentForMemory) { emit(i, skip(plan[i], `not selected (only "${options.only}")`)); continue; }

    let r: TestResult;
    if (isIoTest(t)) {
      const out = await exec.run(artifact, { stdin: t.run.stdin, args: t.run.args, timeoutMs: ioTimeout(t) });
      if (combined) collect(out, describeRun(t));
      r = evaluateIo(t, out, { binary, timeoutMs: ioTimeout(t) });
    } else if (isUnitTest(t)) {
      // Two tests may share a harness: compile and run it once.
      let p = unitCache.get(t.unit.harness);
      if (!p) { p = unitTest(t); unitCache.set(t.unit.harness, p); }
      const res = await p;
      r = { ...res, name: t.name, ...(res.status === 'fail' && hintsOf(t).length ? hintFields(t) : {}) };
    } else if (isMakeTest(t)) {
      r = await makeTest(t);
    } else if (isScanTest(t)) {
      r = scanTest(t);
    } else if (isFileTest(t)) {
      r = fileTest(t);
    } else {
      r = { name: (t as AnyTest).name, kind: plan[i].kind, status: 'fail', message: 'this test has no "run", "unit", "make", "scan" or "file" section (the tests file is malformed)' };
    }
    if (silentForMemory) r = skip(plan[i], `not selected (only "${options.only}")`);
    emit(i, { ...r, ms: now() - ts });
  }

  // 3. The memory check.
  if (memoryWanted) {
    const p = plan[memoryIndex];
    const ts = now();
    if (!selected(p.name)) emit(memoryIndex, skip(p, `not selected (only "${options.only}")`));
    else emit(memoryIndex, { ...(await memoryTest()), ms: now() - ts });
  }
  return report(main);

  // ---------------------------------------------------------------- per-kind helpers (hoisted)

  async function unitTest(t: UnitTest): Promise<TestResult> {
    const base = { name: t.name, kind: 'unit' as const };
    const testSource = files[t.unit.harness];
    if (testSource === undefined) return { ...base, status: 'fail', message: `the unit-test file ${t.unit.harness} is missing` };
    const harness = buildHarness({ learnerFile: sources[0], testFile: t.unit.harness, testSource });
    const hfiles = { ...files, [CHECK_H_FILE]: CHECK_H, [HARNESS_FILE]: harness };
    const comp = await exec.compile(hfiles, [HARNESS_FILE, ...sources.slice(1)], { guardrail: spec.guardrail, leakcheck: combined, purpose: 'unit' });
    if (!comp.ok || comp.artifact === undefined) {
      return {
        ...base, status: 'fail', ...compileFailure(comp, "the unit tests don't compile against your code"),
        ...hintFields(undefined, 'Check that every function the exercise asks for exists, with exactly the name, parameters and return type it gives.'),
      };
    }
    const out = await exec.run(comp.artifact, { timeoutMs: unitTimeout });
    if (combined) collect(out, `the unit tests in ${t.unit.harness}`);
    const parsed = parseHarnessOutput(out.stdout, extractCheckNames(testSource));
    const ub = findRuntimeError(out.stderr);
    const stopped = describeCrash(out, unitTimeout)
      ?? (ub ? `undefined behaviour at ${ub.file}:${ub.line}: ${ub.message}` : undefined)
      ?? (!parsed.done ? `the test program stopped early with exit code ${out.exit} (does your code call exit()?)` : undefined);
    const subtests = parsed.subtests.map(s => (s.message === NEVER_REPORTED && stopped ? { ...s, message: `never ran: ${stopped}` } : s));
    if (stopped && parsed.missing.length === 0) subtests.push({ name: '(after the last check)', status: 'fail', message: stopped });
    const failed = subtests.filter(s => s.status === 'fail').length;
    if (subtests.length === 0) return { ...base, status: 'fail', message: 'the test program made no checks', subtests };
    if (failed === 0 && parsed.done) return { ...base, status: 'pass', subtests, note: `${subtests.length} checks` };
    const message = stopped && parsed.missing.length ? stopped : `${failed} of ${subtests.length} checks failed`;
    return { ...base, status: 'fail', message, subtests };
  }

  /** The operator scan reads the learner's first source file; it needs no compiler. */
  function scanTest(t: ScanTest): TestResult {
    const base = { name: t.name, kind: 'scan' as const };
    const source = files[sources[0]];
    if (source === undefined) return { ...base, status: 'fail', message: `${sources[0]} is missing` };
    const r = scanFunction(source, t.scan);
    if (r.ok) return { ...base, status: 'pass', note: `${r.ops} of ${t.scan.maxOps} operators used` };
    return { ...base, status: 'fail', message: r.message, ...hintFields(t) };
  }

  /** A file the learner made must exist and match. Binary files are read one byte per character. */
  function fileTest(t: FileTest): TestResult {
    const base = { name: t.name, kind: 'file' as const };
    const p = t.file.path;
    if (!options.readFile) return { ...base, status: 'skip', message: `this check reads ${p} on your own machine, so only check.mjs runs it` };
    const bytes = options.readFile(p);
    if (bytes === undefined) return { ...base, status: 'fail', message: `there is no file ${p}`, ...hintFields(t) };
    let text = '';
    if (t.file.binary) for (const b of bytes) text += String.fromCharCode(b);
    else text = decodeBytes(bytes);
    const c = checkText(t.file.expect, text);
    if (c.ok) return { ...base, status: 'pass' };
    const message =
      c.how === 'exactly' ? `${p} is not what it should be: ${c.firstDiff?.summary ?? 'it differs'}`
      : c.how === 'containing' ? `${p} should contain ${JSON.stringify(c.expected)}, but it doesn't`
      : c.how === 'not containing' ? `${p} should not contain ${JSON.stringify(c.expected)}`
      : `${p} doesn't match the pattern ${c.expected}`;
    return { ...base, status: 'fail', message, how: c.how, expected: c.expected, ...hintFields(t) };
  }

  async function makeTest(t: MakeTest): Promise<TestResult> {
    const base = { name: t.name, kind: 'make' as const };
    if (!exec.make) return { ...base, status: 'skip', message: 'this check runs make on your own machine, so only check.mjs runs it' };
    const r = await exec.make(t.make.target, { expectRebuild: t.make.expectRebuild, timeoutMs: options.makeTimeoutMs ?? DEFAULT_MAKE_TIMEOUT_MS });
    const tail = r.output.trim().split('\n').slice(-MAX_DETAIL_LINES);
    if (r.missing) return { ...base, status: 'fail', message: 'make is not installed', ...hintFields(t, 'Install the build tools: xcode-select --install (macOS) or sudo apt install build-essential (Ubuntu/WSL).') };
    if (r.timedOut) return { ...base, status: 'fail', message: `make ${t.make.target} was still running after ${(options.makeTimeoutMs ?? DEFAULT_MAKE_TIMEOUT_MS) / 1000} s`, details: tail, ...hintFields(t) };
    if (!r.ok) return { ...base, status: 'fail', message: `make ${t.make.target} failed (exit code ${r.exit})`, details: tail, ...hintFields(t) };
    if (r.notRebuilt?.length) {
      const f = r.notRebuilt;
      return {
        ...base, status: 'fail',
        message: `after ${f.join(', ')} changed, make still thought ${t.make.target} was up to date`,
        ...hintFields(t, `List ${f.join(' and ')} among ${t.make.target}'s prerequisites in your Makefile, so a change rebuilds it.`),
      };
    }
    return { ...base, status: 'pass' };
  }

  async function memoryTest(): Promise<TestResult> {
    const base = { name: MEMORY_TEST_NAME, kind: 'memory' as const };
    const ios = spec.tests.filter(isIoTest);
    if (!combined) {
      const comp = await exec.compile(files, sources, { guardrail: spec.guardrail, leakcheck: true, purpose: 'memory' });
      if (!comp.ok || comp.artifact === undefined) return { ...base, status: 'fail', ...compileFailure(comp, "your code doesn't compile with the memory checker") };
      for (const t of ios) {
        const out = await exec.run(comp.artifact, { stdin: t.run.stdin, args: t.run.args, timeoutMs: ioTimeout(t) * MEMORY_SLOWDOWN });
        collect(out, describeRun(t));
      }
      if (ios.length === 0) {
        // Unit-test-only exercises: run the harnesses on the memory build instead.
        for (const t of spec.tests.filter(isUnitTest)) {
          const src = files[t.unit.harness];
          if (src === undefined) continue;
          const hfiles = { ...files, [CHECK_H_FILE]: CHECK_H, [HARNESS_FILE]: buildHarness({ learnerFile: sources[0], testFile: t.unit.harness, testSource: src }) };
          const hc = await exec.compile(hfiles, [HARNESS_FILE, ...sources.slice(1)], { guardrail: spec.guardrail, leakcheck: true, purpose: 'memory' });
          if (hc.ok && hc.artifact !== undefined) collect(await exec.run(hc.artifact, { timeoutMs: unitTimeout * MEMORY_SLOWDOWN }), `the unit tests in ${t.unit.harness}`);
        }
      }
    }
    const seen = dedupeIssues(memory.map(m => m.issue));
    const firstContext = memory.find(m => m.issue === seen[0])?.context;
    if (seen.length) {
      const details = seen.slice(1, MAX_DETAIL_LINES).map(i => i.message);
      if (seen.length > MAX_DETAIL_LINES) details.push(`…and ${seen.length - MAX_DETAIL_LINES} more`);
      if (firstContext) details.push(`seen while running ${firstContext}`);
      return { ...base, status: 'fail', message: seen[0].message, details, memory: seen, ...hintFields(undefined, exec.memoryHint) };
    }
    if (unavailable && tools.size === 0) return { ...base, status: 'skip', message: unavailable };
    const notes = [...tools];
    if (exec.memoryNote) notes.push(exec.memoryNote);
    if (leaksUnchecked) notes.push('leaks NOT checked: no leak detector found');
    return { ...base, status: 'pass', note: notes.join(', ') || undefined };
  }
}
