// The expected values come from real C programs (the browser toolchain, run through Node), never from
// recomputing the helpers' own formulas (AGENTS.md: "Tests call the real code"). Each C program prints facts;
// the test parses them and compares them with what numbers.ts says.
import { beforeAll, describe, expect, it } from 'vitest';
import { compileWasm, runWasm } from '../../tools/shared/wasm-node';
import {
  asSigned, asUnsigned, binary, floatFields, floatFromBits, floatText, floatToBits, hasExactDecimal, hex, jsNumberText, toBits,
  wheelAngle, wheelStep, type FloatClass, type FloatWidth, type Width,
} from './numbers';

async function runC(source: string): Promise<string> {
  const out = await compileWasm({ files: { 'main.c': source }, sources: ['main.c'] });
  if (!out.ok || !out.wasm) throw new Error(`C did not compile: ${out.raw}`);
  const run = await runWasm(out.wasm);
  if (run.exitCode !== 0) throw new Error(`C exited ${run.exitCode}`);
  return run.stdout;
}

/** Lines of "key value value ..." as arrays of words. */
const rows = (text: string) => text.trim().split('\n').map(l => l.trim().split(/\s+/));

// ---- floats: bits, fields, class and value, as C sees them ----------------------------------------------------------
const FLOAT_C = `#include <inttypes.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static const char *cls(int c) {
  return c == FP_ZERO ? "zero" : c == FP_SUBNORMAL ? "subnormal" : c == FP_NORMAL ? "normal" : c == FP_INFINITE ? "infinity" : "nan";
}
static void show_f(const char *name, float f) {
  uint32_t b;
  memcpy(&b, &f, sizeof b);
  printf("f %s %08" PRIx32 " %u %u %06" PRIx32 " %s", name, b, (unsigned)(b >> 31), (unsigned)((b >> 23) & 0xFF), b & 0x7FFFFF, cls(fpclassify(f)));
  if (isnan(f)) printf(" nan\\n"); else printf(" %.17g\\n", (double)f);
}
static void show_d(const char *name, double d) {
  uint64_t b;
  memcpy(&b, &d, sizeof b);
  printf("d %s %016" PRIx64 " %u %u %013" PRIx64 " %s", name, b, (unsigned)(b >> 63), (unsigned)((b >> 52) & 0x7FF), b & 0xFFFFFFFFFFFFFull, cls(fpclassify(d)));
  if (isnan(d)) printf(" nan\\n"); else printf(" %.17g\\n", d);
}

int main(void) {
  uint32_t sub = 0x007FFFFFu;           /* the largest subnormal float */
  float largest_sub;
  memcpy(&largest_sub, &sub, sizeof sub);
  uint32_t qnan = 0x7FC00000u;
  float nanf;
  memcpy(&nanf, &qnan, sizeof qnan);
  volatile double tenth = 0.1, fifth = 0.2;
  show_f("one", 1.0f);
  show_f("minus_two_and_a_half", -2.5f);
  show_f("tenth", 0.1f);
  show_f("two_pow_24", 16777216.0f);
  show_f("largest_subnormal", largest_sub);
  show_f("infinity", INFINITY);
  show_f("minus_infinity", -INFINITY);
  show_f("nan", nanf);
  show_f("zero", 0.0f);
  show_f("minus_zero", -0.0f);
  show_d("one", 1.0);
  show_d("tenth", 0.1);
  show_d("sum", tenth + fifth);
  show_d("infinity", (double)INFINITY);
  return 0;
}
`;

interface FloatFact { width: FloatWidth; bits: bigint; sign: number; exponent: number; fraction: bigint; cls: FloatClass; value: number | 'nan' }
let floatFacts: Record<string, FloatFact> = {};

