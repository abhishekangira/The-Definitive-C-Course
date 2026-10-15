import { describe, expect, it } from 'vitest';
import { assertTestsSpec, hintsOf, validateTestsSpec } from './spec';

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
      'test "a": needs exactly one of "run", "unit" or "make" (found 2)',
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

describe('hintsOf', () => {
  it('prefers hint tiers, falls back to a single hint', () => {
    expect(hintsOf({ name: 'a', run: {}, expect: {}, hint: 'one' })).toEqual(['one']);
    expect(hintsOf({ name: 'a', run: {}, expect: {}, hints: ['1', ' ', '2'] } as never)).toEqual(['1', '2']);
    expect(hintsOf({ name: 'a', run: {}, expect: {} })).toEqual([]);
  });
});
