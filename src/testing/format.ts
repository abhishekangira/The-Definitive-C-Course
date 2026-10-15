// Plain-text rendering of test results, shared by check.mjs and tools/exercises. The app renders
// the same structured TestResult fields with React instead. No colours here: each line carries a
// tone that the caller maps to colours (or ignores).
import { escapeForDisplay } from './compare';
import type { TestResult } from './runner';

export type Tone = 'plain' | 'dim' | 'bad' | 'good' | 'hint';

export interface Line {
  text: string;
  tone?: Tone;
  /** Unit subtests: draw a ✓/✗ mark before the text. */
  mark?: 'pass' | 'fail';
  /** Extra indentation level (subtest messages). */
  indent?: number;
}

/** Above this many characters, a mismatch shows only the differing line with a caret. */
const FULL_TEXT_LIMIT = 160;

function caretLine(prefix: string, line: string, column: number): string {
  // Width of the escaped text before the differing character, plus the opening quote.
  const before = escapeForDisplay(line.slice(0, column - 1), 10_000).length - 1;
  return ' '.repeat(prefix.length + before) + '^';
}

/**
 * Lines that explain a failed or skipped result (nothing for a pass).
 * @param hintTiers how many hint tiers to include (default 1; 0 hides hints)
 */
export function describeResult(r: TestResult, hintTiers = 1): Line[] {
  if (r.status === 'pass') return [];
  const out: Line[] = [];
  if (r.status === 'skip') {
    if (r.message) out.push({ text: r.message, tone: 'dim' });
    return out;
  }
  if (r.command) out.push({ text: `ran:       ${r.command}${r.stdin !== undefined ? `   with input ${escapeForDisplay(r.stdin, 80)}` : ''}`, tone: 'dim' });
  if (r.message) out.push({ text: r.message, tone: 'bad' });

  if (r.stream === 'stdout' || r.stream === 'stderr') {
    const actual = r.actual ?? '';
    if (r.how === 'exactly' && r.firstDiff && (r.expected ?? '').length + actual.length > FULL_TEXT_LIMIT * 2) {
      const d = r.firstDiff;
      const e = `line ${d.line} expected: `;
      const a = `line ${d.line} actual:   `;
      out.push({ text: e + escapeForDisplay(d.expectedLine, 200) });
      out.push({ text: a + escapeForDisplay(d.actualLine, 200) });
      if (d.column <= 200) out.push({ text: caretLine(a, d.actualLine, d.column), tone: 'bad' });
    } else if (r.how === 'exactly') {
      out.push({ text: `expected:  ${escapeForDisplay(r.expected ?? '')}` });
      out.push({ text: `actual:    ${actual === '' ? '"" (no output)' : escapeForDisplay(actual)}` });
      const d = r.firstDiff;
      if (d && r.expected && d.line === 1 && !r.expected.slice(0, d.index).includes('\n') && d.index < 200) {
        out.push({ text: caretLine('actual:    ', actual, d.column), tone: 'bad' });
      }
    } else {
      out.push({ text: `actual ${r.stream}: ${actual === '' ? '"" (no output)' : escapeForDisplay(actual)}` });
    }
  }
  for (const s of r.subtests ?? []) {
    out.push({ text: s.name, mark: s.status, tone: s.status === 'fail' ? 'bad' : 'plain' });
    if (s.status === 'fail' && s.message) out.push({ text: s.message, indent: 1, tone: 'dim' });
  }
  for (const d of r.details ?? []) out.push({ text: d, tone: 'dim' });
  (r.hints ?? []).slice(0, hintTiers).forEach((h, i) => out.push({ text: `hint${i ? ` ${i + 1}` : ''}: ${h}`, tone: 'hint' }));
  return out;
}