describe('float helpers agree with real C', () => {
  beforeAll(async () => {
    floatFacts = {};
    for (const [kind, name, bits, sign, exp, frac, cls, value] of rows(await runC(FLOAT_C))) {
      const width: FloatWidth = kind === 'f' ? 32 : 64;
      floatFacts[`${kind}:${name}`] = {
        width, bits: BigInt('0x' + bits), sign: Number(sign), exponent: Number(exp), fraction: BigInt('0x' + frac), cls: cls as FloatClass,
        value: value === 'nan' ? 'nan' : value === 'inf' ? Infinity : value === '-inf' ? -Infinity : Number(value),
      };
    }
  }, 120_000);

  it('C printed every case we check', () => {
    expect(Object.keys(floatFacts)).toEqual(expect.arrayContaining([
      'f:one', 'f:minus_two_and_a_half', 'f:tenth', 'f:two_pow_24', 'f:largest_subnormal', 'f:infinity', 'f:nan', 'd:sum',
    ]));
  });

  it('splits every pattern into the sign, exponent and fraction that C reads from the same bits', () => {
    for (const [name, c] of Object.entries(floatFacts)) {
      const f = floatFields(c.bits, c.width);
      expect({ name, sign: f.sign, exponent: f.exponent, fraction: f.fraction, cls: f.cls }).toEqual({ name, sign: c.sign, exponent: c.exponent, fraction: c.fraction, cls: c.cls });
    }
  });

  it('floatToBits gives the pattern C stored, and floatFromBits the value C printed', () => {
    for (const [name, c] of Object.entries(floatFacts)) {
      if (c.value === 'nan') { expect(Number.isNaN(floatFromBits(c.bits, c.width)), name).toBe(true); continue; }
      expect(floatFromBits(c.bits, c.width), name).toBe(c.value);
      if (!(c.value === 0 && c.sign === 1)) expect(floatToBits(c.value, c.width), name).toBe(c.bits);
    }
    expect(floatToBits(-0, 32)).toBe(floatFacts['f:minus_zero'].bits);
  });

  it('rounds 0.1 to the nearest float and keeps the double 0.1 + 0.2 sum, like C', () => {
    expect(floatToBits(0.1, 32)).toBe(floatFacts['f:tenth'].bits);
    expect(floatFromBits(floatToBits(0.1, 32), 32)).toBe(floatFacts['f:tenth'].value);
    expect(floatToBits(0.1 + 0.2, 64)).toBe(floatFacts['d:sum'].bits);
  });

  it('classifies the largest subnormal, infinity and a NaN as C does', () => {
    expect(floatFields(floatFacts['f:largest_subnormal'].bits, 32).cls).toBe('subnormal');
    expect(floatFields(floatFacts['f:infinity'].bits, 32).unbiased).toBeNull();
    expect(floatFields(floatFacts['f:nan'].bits, 32).cls).toBe('nan');
    expect(floatFields(floatFacts['f:one'].bits, 32).unbiased).toBe(0);
    expect(floatFields(floatFacts['f:largest_subnormal'].bits, 32).unbiased).toBe(-126);
  });

  it('writes values for learners: the same digits C prints with %.17g, and -0, Infinity, NaN', () => {
    expect(floatText(floatFacts['f:tenth'].bits, 32)).toBe(String(floatFacts['f:tenth'].value));
    expect(floatText(floatFacts['f:one'].bits, 32)).toBe('1');
    expect(floatText(floatFacts['f:minus_zero'].bits, 32)).toBe('-0');
    expect(floatText(floatFacts['f:minus_infinity'].bits, 32)).toBe('-Infinity');
    expect(floatText(floatFacts['f:nan'].bits, 32)).toBe('NaN');
    // The JS Number line: JavaScript's Number is C's double, so 0.1 + 0.2 reads the same digits C printed.
    expect(jsNumberText(floatFacts['d:sum'].bits)).toBe(String(floatFacts['d:sum'].value));
    expect(jsNumberText(floatFacts['d:sum'].bits)).toBe('0.30000000000000004');
  });

  it('knows which decode answers have an exact short decimal form (0.1f does not)', () => {
    expect(hasExactDecimal(floatFacts['f:one'].value as number)).toBe(true);
    expect(hasExactDecimal(floatFacts['f:minus_two_and_a_half'].value as number)).toBe(true);
    expect(hasExactDecimal(floatFacts['f:two_pow_24'].value as number)).toBe(true);
    expect(hasExactDecimal(floatFacts['f:tenth'].value as number)).toBe(false);
    expect(hasExactDecimal(Infinity)).toBe(false);
  });
});

