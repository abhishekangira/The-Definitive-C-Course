import { describe, expect, it } from 'vitest';
import type { RunOutcome, SampleResult } from '../content-model/types';
import { applyMatch, outputDiff, predictionVerdict, storedOutputText, UB_OUTPUT_NOTE, type DiffRow } from './platform';

const sample = (meta: Partial<SampleResult['meta']>): SampleResult => ({
  id: 's', module: 'm', lesson: 'l', code: '', meta: { id: 's', ...meta }, hash: 'h', results: {}, flagged: false, answer: { stdout: '', outcome: 'runs' },
});
const run = (stdout: string, extra: Partial<RunOutcome> = {}): RunOutcome => ({ stdout, stderr: '', exit: 0, ...extra });

describe('storedOutputText', () => {
  it('shows stored output, preferring the display rendering', () => {
    expect(storedOutputText(sample({}), run('hi\n'))).toBe('hi\n');
    expect(storedOutputText(sample({}), run('<addr1>\n', { stdoutDisplay: '0x1000\n' }))).toBe('0x1000\n');
  });
  it('says so when a normal sample printed nothing, and shows a dash without a run', () => {
    expect(storedOutputText(sample({}), run(''))).toBe('(no output)');
    expect(storedOutputText(sample({}), undefined)).toBe('—');
  });
  it('never shows output for an expect=ub sample, even when the data holds some', () => {
    const t = storedOutputText(sample({ expect: 'ub' }), run('1866272040\n', { stdoutDisplay: '1866272040\n' }));
    expect(t).toBe(UB_OUTPUT_NOTE);
    expect(t).not.toMatch(/\d{5}/);
    expect(storedOutputText(sample({ expect: 'ub' }), run(''))).toBe(UB_OUTPUT_NOTE);
  });
});

const NL = '\n';

describe('predictionVerdict', () => {
  const actual = `3 -3 1${NL}3.5`;
  // Every row of the issue table. Case matters, and tokens are not joined characters (`31` is not `3 1`).
  const rows: Array<[string, string, 'exact' | 'close' | 'wrong']> = [
    [actual, actual, 'exact'],
    [`3, -3, 1${NL}3.5`, actual, 'close'],
    [`3  -3 1${NL}3.5`, actual, 'close'],
    ['3 -3 1 3.5', actual, 'close'],
    [`[3, -3, 1]${NL}3.5`, actual, 'close'],
    ['x=5', 'x = 5', 'close'],
    ['31', '3 1', 'wrong'],
    ['Hello', 'hello', 'wrong'],
    ['3.50', '3.5', 'wrong'],
    ['3.0', '3.5', 'wrong'],
    [`1 -3 3${NL}3.5`, actual, 'wrong'],
    [',,', '', 'wrong'],
  ];
  it.each(rows)('%j vs %j is %s', (pred, got, verdict) => {
    expect(predictionVerdict(pred, got)).toBe(verdict);
  });

  it('ignores trailing spaces and a trailing blank line, and never calls a tokenless prediction close', () => {
    expect(predictionVerdict(`3 -3 1  ${NL}3.5  ${NL}`, `${actual}${NL}`)).toBe('exact');
    expect(predictionVerdict('', actual)).toBe('wrong');
    expect(predictionVerdict('   \n', actual)).toBe('wrong');
    expect(predictionVerdict(';;', ';;')).toBe('exact');
    expect(predictionVerdict(',,', ';;')).toBe('wrong');
  });

  it('match=exact turns close into wrong and leaves exact and wrong alone', () => {
    expect(applyMatch('close', 'exact')).toBe('wrong');
    expect(applyMatch('close', 'close')).toBe('close');
    expect(applyMatch('close', undefined)).toBe('close');
    expect(applyMatch('exact', 'exact')).toBe('exact');
    expect(applyMatch('wrong', 'exact')).toBe('wrong');
  });
});

const marked = (rows: DiffRow[]) => rows.flatMap(r => r.chunks.filter(c => c.mark).map(c => c.text)).join('');

describe('outputDiff', () => {
  it('marks the extra commas on the prediction and leaves the actual line plain', () => {
    const d = outputDiff('3, -3, 1', '3 -3 1');
    expect(marked(d.predicted)).toBe(',,');
    expect(marked(d.actual)).toBe('');
    expect(d.predicted[0].chunks.filter(c => !c.mark).map(c => c.text).join('')).toBe('3 -3 1');
  });

  it('marks a missing line on the side that has it, and a gap on the other', () => {
    const d = outputDiff('3 -3 1\n3.5', '3 -3 1');
    expect(d.predicted.map(r => r.gap)).toEqual([false, false]);
    expect(d.actual.map(r => ({ gap: r.gap, blank: r.blank }))).toEqual([{ gap: false, blank: false }, { gap: true, blank: false }]);
    expect(marked([d.predicted[0]])).toBe('');
    expect(marked([d.predicted[1]])).toBe('3.5');
  });

  it('marks an extra blank line in the middle with blank on both sides', () => {
    const d = outputDiff('3 -3 1\n\n3.5', '3 -3 1\n3.5');
    expect(d.predicted[1]).toMatchObject({ gap: false, blank: true });
    expect(d.actual[1]).toMatchObject({ gap: true, blank: true });
    expect(d.predicted[2].chunks).toEqual([{ text: '3.5', mark: false }]);
    expect(d.actual[2].chunks).toEqual([{ text: '3.5', mark: false }]);
  });

  it('reports an empty prediction, and marks every actual line', () => {
    const d = outputDiff('   \n', '3 -3 1\n3.5');
    expect(d.predictedEmpty).toBe(true);
    expect(d.actualEmpty).toBe(false);
    expect(d.predicted).toEqual([]);
    expect(d.actual.map(r => r.chunks)).toEqual([[{ text: '3 -3 1', mark: true }], [{ text: '3.5', mark: true }]]);
    expect(outputDiff('', '  \n')).toEqual({ predictedEmpty: true, actualEmpty: true, predicted: [], actual: [] });
  });

  it('marks a line over 2,000 characters whole, and only the changed character at 2,000', () => {
    const over = 'a'.repeat(2001);
    const overB = 'b' + 'a'.repeat(2000);
    const whole = outputDiff(over, overB);
    expect(whole.predicted[0].chunks).toEqual([{ text: over, mark: true }]);
    expect(whole.actual[0].chunks).toEqual([{ text: overB, mark: true }]);
    const atCapA = `${'a'.repeat(1999)}X`;
    const atCapB = `${'a'.repeat(1999)}Y`;
    expect(atCapA).toHaveLength(2000);
    const fine = outputDiff(atCapA, atCapB);
    expect(fine.predicted[0].chunks.filter(c => c.mark).map(c => c.text)).toEqual(['X']);
    expect(fine.actual[0].chunks.filter(c => c.mark).map(c => c.text)).toEqual(['Y']);
  });

  it('stays linear past the cap: 4N is not quadratic in N', () => {
    // Both lines are longer than the 2,000 cap, so the character LCS is skipped. Removing the cap makes 4N
    // about 16× N. Best of 3, and the floor of 5 ms keeps a near-zero N from turning noise into a failure.
    const best = (n: number) => Math.min(...[0, 1, 2].map(() => {
      const pred = 'a'.repeat(n);
      const got = `${'b'.repeat(n)}`;
      const t0 = performance.now();
      outputDiff(pred, got);
      return performance.now() - t0;
    }));
    const small = best(3_000);
    const big = best(12_000);
    expect(big).toBeLessThan(Math.max(small, 5) * 9);
    expect(big).toBeLessThan(10_000);
  });
});
