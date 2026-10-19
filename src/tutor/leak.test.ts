import { describe, expect, it } from 'vitest';
import { guardReply, leakRefusal, stripCComments } from './leak';
import { learnerVisibleText } from './prompt';
import realReplies from './fixtures/real-replies.json';

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

// Replies captured from the live API (gpt-oss-120b through OpenRouter). The guard used to refuse each one,
// although none gives the solution away: they quote what the learner already has on screen.
describe('real replies that only repeat what the learner can already read', () => {
  const visible = (c: (typeof realReplies.cases)[number]) => learnerVisibleText({ statement: c.statement, diagnostics: '', openedHints: [], results: c.results, bank: c.bank });
  const guard = (c: (typeof realReplies.cases)[number], extra = '') => guardReply({
    reply: c.reply + extra, solution: c.solution, learnerCode: c.learnerCode, hintsViewed: 0, knownText: visible(c), bankText: c.bank,
  });

  for (const c of realReplies.cases) {
    it(`passes a reply that ${c.name}`, () => {
      const guarded = guard(c);
      expect(guarded.blocked, c.why).toBe(false);
      expect(guarded.show).toBe(c.reply);
    });
  }

  const byExercise = (name: string) => realReplies.cases.find(c => c.name.includes(name))!;

  it('passes the parenthesised expected output only because what is inside the parentheses is on screen', () => {
    const c = byExercise('in parentheses');
    expect(guardReply({ reply: c.reply, solution: c.solution, learnerCode: c.learnerCode, hintsViewed: 0 }).blocked, 'nothing known: refused').toBe(true);
    expect(guard(c).blocked).toBe(false);
  });

  it('still refuses the same replies once a solution fragment the learner cannot read is added', () => {
    const hello = byExercise('wrong printf');
    expect(guard(hello, '\n\nUse printf("hello, world\\n");').blocked).toBe(true);
    const pyramid = byExercise('loop header');
    const widened = guard(pyramid, '\nSo write for (int row = 1; row <= height; row++) instead.');
    expect(widened.blocked).toBe(true);
    expect(widened.reason).toBe('solution-line');
  });

  it('refuses the boilerplate lines of a write-the-code exercise whose bank the learner cannot see', () => {
    const parsons = byExercise('Parsons');
    const withoutBank = guardReply({ reply: parsons.reply, solution: parsons.solution, learnerCode: parsons.learnerCode, hintsViewed: 0 });
    expect(withoutBank.blocked).toBe(true);
    expect(withoutBank.reason).toBe('solution-line');
  });
});

// Found by an independent red team (see the PR). Every case below got past the guard before.
describe('replies that hide a solution line from the comparison', () => {
  const sol = [
    '#include <stdio.h>', 'int main(void) {', '    int height;', '    do {', '        height = get_int("Height: ");',
    '    } while (height < 1 || height > 8);', '    int best = a;', '    coins += cents / 5;', '    printf("hello, world\\n");', '    return 0;', '}', '',
  ].join('\n');
  const mine = ['#include <stdio.h>', 'int main(void) {', '    return 0;', '}', ''].join('\n');
  const guard = (reply: string) => guardReply({ reply, solution: sol, learnerCode: mine, hintsViewed: 0 });

  it('sees through typographic quotes, which models write all the time', () => {
    const g = guard('Try printf(\u201Chello, world\\n\u201D);');
    expect(g.blocked).toBe(true);
    expect(g.reason).toBe('solution-line');
  });

  it('sees through invisible characters of any kind, not only zero-width spaces', () => {
    for (const hidden of ['\u2061', '\u2062', '\u034F', '\u3164', '\uFE0F', '\u{E0020}']) {
      const line = '} while (height < 1 || height > 8);'.split('').join(hidden);
      expect(guard(line).blocked, JSON.stringify(hidden)).toBe(true);
    }
  });

  it('compares the reply as it is rendered: links show only their label, and escapes keep their text', () => {
    expect(guard('} [while](#) ([height](#) < 1 || [height](#) > 8);').blocked).toBe(true);
    expect(guard('} while \\(height < 1 || height > 8\\);').blocked).toBe(true);
  });

  it('refuses text stored in one order and shown in another (a bidi override)', () => {
    expect(guard('\u202E;)8 > thgieh || 1 < thgieh( elihw }\u202C')).toMatchObject({ blocked: true, reason: 'hidden-text' });
  });

  it('folds Cyrillic and Greek lookalikes to Latin, so a lookalike spelling still matches the solution line', () => {
    expect(guard('coins += c\u0435nts / 5;')).toMatchObject({ blocked: true, reason: 'solution-line' });
    expect(guard('c\u03BFins += cents / 5;')).toMatchObject({ blocked: true, reason: 'solution-line' });
    expect(guard('c\u043Eins += c\u0435nts / 5;  c\u0435nts %= 5;')).toMatchObject({ blocked: true });
  });

  it('does not refuse benign math symbols, units or right-to-left prose that wraps code in isolates', () => {
    expect(guard('The timing error is about \u0394t, \u03C0r matters for the area, and \u03B5 is tiny.').blocked).toBe(false);
    expect(guard('\u05D4\u05E4\u05D5\u05E0\u05E7\u05E6\u05D9\u05D4 \u2066printf\u2069 \u05DE\u05D3\u05E4\u05D9\u05E1\u05D4 \u05D8\u05E7\u05E1\u05D8. \u05DE\u05D4 \u05D7\u05E1\u05E8?').blocked).toBe(false);
  });

  it('is not fooled by an unbalanced quote that would switch off comment stripping', () => {
    expect(guard('Try: "int /**/ best /**/ = /**/ a;').blocked).toBe(true);
    expect(guard('Try: "} /**/ while /**/ (height < 1 || height > 8);').blocked).toBe(true);
  });

  it('counts a block that a ~~~ line appears to split as one block', () => {
    const split = 'Here:\n```c\nint a;\nint b;\nint c;\n~~~\nint d;\nint e;\nint f;\n```';
    expect(guard(split)).toMatchObject({ blocked: true, reason: 'code-block' });
  });

  it('leaves ordinary non-English prose, a micro sign and a link to the docs alone', () => {
    expect(guard('\u0412\u0430\u0448\u0430 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430 \u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442 hello \u0431\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u043E\u0439. \u0427\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C?').blocked).toBe(false);
    expect(guard('The call takes about 5 \u00B5s, so look at the loop instead.').blocked).toBe(false);
    expect(guard('See [the docs](https://example.com/x) for how printf formats its output.').blocked).toBe(false);
  });

  it('does not let one apostrophe in the prose switch off comment stripping for the rest of the line', () => {
    expect(guard("Here's it: int /* c */ best = a;").blocked).toBe(true);
    expect(guard("It's fine: char c = 'x'; and it's ok.").blocked).toBe(false);
  });

  it('refuses a parenthesised fragment whose inside is not on screen', () => {
    const tail = guardReply({
      reply: 'The condition should read `(guests < 1 || guests > 10)`.', hintsViewed: 0, learnerCode: mine,
      solution: ['int main(void) {', '    do { n = get_int("n: "); }', '    } while (guests < 1 || guests > 10);', '}', ''].join('\n'),
    });
    expect(tail).toMatchObject({ blocked: true, reason: 'solution-line' });
  });
});

