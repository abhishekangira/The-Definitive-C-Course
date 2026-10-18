import { describe, expect, it } from 'vitest';
import { assertTestsSpec, hintsOf, isScanTest, validateTestsSpec } from './spec';

const ok = {
  version: 1,
  sources: ['main.c'],
  tests: [
    { name: 'io', run: { stdin: 'x\n' }, expect: { stdout: 'y\n' } },
    { name: 'unit', unit: { harness: 'tests/t.c' } },
  ],
};

describe('validateTestsSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateTestsSpec(ok, { exists: () => true })).toEqual({ errors: [], warnings: [] });
  });
  it('reports structural errors', () => {
    const { errors } = validateTestsSpec({ version: 2, sources: [], tests: [{ name: '' }, { name: 'a', run: {}, unit: {} }] });
    expect(errors).toEqual(expect.arrayContaining([
      '"version" must be 1',
      '"sources" must be a non-empty list of file names',
      'tests[0] needs a non-empty "name"',
      'test "a": needs exactly one of "run", "unit", "make" or "scan" (found 2)',
    ]));
  });
  it('checks expectations, regexes, exit codes and duplicate or reserved names', () => {
    const { errors } = validateTestsSpec({
      version: 1, sources: ['main.c'],
      tests: [
        { name: 'r', run: {}, expect: { stdout: { matches: '(' } } },
        { name: 'r', run: {}, expect: { exit: 300 } },
        { name: 'no memory errors or leaks', run: {}, expect: {} },
      ],
    });
    expect(errors.some(e => e.startsWith('test "r": expect.stdout.matches is not a valid regular expression'))).toBe(true);
    expect(errors).toContain('test "r": duplicate name');
    expect(errors).toContain('test "r": expect.exit must be an integer 0-255 or "nonzero"');
    expect(errors).toContain('test "no memory errors or leaks": this name is reserved for the check the runner adds itself');
    expect(errors).toContain('test "no memory errors or leaks": expect needs stdout, stderr or exit');
  });
  it('requires negative tests to supply stdin and check output (PLAN §3.3)', () => {
    const spec = { version: 1, sources: ['main.c'], tests: [{ name: 'neg', run: { args: [] }, expect: { exit: 1 } }] };
    expect(validateTestsSpec(spec).errors).toEqual(['test "neg": a test that expects a non-zero exit must supply run.stdin and check stdout or stderr']);
  });
  it('flags missing harness files, make tests in the browser, and unknown keys', () => {
    const spec = { version: 1, sources: ['main.c'], tests: [{ name: 'u', unit: { harness: 'nope.c' } }, { name: 'm', make: { target: 'all' } }], extra: 1 };
    const p = validateTestsSpec(spec, { runsIn: 'browser', exists: f => f !== 'nope.c' });
    expect(p.errors).toEqual(['test "u": harness file "nope.c" does not exist', 'test "m": make tests only run natively (check.mjs), not in the browser']);
    expect(p.warnings).toEqual(['spec: unknown key "extra"']);
  });
  it('assertTestsSpec throws with every error', () => {
    expect(() => assertTestsSpec({})).toThrow(/version.*\n.*sources/s);
    expect(assertTestsSpec(ok)).toBe(ok);
  });
});

describe('validateTestsSpec: scan tests', () => {
  const scan = (o: unknown, extra: object = {}) => ({ version: 1, sources: ['bitlab.c'], tests: [{ name: 's', scan: o, ...extra }] });
  it('accepts a well-formed scan test', () => {
    expect(validateTestsSpec(scan({ function: 'bit_and', allow: ['~', '|'], maxOps: 4, maxLiteral: 255 }))).toEqual({ errors: [], warnings: [] });
    expect(isScanTest({ name: 's', scan: { function: 'f', allow: [], maxOps: 1 } })).toBe(true);
    expect(isScanTest({ name: 'u', unit: { harness: 'a.c' } })).toBe(false);
  });
  it('rejects a bad function name, allow list, maxOps and maxLiteral', () => {
    const { errors } = validateTestsSpec(scan({ function: '1bad', allow: ['~', 3], maxOps: 0, maxLiteral: -1 }));
    expect(errors).toEqual([
      'test "s": scan.function must be a C identifier',
      'test "s": scan.allow must be a list of operator strings',
      'test "s": scan.maxOps must be a positive integer',
      'test "s": scan.maxLiteral must be a non-negative integer',
    ]);
    expect(validateTestsSpec(scan('x')).errors).toEqual(['test "s": "scan" must be an object']);
  });
  it('is exclusive with run, unit and make, and warns about unknown keys', () => {
    const both = scan({ function: 'f', allow: [], maxOps: 1 }, { unit: { harness: 'a.c' } });
    expect(validateTestsSpec(both).errors).toEqual(['test "s": needs exactly one of "run", "unit", "make" or "scan" (found 2)']);
    expect(validateTestsSpec(scan({ function: 'f', allow: [], maxOps: 1, extra: 1 })).warnings).toEqual(['test "s".scan: unknown key "extra"']);
  });
});

describe('hintsOf', () => {
  it('prefers hint tiers, falls back to a single hint', () => {
    expect(hintsOf({ name: 'a', run: {}, expect: {}, hint: 'one' })).toEqual(['one']);
    expect(hintsOf({ name: 'a', run: {}, expect: {}, hints: ['1', ' ', '2'] } as never)).toEqual(['1', '2']);
    expect(hintsOf({ name: 'a', run: {}, expect: {} })).toEqual([]);
  });
});
