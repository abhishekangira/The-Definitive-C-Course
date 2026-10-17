// tests.json / check.json (TestsSpec) helpers: type guards, hint tiers and validation.
// Environment-neutral. Used by the runner, check.mjs (malformed check.json → a clear message) and
// tools/exercises (authoring errors fail the build).
import type { IoTest, MakeTest, ScanTest, TestsSpec, TextExpect, UnitTest } from '../content-model/types';
import { compilePattern } from './compare';

export type AnyTest = IoTest | UnitTest | MakeTest | ScanTest;

export const isIoTest = (t: AnyTest): t is IoTest => typeof (t as IoTest).run === 'object' && (t as IoTest).run !== null;
export const isUnitTest = (t: AnyTest): t is UnitTest => typeof (t as UnitTest).unit === 'object' && (t as UnitTest).unit !== null;
export const isMakeTest = (t: AnyTest): t is MakeTest => typeof (t as MakeTest).make === 'object' && (t as MakeTest).make !== null;
export const isScanTest = (t: AnyTest): t is ScanTest => typeof (t as ScanTest).scan === 'object' && (t as ScanTest).scan !== null;

/** Names of the checks the runner adds around spec.tests. */
export const COMPILE_TEST_NAME = 'compiles without warnings';
export const COMPILE_ALLOW_WARNINGS_TEST_NAME = 'compiles';
export const MEMORY_TEST_NAME = 'no memory errors or leaks';

/**
 * Hint tiers for a test, nudge first. A test may carry `hints: string[]` (progressive tiers, shown
 * one at a time by `node check.mjs --hint` and the app) or a single `hint`.
 */
export function hintsOf(t: AnyTest): string[] {
  const tiers = (t as { hints?: unknown }).hints;
  if (Array.isArray(tiers)) return tiers.filter((h): h is string => typeof h === 'string' && h.trim() !== '');
  return typeof t.hint === 'string' && t.hint.trim() ? [t.hint] : [];
}

export interface SpecProblems {
  errors: string[];
  warnings: string[];
}

export interface ValidateOptions {
  /** Where the exercise runs; make tests are native-only. */
  runsIn?: 'browser' | 'native';
  /** Returns true when a path (relative to the exercise folder) exists; enables file checks. */
  exists?: (path: string) => boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');

function unknownKeys(o: Record<string, unknown>, allowed: string[], where: string, out: string[]) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) out.push(`${where}: unknown key "${k}"`);
}

function checkTextExpect(v: unknown, where: string, p: SpecProblems) {
  if (typeof v === 'string') return;
  if (!isObj(v)) { p.errors.push(`${where} must be a string or an object`); return; }
  unknownKeys(v, ['equals', 'contains', 'notContains', 'matches', 'trim'], where, p.warnings);
  const e = v as Exclude<TextExpect, string>;
  if (e.equals === undefined && e.contains === undefined && e.notContains === undefined && e.matches === undefined) {
    p.errors.push(`${where} needs equals, contains, notContains or matches`);
  }
  if (e.equals !== undefined && typeof e.equals !== 'string') p.errors.push(`${where}.equals must be a string`);
  if (e.contains !== undefined && !isStrArray(e.contains)) p.errors.push(`${where}.contains must be a list of strings`);
  if (e.notContains !== undefined && !isStrArray(e.notContains)) p.errors.push(`${where}.notContains must be a list of strings`);
  if (e.trim !== undefined && typeof e.trim !== 'boolean') p.errors.push(`${where}.trim must be true or false`);
  if (e.matches !== undefined) {
    if (typeof e.matches !== 'string') p.errors.push(`${where}.matches must be a string`);
    else {
      try { compilePattern(e.matches); } catch (err) { p.errors.push(`${where}.matches is not a valid regular expression: ${(err as Error).message}`); }
    }
  }
}

