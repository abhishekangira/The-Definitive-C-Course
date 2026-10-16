import { describe, expect, it } from 'vitest';
import type { RunOutcome } from '../../src/content-model/types';
import { checkSample, comparable } from './checks';
import { parseFenceMeta } from './meta';
import { canonicalUb } from './ub';
import type { VerifiedTargetResult } from './types';

const ok = (stdout: string, extra: Partial<RunOutcome> = {}): RunOutcome => ({ stdout, stderr: '', exit: 0, signal: null, ...extra });
const crash = (signal = 'SIGSEGV'): RunOutcome => ({ stdout: '', stderr: 'Segmentation fault', exit: null, signal });

describe('canonicalUb', () => {
  it('stores no raw output, and the same canonical form whatever the garbage was', () => {
    const a = canonicalUb([ok('1375595416\n'), ok('1653638552\n'), ok('-971979816\n')]);
    const b = canonicalUb([ok('11\n'), ok('22\n'), ok('33\n')]);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toMatch(/\d{5}/);
    expect(a.run).toEqual({ stdout: '', stderr: '', exit: 0 });
    expect(a.observed).toEqual([{ stdout: '', stderr: '', exit: 0 }]);
  });

  it('records the number of runs and the outcome categories only (the count of distinct values is nondeterministic)', () => {
    expect(canonicalUb([ok('1\n'), ok('2\n'), ok('3\n')]).ub).toEqual({ runs: 3, outcomes: ['runs'] });
    // The same canonical result whether the garbage repeated or not: this is what keeps the generated files stable.
    expect(canonicalUb([ok('6\n'), ok('6\n'), ok('6\n')])).toEqual(canonicalUb([ok('6\n'), ok('7\n'), ok('8\n')]));
  });

  it('the set of outcome categories does not depend on the order of the runs', () => {
    const one = canonicalUb([ok('1\n'), crash(), ok('2\n')]);
    const two = canonicalUb([crash(), ok('9\n'), ok('8\n')]);
    expect(one.ub.outcomes).toEqual(['runs', 'runtime-error']);
    expect(one.observed).toEqual(two.observed);
    expect(one.run).toEqual(two.run);
    expect(one.observed).toHaveLength(2);
    expect(one.observed.find(r => r.signal)).toEqual({ stdout: '', stderr: '', exit: null, signal: 'SIGSEGV' });
  });

  it('keeps exit codes, traps and timeouts, which are outcomes rather than garbage', () => {
    const c = canonicalUb([{ stdout: 'x', stderr: '', exit: 3, signal: null }, { stdout: '', stderr: 'boom', exit: null, signal: null, trap: 'unreachable' }, { stdout: '', stderr: '', exit: null, signal: null, timedOut: true }]);
    expect(c.ub.outcomes).toEqual(['exit:3', 'runtime-error']);
    expect(c.observed).toEqual(expect.arrayContaining([
      { stdout: '', stderr: '', exit: 3 },
      { stdout: '', stderr: '', exit: null, trap: 'unreachable' },
      { stdout: '', stderr: '', exit: null, timedOut: true },
    ]));
  });

  it('never keeps stdoutDisplay', () => {
    expect(JSON.stringify(canonicalUb([ok('0x1\n', { stdoutDisplay: '0x7ffc0000\n' })]))).not.toContain('stdoutDisplay');
  });

  it('is what the checks compare: the outcome set, via comparable() and checkSample()', () => {
    const target = (t: 'linux-x86_64-gcc13' | 'linux-x86_64-clang22' | 'wasm32-clang22', runs: RunOutcome[]): VerifiedTargetResult =>
      ({ target: t, compiler: 'c', compile: { ok: true, diagnostics: [], raw: '' }, ...canonicalUb(runs) });
    const gcc = target('linux-x86_64-gcc13', [ok('1\n'), ok('2\n'), ok('3\n')]);
    expect(comparable(parseFenceMeta('id=u expect=ub').meta!, gcc)).toBe('outcomes: runs');
    const { meta, ext } = parseFenceMeta('id=u expect=ub predict=outcome');
    const res = { 'linux-x86_64-gcc13': gcc, 'linux-x86_64-clang22': target('linux-x86_64-clang22', [ok('4\n'), ok('4\n'), ok('4\n')]), 'wasm32-clang22': target('wasm32-clang22', [ok('0\n'), ok('0\n'), ok('0\n')]) };
    const r = checkSample({ id: 'u', code: 'c', meta: meta!, ext, results: res });
    expect(r).toMatchObject({ problems: [], flagged: false, answer: { stdout: '', outcome: 'runs', native: { stdout: '', outcome: 'runs' } } });
  });
});
