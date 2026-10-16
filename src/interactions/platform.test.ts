import { describe, expect, it } from 'vitest';
import type { RunOutcome, SampleResult } from '../content-model/types';
import { storedOutputText, UB_OUTPUT_NOTE } from './platform';

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
