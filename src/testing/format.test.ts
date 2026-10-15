import { describe, expect, it } from 'vitest';
import { firstDifference } from './compare';
import { describeResult } from './format';
import type { TestResult } from './runner';

describe('describeResult', () => {
  it('shows ran/expected/actual with a caret under the first difference', () => {
    const expected = 'ciphertext: yxocll\n';
    const actual = 'ciphertext: yx\udc89}\udc86\udc86\n';
    const r: TestResult = {
      name: 'x', kind: 'io', status: 'fail', command: './caesar 23', stdin: 'barfoo\n', stream: 'stdout', how: 'exactly',
      expected, actual, firstDiff: firstDifference(expected, actual), message: 'wrong output: …', hints: ['wrap with %', 'tier 2'],
    };
    expect(describeResult(r).map(l => l.text)).toEqual([
      'ran:       ./caesar 23   with input "barfoo\\n"',
      'wrong output: …',
      'expected:  "ciphertext: yxocll\\n"',
      'actual:    "ciphertext: yx\\x89}\\x86\\x86\\n"',
      '                          ^',
      'hint: wrap with %',
    ]);
    expect(describeResult(r, 2).at(-1)!.text).toBe('hint 2: tier 2');
  });
  it('shows only the differing line of long output', () => {
    const expected = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const actual = expected.replace('line 30', 'line 3O');
    const r: TestResult = { name: 'x', kind: 'io', status: 'fail', stream: 'stdout', how: 'exactly', expected, actual, firstDiff: firstDifference(expected, actual) };
    expect(describeResult(r).map(l => l.text)).toEqual(['line 31 expected: "line 30"', 'line 31 actual:   "line 3O"', '                         ^']);
  });
  it('lists subtests and details, and nothing for a pass', () => {
    const r: TestResult = { name: 'u', kind: 'unit', status: 'fail', message: '1 of 2 checks failed', subtests: [{ name: 'a', status: 'pass' }, { name: 'b', status: 'fail', message: 'expected 1, got 2' }] };
    expect(describeResult(r)).toEqual([
      { text: '1 of 2 checks failed', tone: 'bad' },
      { text: 'a', mark: 'pass', tone: 'plain' },
      { text: 'b', mark: 'fail', tone: 'bad' },
      { text: 'expected 1, got 2', indent: 1, tone: 'dim' },
    ]);
    expect(describeResult({ name: 'p', kind: 'io', status: 'pass' })).toEqual([]);
  });
});
