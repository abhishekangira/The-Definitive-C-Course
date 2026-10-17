import { describe, expect, it } from 'vitest';
import { scanFunction, type ScanRules } from './scan';

const RULES: ScanRules = { function: 'bit_and', allow: ['~', '|'], maxOps: 4 };

/** The reference shape: x & y == ~(~x | ~y), four operators. */
const REFERENCE = `#include <stdint.h>
#include <stdio.h>

uint8_t other(uint8_t a) { return a + 1; }

uint8_t bit_and(uint8_t x, uint8_t y) {
  return ~(~x | ~y);
}

int main(void) { printf("%d\\n", bit_and(6, 3) & 1); return 0; }
`;

const withBody = (body: string) => `#include <stdint.h>
uint8_t bit_and(uint8_t x, uint8_t y) {
${body}
}
int main(void) { return 0; }
`;

describe('scanFunction: accepted code', () => {
  it('accepts the reference solution and counts its operators', () => {
    expect(scanFunction(REFERENCE, RULES)).toEqual({ ok: true, ops: 4 });
  });
  it('accepts a function that uses exactly maxOps operators and rejects one more', () => {
    expect(scanFunction(withBody('  return ~(~x | ~y);'), RULES).ok).toBe(true);
    const r = scanFunction(withBody('  return ~(~x | ~y | y);'), RULES);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('more than 4 operators');
  });
  it('lets the learner declare and use locals and braces', () => {
    const body = '  uint8_t a = ~x;\n  uint8_t b = ~y;\n  return ~(a | b);';
    expect(scanFunction(withBody(body), { ...RULES, maxOps: 5 })).toEqual({ ok: true, ops: 4 });
  });
  it('ignores operators and calls inside comments', () => {
    const body = '  /* x & y, if (x) abs(x) */\n  // return x && y;\n  return ~(~x | ~y);';
    expect(scanFunction(withBody(body), RULES)).toEqual({ ok: true, ops: 4 });
  });
  it('ignores a forbidden operator outside the named function', () => {
    const src = `#include <stdio.h>
int helper(int a) { if (a > 1 && a < 5) return a * 2; return a & 1; }
int bit_and(int x, int y) { return ~(~x | ~y); }
int main(void) { printf("a & b %d\\n", helper(3)); return 0; }
`;
    expect(scanFunction(src, RULES).ok).toBe(true);
  });
  it('only scans a definition, not a call or a prototype of the same name', () => {
    const src = 'uint8_t bit_and(uint8_t x, uint8_t y);\nint main(void) { return bit_and(1, 2) & 1; }\nuint8_t bit_and(uint8_t x, uint8_t y) { return ~(~x | ~y); }\n';
    expect(scanFunction(src, RULES).ok).toBe(true);
  });
});

