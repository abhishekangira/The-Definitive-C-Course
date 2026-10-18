import { describe, expect, it } from 'vitest';
import { guardReply, leakRefusal, stripCComments } from './leak';

const solution = [
  '#include <stdio.h>',
  '',
  'int main(void) {',
  '    printf("hello, world\\n"); // the greeting',
  '    return 0;',
  '}',
  '',
].join('\n');

const learner = [
  '#include <stdio.h>',
  '',
  'int main(void) {',
  '    return 0;',
  '}',
  '',
].join('\n');

describe('guardReply', () => {
  it('blocks a solution line the learner does not have, ignoring whitespace and comments', () => {
    const leaked = 'Try this: printf( "hello, world\\n" ); /* same line */';
    const guarded = guardReply({ reply: leaked, solution, learnerCode: learner, hintsViewed: 0 });
    expect(guarded.blocked).toBe(true);
    expect(guarded.reason).toBe('solution-line');
    expect(guarded.show).toBe(leakRefusal(0));
    expect(guarded.show).not.toContain('printf');
    expect(guarded.show).toContain('Open hint 1 (a nudge)');
  });

  it('passes a reply that only repeats lines the learner already has', () => {
    const reply = 'Your main already ends with `return 0;` and includes stdio. The body of main does nothing else.';
    const guarded = guardReply({ reply, solution, learnerCode: learner, hintsViewed: 1 });
    expect(guarded).toEqual({ show: reply, blocked: false });
  });

  it('blocks a fenced block longer than three lines, and a run of four statements', () => {
    const fence = '```c\nint a;\nint b;\nint c;\nint d;\n```';
    expect(guardReply({ reply: fence, solution: 'int only;\n', learnerCode: '', hintsViewed: 2 }).reason).toBe('code-block');
    expect(guardReply({ reply: fence, solution: 'int only;\n', learnerCode: '', hintsViewed: 2 }).show).toContain('Open hint 3');
    const three = '```c\nint a;\nint b;\nint c;\n```';
    expect(guardReply({ reply: three, solution: 'int unrelated_function(void);\n', learnerCode: learner, hintsViewed: 0 }).blocked).toBe(false);
    const run = ['int a;', 'int b;', 'int c;', 'int d;'].join('\n');
    expect(guardReply({ reply: run, solution: 'int unrelated_function(void);\n', learnerCode: '', hintsViewed: 3 }).reason).toBe('code-block');
    expect(guardReply({ reply: run, solution: 'int unrelated_function(void);\n', learnerCode: '', hintsViewed: 3 }).show).toContain('Every hint is already open');
  });

  it('strips comments without eating a string', () => {
    expect(stripCComments('printf("http://x"); // no\n')).toBe('printf("http://x"); \n');
    expect(stripCComments('int /* c */ x;')).toBe('int   x;');
  });
});