// ---- the wheel and the integer helpers: wrap cases as C does them ---------------------------------------------------
const WHEEL_C = `#include <stdint.h>
#include <stdio.h>

int main(void) {
  uint8_t s8[] = {0, 1, 126, 127, 128, 253, 254, 255};
  for (unsigned i = 0; i < sizeof s8; i++) {
    for (int d = -1; d <= 1; d += 2) {
      uint8_t r = (uint8_t)(s8[i] + d);
      printf("8 %u %d %u %d %02X\\n", (unsigned)s8[i], d, (unsigned)r, (int)(int8_t)r, (unsigned)r);
    }
  }
  uint32_t s32[] = {0u, 1u, 0x7FFFFFFFu, 0x80000000u, 0xFFFFFFFEu, 0xFFFFFFFFu};
  for (unsigned i = 0; i < sizeof s32 / sizeof s32[0]; i++) {
    for (int d = -1; d <= 1; d += 2) {
      uint32_t r = s32[i] + (uint32_t)d;
      printf("32 %u %d %u %d %08X\\n", (unsigned)s32[i], d, (unsigned)r, (int)(int32_t)r, (unsigned)r);
    }
  }
  unsigned char c = 250;
  c += 10;
  printf("c250 %d\\n", c);
  int minus_one = -1;
  printf("m1 %u %X\\n", (unsigned)(uint8_t)minus_one, (unsigned)(uint8_t)minus_one);
  return 0;
}
`;

describe('wheel and integer helpers agree with real C', () => {
  let lines: string[][] = [];
  beforeAll(async () => { lines = rows(await runC(WHEEL_C)); }, 120_000);

  it('steps and wraps an 8-bit and a 32-bit counter exactly as unsigned arithmetic in C', () => {
    const steps = lines.filter(l => l[0] === '8' || l[0] === '32');
    expect(steps.length).toBe(16 + 12);
    for (const [w, start, delta, unsignedAfter, signedAfter, hexAfter] of steps) {
      const width = Number(w) as Width;
      const after = wheelStep(BigInt(start), Number(delta), width);
      expect({ w, start, delta, u: asUnsigned(after, width).toString() }).toEqual({ w, start, delta, u: unsignedAfter });
      expect(asSigned(after, width).toString()).toBe(signedAfter);
      expect(hex(after, width)).toBe('0x' + hexAfter);
    }
  });

  it('reproduces C\'s unsigned char wrap (250 + 10 is 4)', () => {
    expect(lines.find(l => l[0] === 'c250')![1]).toBe('4');
    expect(wheelStep(250n, 10, 8)).toBe(4n);
  });

  it('wraps three presses of Add 1 from 253 to 0 (the wheel e2e relies on it)', () => {
    let b = 253n;
    for (let i = 0; i < 3; i++) b = wheelStep(b, 1, 8);
    expect(b).toBe(0n);
  });

  it('puts bit patterns at the right angle: 0 at the top, half-way at the bottom', () => {
    expect(wheelAngle(0n, 8)).toBe(0);
    expect(wheelAngle(128n, 8)).toBe(180);
    expect(wheelAngle(64n, 8)).toBe(90);
    expect(wheelAngle(0x80000000n, 32)).toBe(180);
  });

  it('toBits, hex and binary agree with C for the same values', () => {
    const [, u, x] = lines.find(l => l[0] === 'm1')!;
    expect(toBits(-1n, 8).toString()).toBe(u);
    expect(hex(toBits(-1n, 8), 8)).toBe('0x' + x);
    expect(binary(toBits(-1n, 8), 8).replace(' ', '')).toBe(Number(u).toString(2));
  });
});