describe('scanFunction: rejections', () => {
  const rejects = (body: string, part: string, rules: ScanRules = RULES) => {
    const r = scanFunction(withBody(body), rules);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(part);
    return r;
  };
  it('a forbidden operator, naming the token, the line and the allowed list', () => {
    const r = rejects('  return x & y;', 'bit_and() uses &');
    expect(r.message).toBe('line 3: bit_and() uses &, which is not allowed here (allowed: ~ |)');
    expect(r.line).toBe(3);
  });
  it('a function call', () => { rejects('  return abs(x);', 'calls abs()'); });
  it('an if statement', () => { rejects('  if (x) return y;\n  return x;', '"if"'); });
  it('loops and sizeof', () => {
    rejects('  while (x) { x = ~x; }\n  return x;', '"while"');
    rejects('  return sizeof(x);', '"sizeof"');
  });
  it('the ?: operator, even when ? and : are in the allowed list', () => {
    rejects('  return x ? x : y;', 'the ?: operator', { ...RULES, allow: ['~', '|', '?', ':'] });
  });
  it('&& and || unless listed', () => {
    rejects('  return x || y;', '||');
    expect(scanFunction(withBody('  return x || y;'), { ...RULES, allow: ['||'] }).ok).toBe(true);
  });
  it('an operator alias made with #define, wherever the macro is', () => {
    const outside = '#include <stdint.h>\n#define AND &\nuint8_t bit_and(uint8_t x, uint8_t y) { return x AND y; }\nint main(void) { return 0; }\n';
    const r = scanFunction(outside, RULES);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('"#define" is not allowed');
    expect(r.line).toBe(2);
    // The alias also fails on its own when the directive is inside the function.
    rejects('#define AND &\n  return x AND y;', '"#define"');
  });
  it('an undeclared name, a string, a float and a large constant', () => {
    rejects('  return g;', '"g", which is not one of its parameters');
    rejects('  return "a";', 'the literal "a"');
    rejects('  return 1.5;', 'not a plain integer');
    rejects('  return ~x | 256;', 'constants may be at most 255');
    expect(scanFunction(withBody('  return ~x | 255;'), RULES).ok).toBe(true);
    expect(scanFunction(withBody('  return ~x | 0x1ff;'), { ...RULES, maxLiteral: 511 }).ok).toBe(true);
  });
  it('a missing function', () => {
    const r = scanFunction('int main(void) { return 0; }\n', RULES);
    expect(r.message).toBe('the function bit_and() was not found: define it with exactly that name');
  });
  it('a forbidden operator hidden after a block comment on the same line', () => {
    rejects('  return /* ~ */ x ^ y;', '^');
  });
});

describe('scanFunction: ways to hide code are rejected', () => {
  const real = '  return x & y;';
  /** The attack from the review of PR #43: a decoy definition behind a digraph directive, then the real one. */
  const decoy = (directive: string, end: string) => `#include <stdint.h>
${directive}if 0
uint8_t bit_and(uint8_t x, uint8_t y) { return ~(~x | ~y); }
${end}endif
uint8_t bit_and(uint8_t x, uint8_t y) {
${real}
}
int main(void) { return 0; }
`;
  it('the digraph %: (a #) cannot hide a decoy definition: the same file with # is rejected, and so is the digraph form', () => {
    expect(scanFunction(decoy('#', '#'), RULES).ok).toBe(false);
    const r = scanFunction(decoy('%:', '%:'), RULES);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('digraph or trigraph "%:"');
  });
  it('a digraph macro %:define cannot alias an operator', () => {
    const src = '#include <stdint.h>\n%:define AND &\nuint8_t bit_and(uint8_t x, uint8_t y) { return x AND y; }\n';
    expect(scanFunction(src, RULES).message).toContain('"%:"');
  });
  it('the bracket and brace digraphs <: :> <% %> and the trigraph ??= are rejected, in the body and outside it', () => {
    for (const bad of ['<:', ':>', '<%', '%>', '??=']) {
      const r = scanFunction(`int g(int a) { return a ${bad} 1; }\nint bit_and(int x, int y) { return ~(~x | ~y); }\n`, RULES);
      expect(r.ok, bad).toBe(false);
      expect(r.message, bad).toContain(`"${bad === '??=' ? '??' : bad}"`);
    }
    expect(scanFunction(withBody('  int a<:1:> = {0};\n  return a<:0:>;'), RULES).ok).toBe(false);
  });
  it('a digraph inside a string or a comment is harmless', () => {
    const src = '#include <stdio.h>\n/* %: <: */\nint bit_and(int x, int y) { return ~(~x | ~y); }\nint main(void) { puts("<: %: :> ok"); return 0; }\n';
    expect(scanFunction(src, RULES).ok).toBe(true);
  });
  it('a backslash-newline is rejected: it can end a comment the scan did not see end', () => {
    const src = 'int bit_and(int x, int y) { /* a *\\\n/ return ~(~x | ~y); }\n';
    expect(scanFunction(src, RULES).message).toContain('line continuation');
  });
  it('a second definition of the function is rejected, whichever one comes first', () => {
    const one = 'uint8_t bit_and(uint8_t x, uint8_t y) { return ~(~x | ~y); }\n';
    const two = 'uint8_t bit_and(uint8_t x, uint8_t y) { return x & y; }\n';
    for (const src of [one + two, two + one]) expect(scanFunction(src, RULES).message).toContain('is defined 2 times');
  });
  it('a cast is rejected: (uint8_t)(x >> (n << 3)) does the work of & 255', () => {
    const rules: ScanRules = { function: 'byte_of', allow: ['>>', '<<', '&'], maxOps: 3 };
    const body = (ret: string) => `#include <stdint.h>\nuint8_t byte_of(uint16_t x, uint8_t n) { return ${ret}; }\n`;
    expect(scanFunction(body('(x >> (n << 3)) & 255'), rules)).toEqual({ ok: true, ops: 3 });
    const r = scanFunction(body('(uint8_t)(x >> (n << 3))'), rules);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('contains a cast');
    expect(scanFunction(body('(unsigned char)x'), rules).ok).toBe(false);
  });
  it('a file that can forge the test report is rejected: constructor attribute, @@ lines, exit calls, inline assembly', () => {
    const wrap = (extra: string) => `#include <stdio.h>\n${extra}\nint bit_and(int x, int y) { return ~(~x | ~y); }\n`;
    for (const extra of [
      '__attribute__((constructor)) static void f(void) { puts("x"); }',
      'static void f(void) { puts("@@PASS a"); }',
      'static void f(void) { _exit(0); }',
      'static void f(void) { exit(0); }',
      'static void f(void) { __asm__("nop"); }',
      '_Pragma("GCC diagnostic ignored \\"-Wall\\"")',
    ]) expect(scanFunction(wrap(extra), RULES).ok, extra).toBe(false);
    expect(scanFunction(wrap('static void f(void) { puts("fine"); }'), RULES).ok).toBe(true);
  });
});

