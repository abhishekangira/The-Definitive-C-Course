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

  it('strips comments without eating a string, a URL, or the text after an unterminated comment', () => {
    expect(stripCComments('printf("http://x"); // no\n')).toBe('printf("http://x"); \n');
    expect(stripCComments('int /* c */ x;')).toBe('int   x;');
    expect(stripCComments('see https://x.dev then int x;\n')).toBe('see https://x.dev then int x;\n');
    // An unterminated block comment does not swallow the following lines.
    expect(stripCComments('/* unterminated\nint x;\n')).toContain('int x;');
  });

  it('refuses a solution line hidden by comments, URLs, case, width, markdown or concatenation', () => {
    const total = 'int total = a + b + carry;\n';
    const cases: Array<[string, string]> = [
      ['// printf("hello, world\\n");', solution],
      ['// #include <stdio.h>\n// int main(void) {\n//     printf("hello, world\\n");\n//     return 0;\n// }', solution],
      ['See https://x.dev then int total = a + b + carry;', total],
      ['/* still open\nprintf("hello, world\\n");', solution],
      ['Printf("hello, world\\n");', solution],
      ['INT TOTAL = A + B + CARRY;', total],
      ['printf(\u200b"hello, world\\n");', solution],
      ['int\u200b total = a + b + carry;', total],
      [fullwidth('printf("hello, world\\n");'), solution],
      [fullwidth('int total = a + b + carry;'), total],
      ['printf("hello, " "world\\n");', solution],
      ['**int total** = a + b + carry;', total],
      ['`int total` = `a + b + carry;`', total],
      ['printf(/* same */"hello, world\\n");', solution],
    ];
    for (const [reply, sol] of cases) {
      const guarded = guardReply({ reply, solution: sol, learnerCode: learner, hintsViewed: 0 });
      expect(guarded.blocked, reply).toBe(true);
      expect(guarded.reason === 'solution-line' || guarded.reason === 'code-block', reply).toBe(true);
      expect(guarded.show, reply).toBe(leakRefusal(0));
      expect(guarded.show, reply).not.toContain('printf');
      expect(guarded.show, reply).not.toContain('total');
      expect(guarded.show, reply).not.toContain('hello, world');
    }
  });

  it('refuses short solution lines and a blank-line-separated run of statements', () => {
    const short = 'n = 0;\np++;\nreturn;\n';
    const fenced = '```c\nn = 0;\np++;\nreturn;\n```';
    const guarded = guardReply({ reply: fenced, solution: short, learnerCode: '', hintsViewed: 1 });
    expect(guarded.blocked).toBe(true);
    expect(guarded.show).toBe(leakRefusal(1));
    expect(guarded.show).not.toContain('return');

    const spaced = ['int a1;', '', 'int a2;', '', 'int a3;', '', 'int a4;'].join('\n');
    const run = guardReply({ reply: spaced, solution: 'int unrelated_function(void);\n', learnerCode: '', hintsViewed: 0 });
    expect(run.reason).toBe('code-block');
    expect(run.show).not.toContain('int a1');

    const indented = ['    if (x)', '        foo(x)', '        bar(x)', '        baz(x)', '    done(x)'].join('\n');
    expect(guardReply({ reply: indented, solution: 'int unrelated_function(void);\n', learnerCode: '', hintsViewed: 0 }).reason).toBe('code-block');

    const tildes = '~~~\nint a;\nint b;\nint c;\nint d;\n~~~';
    expect(guardReply({ reply: tildes, solution: 'int unrelated_function(void);\n', learnerCode: '', hintsViewed: 0 }).reason).toBe('code-block');
  });
});

function fullwidth(text: string): string {
  return text.replace(/[!-~]/g, ch => String.fromCodePoint(ch.charCodeAt(0) + 0xFEE0));
}
