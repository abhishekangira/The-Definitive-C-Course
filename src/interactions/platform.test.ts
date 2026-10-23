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

  it('marks an extra blank line only on the predicted side, with a plain gap opposite it', () => {
    const d = outputDiff('3 -3 1\n\n3.5', '3 -3 1\n3.5');
    expect(d.predicted[1]).toMatchObject({ gap: false, blank: true });
    expect(d.actual[1]).toMatchObject({ gap: true, blank: false, chunks: [] });
    expect(d.predicted[2].chunks).toEqual([{ text: '3.5', mark: false }]);
    expect(d.actual[2].chunks).toEqual([{ text: '3.5', mark: false }]);
  });

  it('marks a missing blank line only on the actual side, with a plain gap opposite it', () => {
    const d = outputDiff('3 -3 1\n3.5', '3 -3 1\n\n3.5');
    expect(d.predicted[1]).toMatchObject({ gap: true, blank: false, chunks: [] });
    expect(d.actual[1]).toMatchObject({ gap: false, blank: true });
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

  it('aligns a blank insert at 4,000,000 line cells, and above that one insert marks every later line', () => {
    // Distinct lines, so index pairing cannot look like a match. A leading blank line.
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `L${i}`);
    // 2000 × 2000 = 4_000_000, which still runs the line LCS. The blank is an empty-line gap and later lines match.
    const atPred = ['', ...lines(1999)];
    const atAct = [...lines(1999), 'tail'];
    expect(atPred.length * atAct.length).toBe(4_000_000);
    const atCap = outputDiff(atPred.join('\n'), atAct.join('\n'));
    expect(atCap.predicted[0]).toMatchObject({ gap: false, blank: true });
    expect(atCap.actual[0]).toMatchObject({ gap: true, blank: false });
    expect(atCap.predicted[1].chunks).toEqual([{ text: 'L0', mark: false }]);
    expect(atCap.actual[1].chunks).toEqual([{ text: 'L0', mark: false }]);
    expect(atCap.predicted[1999].chunks).toEqual([{ text: 'L1998', mark: false }]);
    expect(atCap.actual[1999].chunks).toEqual([{ text: 'L1998', mark: false }]);
    expect(atCap.predicted[2000]).toMatchObject({ gap: true, blank: false });
    expect(atCap.actual[2000].chunks).toEqual([{ text: 'tail', mark: true }]);

    // 2001 × 2000 = 4_002_000. Index pairing. The blank is paired with L0, so it loses the empty-line note,
    // and every later line is marked because the insert shifts them.
    const overPred = ['', ...lines(2000)];
    const overAct = lines(2000);
    expect(overPred.length * overAct.length).toBe(4_002_000);
    const over = outputDiff(overPred.join('\n'), overAct.join('\n'));
    expect(over.predicted).toHaveLength(2001);
    expect(over.predicted[0]).toMatchObject({ gap: false, blank: false });
    expect(over.predicted[0].chunks.map(c => c.text).join('')).toBe('');
    expect(over.actual[0].chunks).toEqual([{ text: 'L0', mark: true }]);
    for (let i = 1; i < 2000; i++) {
      expect(over.predicted[i].blank, `predicted ${i}`).toBe(false);
      expect(over.predicted[i].chunks.some(c => c.mark), `predicted ${i}`).toBe(true);
      expect(over.actual[i].chunks.some(c => c.mark), `actual ${i}`).toBe(true);
    }
    expect(over.predicted[2000].chunks.map(c => c.text).join('')).toBe('L1999');
    expect(over.predicted[2000].chunks.some(c => c.mark)).toBe(true);
    expect(over.actual[2000]).toMatchObject({ gap: true, blank: false });
  });

  it('falls back when only the actual side makes the line table exceed the cell cap', () => {
    // Predicted has 2,000 lines, which is not over the old per-side cap. Actual has 2,001.
    // 2000 × 2001 = 4_002_000, so the lines are paired by index. A check of only the predicted
    // length still runs the line LCS and aligns the inserted blank instead.
    const pred = Array.from({ length: 2000 }, (_, i) => `P${i}`);
    const actual = ['', ...pred];
    expect(pred.length).toBe(2000);
    expect(actual.length).toBe(2001);
    const d = outputDiff(pred.join('\n'), actual.join('\n'));
    expect(d.predicted[0].chunks.map(c => c.text).join('')).toBe('P0');
    expect(d.predicted[0].chunks.some(c => c.mark)).toBe(true);
    expect(d.predicted[0].blank).toBe(false);
    expect(d.actual[0].chunks.map(c => c.text).join('')).toBe('');
    expect(d.actual[0].blank).toBe(false);
    expect(d.predicted[1].chunks.some(c => c.mark)).toBe(true);
    expect(d.predicted[1999].chunks.map(c => c.text).join('')).toBe('P1999');
    expect(d.predicted[1999].chunks.some(c => c.mark)).toBe(true);
    expect(d.actual[2000].chunks.map(c => c.text).join('')).toBe('P1999');
    expect(d.predicted[2000]).toMatchObject({ gap: true });
  });

  it('still aligns a prediction of more than 2,000 lines with a 3-line actual', () => {
    // 2001 × 3 = 6,003 cells, under the budget. A cap on the longer side would pair by index and mark every line.
    const actual = ['one', 'two', 'three'];
    const pred = ['extra', ...actual, ...Array.from({ length: 1997 }, (_, i) => `u${i}`)];
    expect(pred).toHaveLength(2001);
    const d = outputDiff(pred.join('\n'), actual.join('\n'));
    expect(d.predicted[0].chunks).toEqual([{ text: 'extra', mark: true }]);
    expect(d.actual[0]).toMatchObject({ gap: true, blank: false });
    expect(d.predicted[1].chunks).toEqual([{ text: 'one', mark: false }]);
    expect(d.actual[1].chunks).toEqual([{ text: 'one', mark: false }]);
    expect(d.predicted[2].chunks).toEqual([{ text: 'two', mark: false }]);
    expect(d.actual[2].chunks).toEqual([{ text: 'two', mark: false }]);
    expect(d.predicted[3].chunks).toEqual([{ text: 'three', mark: false }]);
    expect(d.actual[3].chunks).toEqual([{ text: 'three', mark: false }]);
    expect(d.predicted[4].chunks).toEqual([{ text: 'u0', mark: true }]);
    expect(d.actual[4]).toMatchObject({ gap: true, blank: false });
  });

  it('marks later differing lines whole once the character-LCS budget is spent', () => {
    // Each 2,000-character pair costs 4_000_000 cells, the whole budget. The first pair still gets a
    // character diff. The next pair is marked whole. Without the budget both pairs mark only the last character.
    const line = (ch: string) => `${'a'.repeat(1999)}${ch}`;
    const d = outputDiff(`${line('X')}\n${line('P')}`, `${line('Y')}\n${line('Q')}`);
    expect(line('X')).toHaveLength(2000);
    expect(d.predicted[0].chunks.filter(c => c.mark).map(c => c.text)).toEqual(['X']);
    expect(d.actual[0].chunks.filter(c => c.mark).map(c => c.text)).toEqual(['Y']);
    expect(d.predicted[1].chunks).toEqual([{ text: line('P'), mark: true }]);
    expect(d.actual[1].chunks).toEqual([{ text: line('Q'), mark: true }]);
  });

  it('does not give the rest of the budget to a later smaller pair once one pair did not fit', () => {
    // 1,000 × 1,000 = 1,000,000 cells fits and leaves 3,000,000. 2,000 × 2,000 = 4,000,000 does not fit, so the
    // budget goes to 0, and the 3-character pair after it is marked whole although 9 cells would fit the remainder.
    const d = outputDiff(`${'a'.repeat(999)}X\n${'b'.repeat(1999)}P\nabc`, `${'a'.repeat(999)}Y\n${'b'.repeat(1999)}Q\nabd`);
    expect(d.predicted[0].chunks.filter(c => c.mark).map(c => c.text)).toEqual(['X']);
    expect(d.predicted[1].chunks).toEqual([{ text: `${'b'.repeat(1999)}P`, mark: true }]);
    expect(d.predicted[2].chunks).toEqual([{ text: 'abc', mark: true }]);
    expect(d.actual[2].chunks).toEqual([{ text: 'abd', mark: true }]);
  });

  it('a pair over 2,000 characters is marked whole without spending the character budget', () => {
    // 2,001 × 2,001 would be more than the whole budget. It is marked whole by the per-pair cap, and the
    // 2,000 × 2,000 pair after it (exactly the budget) still gets a character diff.
    const d = outputDiff(`${'c'.repeat(2000)}X\n${'a'.repeat(1999)}P`, `${'c'.repeat(2000)}Y\n${'a'.repeat(1999)}Q`);
    expect(d.predicted[0].chunks).toEqual([{ text: `${'c'.repeat(2000)}X`, mark: true }]);
    expect(d.predicted[1].chunks.filter(c => c.mark).map(c => c.text)).toEqual(['P']);
    expect(d.actual[1].chunks.filter(c => c.mark).map(c => c.text)).toEqual(['Q']);
  });

  it('stays bounded across many long lines: 4N lines is not N times a character LCS', () => {
    // Every line differs and is 2,000 characters, so each pair would be a full character LCS. The shared
    // budget pays for one pair and marks the rest whole, so 4N stays in the same band as N. Best of 3.
    // The floor of 5 ms keeps a near-zero N from turning noise into a failure. No budget makes 4N about 4× N.
    const best = (n: number) => {
      const pred = Array.from({ length: n }, () => 'a'.repeat(2000)).join('\n');
      const got = Array.from({ length: n }, () => 'b'.repeat(2000)).join('\n');
      return Math.min(...[0, 1, 2].map(() => {
        const t0 = performance.now();
        outputDiff(pred, got);
        return performance.now() - t0;
      }));
    };
    const small = best(50);
    const big = best(200);
    expect(big).toBeLessThan(Math.max(small, 5) * 3);
    expect(big).toBeLessThan(10_000);
  });

  it('stays linear past the line-alignment cap: 4N lines is not a quadratic line LCS', () => {
    // Every line differs and is one character, so the cost is the line alignment. Past the cell cap that
    // alignment is index pairing. Removing the cap makes 4N about 16× N. Best of 3, same floor as above.
    const best = (n: number) => Math.min(...[0, 1, 2].map(() => {
      const pred = `${'a\n'.repeat(n - 1)}a`;
      const got = `${'b\n'.repeat(n - 1)}b`;
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