describe('scanFunction: exclusive files', () => {
  const EX: ScanRules = { ...RULES, exclusive: ['bit_and', 'other'] };
  const file = (top: string) => `#include <stdint.h>\n${top}\nuint8_t bit_and(uint8_t x, uint8_t y) { return ~(~x | ~y); }\nint main(void) { return 0; }\n`;
  it('accepts a file of only the puzzle functions and main, and a (void) statement', () => {
    expect(scanFunction(file(''), EX).ok).toBe(true);
    expect(scanFunction(file('uint8_t other(uint8_t a) { (void)a; return 1; }'), EX).ok).toBe(true);
  });
  it('rejects every other top-level item', () => {
    for (const top of [
      'int printf(const char *f, ...) { return 0; }', 'int helper(int a) { return a; }', 'int hook = 1;', 'typedef int t;', 'int other(int a);',
      '__attribute__((constructor)) static void f(void) { }', 'static int s;', '_Static_assert(1, "x");',
    ]) expect(scanFunction(file(top), EX).ok, top).toBe(false);
  });
  it('rejects any directive but #include <stdint.h>, and any string or character literal', () => {
    expect(scanFunction(file('#include <stdio.h>'), EX).message).toContain('#include <stdint.h>');
    expect(scanFunction(file('#define X 1'), EX).ok).toBe(false);
    expect(scanFunction('#include <stdint.h>\nuint8_t bit_and(uint8_t x, uint8_t y) { return ~(~x | ~y); }\nint main(void) { return \'a\'; }\n', EX).ok).toBe(false);
    expect(scanFunction(file('').replace('return 0;', 'return "\\x40"[0];'), EX).ok).toBe(false);
  });
  it('holds main to the body rules (no calls)', () => {
    expect(scanFunction(file('').replace('return 0;', 'return abs(1);'), EX).message).toContain('calls abs()');
  });
  it('rejects a function whose parameters are not plain integer types and names', () => {
    expect(scanFunction('#include <stdint.h>\nuint8_t bit_and(FOO x, uint8_t y) { return ~(~x | ~y); }\n', EX).ok).toBe(false);
  });
  it('does nothing unless the rule asks for it', () => {
    expect(scanFunction('#include <stdio.h>\nint g = 1;\nint bit_and(int x, int y) { return ~(~x | ~y); }\n', RULES).ok).toBe(true);
  });
});