describe('a Parsons bank: every line is known, the order is the answer', () => {
  const bank = ['#include <stdio.h>', 'int main(void) {', '    for (int i = 3; i > 0; i--) {', '        printf("%d...\\n", i);', '    }', '    printf("Liftoff!\\n");', '    return 0;', '}', '    return 1;'].join('\n');
  const solution = ['#include <stdio.h>', 'int main(void) {', '    for (int i = 3; i > 0; i--) {', '        printf("%d...\\n", i);', '    }', '    printf("Liftoff!\\n");', '    return 0;', '}', ''].join('\n');
  const guard = (reply: string) => guardReply({ reply, solution, learnerCode: '    printf("%d...\\n", i);', hintsViewed: 0, knownText: bank, bankText: bank });

  it('refuses a numbered list of bank lines in solution order, with no fence and no code-looking line ends', () => {
    const order = 'The order is:\n1. `#include <stdio.h>`\n2. `int main(void) {`\n3. `for (int i = 3; i > 0; i--) {`\n4. `printf("%d...\\n", i);`\n5. `}`\n6. `printf("Liftoff!\\n");`\n7. `return 0;`\n8. `}`';
    expect(guard(order)).toMatchObject({ blocked: true });
    const prose = 'First the include, then main, then the for header, then the printf of the counter, then Liftoff. '
      + 'So: #include <stdio.h> ... int main(void) { ... for (int i = 3; i > 0; i--) { ... printf("Liftoff!\\n"); ...';
    expect(guard(prose)).toMatchObject({ blocked: true, reason: 'solution-order' });
  });

  it('refuses the bank lines listed from last to first', () => {
    const reversed = 'From the bottom up: `return 0;` then `printf("Liftoff!\\n");` then `printf("%d...\\n", i);` then `for (int i = 3; i > 0; i--) {` then `#include <stdio.h>`.';
    expect(guard(reversed)).toMatchObject({ blocked: true, reason: 'solution-order' });
  });

  it('allows naming one or two bank lines, four lines in no order, and a recap of lines the learner already placed', () => {
    expect(guard('Start from `#include <stdio.h>` and then `int main(void) {`. Which line repeats?').blocked).toBe(false);
    expect(guard('Think about `int main(void) {` and `return 0;` and `#include <stdio.h>` and `printf("Liftoff!\\n");` in that jumble.').blocked).toBe(false);
    const placed = guardReply({
      reply: 'You have `#include <stdio.h>`, `int main(void) {`, `for (int i = 3; i > 0; i--) {` and `printf("%d...\\n", i);` in the right order. What comes next?',
      solution, hintsViewed: 0, knownText: bank, bankText: bank,
      learnerCode: '#include <stdio.h>\nint main(void) {\n    for (int i = 3; i > 0; i--) {\n        printf("%d...\\n", i);',
    });
    expect(placed.blocked).toBe(false);
  });

  it('does nothing without a bank: a write-the-code exercise has no order to protect', () => {
    const noBank = guardReply({ reply: 'The order is #include <stdio.h> int main(void) { for (int i = 3; i > 0; i--) { printf("Liftoff!\\n");', solution, learnerCode: '#include <stdio.h>\nint main(void) {\n    for (int i = 3; i > 0; i--) {\n    }\n    printf("Liftoff!\\n");\n}', hintsViewed: 0 });
    expect(noBank.reason).not.toBe('solution-order');
  });
});