/** Validates a parsed tests.json/check.json. Errors make the spec unusable; warnings are likely typos. */
export function validateTestsSpec(spec: unknown, opts: ValidateOptions = {}): SpecProblems {
  const p: SpecProblems = { errors: [], warnings: [] };
  if (!isObj(spec)) { p.errors.push('the file must contain a JSON object'); return p; }
  // title/binary are optional display fields read by check.mjs (not part of TestsSpec yet).
  unknownKeys(spec, ['version', 'sources', 'warnings', 'guardrail', 'leakcheck', 'memory', 'tests', 'title', 'binary', '$schema'], 'spec', p.warnings);
  if (spec.version !== 1) p.errors.push('"version" must be 1');
  if (!isStrArray(spec.sources) || spec.sources.length === 0) p.errors.push('"sources" must be a non-empty list of file names');
  else {
    for (const s of spec.sources) {
      if (!/\.c$/.test(s)) p.errors.push(`source "${s}" is not a .c file`);
      if (/(^|[\\/])\.\.([\\/]|$)/.test(s) || /^[\\/]/.test(s)) p.errors.push(`source "${s}" must be a relative path inside the exercise`);
    }
  }
  if (spec.warnings !== undefined && spec.warnings !== 'error' && spec.warnings !== 'allow') p.errors.push('"warnings" must be "error" or "allow"');
  for (const k of ['guardrail', 'leakcheck', 'memory'] as const) {
    if (spec[k] !== undefined && typeof spec[k] !== 'boolean') p.errors.push(`"${k}" must be true or false`);
  }
  if (!Array.isArray(spec.tests)) { p.errors.push('"tests" must be a list'); return p; }

  const reserved = new Set([COMPILE_TEST_NAME, COMPILE_ALLOW_WARNINGS_TEST_NAME, MEMORY_TEST_NAME]);
  const names = new Set<string>();
  spec.tests.forEach((t: unknown, i: number) => {
    const where = `tests[${i}]`;
    if (!isObj(t)) { p.errors.push(`${where} must be an object`); return; }
    const name = t.name;
    const label = typeof name === 'string' ? `test "${name}"` : where;
    if (typeof name !== 'string' || !name.trim()) p.errors.push(`${where} needs a non-empty "name"`);
    else {
      if (names.has(name)) p.errors.push(`${label}: duplicate name`);
      if (reserved.has(name)) p.errors.push(`${label}: this name is reserved for the check the runner adds itself`);
      if (/[\t\n]/.test(name)) p.errors.push(`${label}: names cannot contain tabs or newlines`);
      names.add(name);
    }
    if (t.hint !== undefined && typeof t.hint !== 'string') p.errors.push(`${label}: "hint" must be a string`);
    if (t.hints !== undefined && (!isStrArray(t.hints) || t.hints.some(h => !h.trim()))) p.errors.push(`${label}: "hints" must be a list of non-empty strings`);
    const kinds = ['run', 'unit', 'make', 'scan'].filter(k => t[k] !== undefined);
    if (kinds.length !== 1) { p.errors.push(`${label}: needs exactly one of "run", "unit", "make" or "scan" (found ${kinds.length})`); return; }

    if (kinds[0] === 'run') {
      unknownKeys(t, ['name', 'run', 'expect', 'hint', 'hints'], label, p.warnings);
      const run = t.run;
      if (!isObj(run)) { p.errors.push(`${label}: "run" must be an object`); return; }
      unknownKeys(run, ['args', 'stdin', 'timeoutMs'], `${label}.run`, p.warnings);
      if (run.args !== undefined && !isStrArray(run.args)) p.errors.push(`${label}: run.args must be a list of strings`);
      if (run.stdin !== undefined && typeof run.stdin !== 'string') p.errors.push(`${label}: run.stdin must be a string`);
      if (run.timeoutMs !== undefined && !(typeof run.timeoutMs === 'number' && run.timeoutMs > 0)) p.errors.push(`${label}: run.timeoutMs must be a positive number`);
      const ex = t.expect;
      if (!isObj(ex)) { p.errors.push(`${label}: needs an "expect" object`); return; }
      unknownKeys(ex, ['stdout', 'stderr', 'exit'], `${label}.expect`, p.warnings);
      if (ex.stdout !== undefined) checkTextExpect(ex.stdout, `${label}: expect.stdout`, p);
      if (ex.stderr !== undefined) checkTextExpect(ex.stderr, `${label}: expect.stderr`, p);
      if (ex.exit !== undefined && ex.exit !== 'nonzero' && !(Number.isInteger(ex.exit) && (ex.exit as number) >= 0 && (ex.exit as number) <= 255)) {
        p.errors.push(`${label}: expect.exit must be an integer 0-255 or "nonzero"`);
      }
      if (ex.stdout === undefined && ex.stderr === undefined && ex.exit === undefined) p.errors.push(`${label}: expect needs stdout, stderr or exit`);
      // PLAN §3.3: a starter once "passed" a negative test by accident (it exited 1 because stdin was empty).
      const negative = ex.exit === 'nonzero' || (typeof ex.exit === 'number' && ex.exit !== 0);
      if (negative && (run.stdin === undefined || (ex.stdout === undefined && ex.stderr === undefined))) {
        p.errors.push(`${label}: a test that expects a non-zero exit must supply run.stdin and check stdout or stderr`);
      }
    } else if (kinds[0] === 'unit') {
      unknownKeys(t, ['name', 'unit', 'hint', 'hints'], label, p.warnings);
      const u = t.unit;
      if (!isObj(u) || typeof u.harness !== 'string' || !u.harness) { p.errors.push(`${label}: unit.harness must name a C file`); return; }
      if (opts.exists && !opts.exists(u.harness)) p.errors.push(`${label}: harness file "${u.harness}" does not exist`);
    } else if (kinds[0] === 'scan') {
      unknownKeys(t, ['name', 'scan', 'hint', 'hints'], label, p.warnings);
      const sc = t.scan;
      if (!isObj(sc)) { p.errors.push(`${label}: "scan" must be an object`); return; }
      unknownKeys(sc, ['function', 'allow', 'maxOps', 'maxLiteral'], `${label}.scan`, p.warnings);
      if (typeof sc.function !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sc.function)) p.errors.push(`${label}: scan.function must be a C identifier`);
      if (!isStrArray(sc.allow) || sc.allow.some(o => !o.trim())) p.errors.push(`${label}: scan.allow must be a list of operator strings`);
      if (!(Number.isInteger(sc.maxOps) && (sc.maxOps as number) > 0)) p.errors.push(`${label}: scan.maxOps must be a positive integer`);
      if (sc.maxLiteral !== undefined && !(Number.isInteger(sc.maxLiteral) && (sc.maxLiteral as number) >= 0)) p.errors.push(`${label}: scan.maxLiteral must be a non-negative integer`);
    } else {
      unknownKeys(t, ['name', 'make', 'hint', 'hints'], label, p.warnings);
      const m = t.make;
      if (!isObj(m) || typeof m.target !== 'string' || !m.target) { p.errors.push(`${label}: make.target must be a string`); return; }
      if (m.expectRebuild !== undefined && !isStrArray(m.expectRebuild)) p.errors.push(`${label}: make.expectRebuild must be a list of file names`);
      if (opts.runsIn === 'browser') p.errors.push(`${label}: make tests only run natively (check.mjs), not in the browser`);
    }
  });
  return p;
}

/** Throws with every error when the spec is invalid; returns it typed otherwise. */
export function assertTestsSpec(spec: unknown, opts: ValidateOptions = {}): TestsSpec {
  const { errors } = validateTestsSpec(spec, opts);
  if (errors.length) throw new Error(`invalid tests spec:\n  - ${errors.join('\n  - ')}`);
  return spec as TestsSpec;
}
