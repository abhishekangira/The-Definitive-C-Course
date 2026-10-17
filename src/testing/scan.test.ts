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
  it('lets the learner declare and use locals, casts and braces', () => {
    const body = '  uint8_t a = ~x;\n  uint8_t b = ~y;\n  return (uint8_t)~(a | b);';
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
