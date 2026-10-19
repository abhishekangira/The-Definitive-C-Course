import { describe, expect, it } from 'vitest';
import { buildTutorMessages, failingChecks, learnerVisibleText, openedHintTexts, skippedChecks, type ReportedCheck } from './prompt';

const HINTS = [
  'You need printf.',
  'Do not forget the newline the library does not add.',
  'Partial: printf("hello, world\\n");',
] as const;

const checks: ReportedCheck[] = [
  { status: 'pass', name: 'compiles', message: 'ok' },
  {
    status: 'fail', name: 'prints hello, world', command: './hello', stdin: '',
    expected: 'hello, world\n', actual: '', message: 'wrong output',
  },
  { status: 'skip', name: 'not run yet', message: 'skipped because the build failed' },
];

describe('opened hints', () => {
  it('returns only the tiers the learner has opened', () => {
    expect(openedHintTexts(HINTS, 0)).toEqual([]);
    expect(openedHintTexts(HINTS, 1)).toEqual([HINTS[0]]);
    expect(openedHintTexts(HINTS, 2)).toEqual([HINTS[0], HINTS[1]]);
    expect(openedHintTexts(HINTS, 3)).toEqual([...HINTS]);
    expect(openedHintTexts(HINTS, 9)).toEqual([...HINTS]);
    expect(openedHintTexts(HINTS, -1)).toEqual([]);
    expect(openedHintTexts(HINTS, Number.NaN)).toEqual([]);
  });
});

describe('failing checks', () => {
  it('keeps the real expected and actual output, including an empty print', () => {
    const failing = failingChecks(checks);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({
      name: 'prints hello, world',
      expected: 'hello, world\n',
      actual: '',
      detail: 'wrong output',
    });
    expect(failing[0].input).toContain('stdin: ""');
    expect(skippedChecks(checks)).toEqual(['not run yet']);
  });
});

describe('buildTutorMessages', () => {
  const base = {
    title: 'hello, world',
    statement: 'Print exactly hello, world and a newline.',
    code: 'int main(void) {\n    return 0;\n}\n',
    diagnostics: 'warning: unused',
    failing: failingChecks(checks),
    skipped: skippedChecks(checks),
    solution: 'printf("hello, world\\n");\n',
  };

  it('includes the real failing output and only the opened hint', () => {
    const messages = buildTutorMessages({ ...base, openedHints: openedHintTexts(HINTS, 1), question: 'nudge' });
    expect(messages, 'one user message carries the instructions and the exercise').toHaveLength(1);
    const [user] = messages;
    expect(user.role).toBe('user');
    expect(user.content).toContain("I'm not sure");
    expect(user.content).toContain('actual output: ""');
    expect(user.content).toContain(JSON.stringify('hello, world\n'));
    expect(user.content).toContain('warning: unused');
    expect(user.content).toContain('not run yet');
    expect(user.content).toContain(HINTS[0]);
    expect(user.content).not.toContain(HINTS[1]);
    expect(user.content).not.toContain(HINTS[2]);
    expect(user.content).toContain('NEVER REVEAL');
    expect(user.content).toContain('printf("hello, world\\n");');
    expect(user.content).toContain('Question: Give me a nudge.');
  });

  it('asks about the learner\'s sentence and still omits unopened hints', () => {
    const [user] = buildTutorMessages({
      ...base, openedHints: [], question: 'why', approach: 'I thought return printed the text.',
    });
    expect(user.content).toContain("Question: Why doesn't my approach work?");
    expect(user.content).toContain('I thought return printed the text.');
    expect(user.content).toContain('(none opened)');
    for (const h of HINTS) expect(user.content).not.toContain(h);
  });
});

describe('learnerVisibleText', () => {
  it('collects what the learner can already read, and only the hints that are open', () => {
    const text = learnerVisibleText({
      statement: 'Print exactly hello, world.', diagnostics: 'warning: unused variable',
      openedHints: openedHintTexts(HINTS, 1), results: checks, bank: '#include <stdio.h>\nint main(void) {',
    });
    for (const shown of ['Print exactly hello, world.', 'warning: unused variable', HINTS[0], JSON.stringify('hello, world\n').slice(1, -3), 'wrong output', 'int main(void) {']) {
      expect(text).toContain(shown.replace('\\n', '\n'));
    }
    expect(text).not.toContain(HINTS[1]);
    expect(text).not.toContain(HINTS[2]);
  });

  it('is empty-safe', () => {
    expect(learnerVisibleText({ statement: '', diagnostics: '', openedHints: [], results: [] }).trim()).toBe('');
  });
});
