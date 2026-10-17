// bitlab-lite (Module 2): the hand-written tests are checked on the real exercise folder and the browser
// toolchain. The reference solution passes everything; solutions that cheat (a forbidden operator, an
// `if`, an operator hidden behind a `#define`) still pass the unit test for their puzzle (they ARE
// correct) but fail its scan test. Cheats are made from the real solution by text replacement.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TestsSpec } from '../../src/content-model/types';
import { runTests, type TestReport } from '../../src/testing/runner';
import { browserSupportFiles } from './verify';
import { WasmNodeBackend } from './wasm-backend';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../content/modules/m02-bits-bytes-numbers/exercises/bitlab-lite');
const spec = JSON.parse(readFileSync(path.join(DIR, 'tests.json'), 'utf8')) as TestsSpec;
const solution = readFileSync(path.join(DIR, 'solution.c'), 'utf8');
const files = browserSupportFiles(DIR);
const backend = new WasmNodeBackend();

const go = (code: string) => runTests(spec, { 'bitlab.c': code }, files, backend);
const status = (r: TestReport, fn: string, kind: 'scan' | 'unit') =>
  r.results.find(t => t.kind === kind && t.name.startsWith(kind === 'scan' ? `${fn}() uses` : `${fn}(`))?.status;

function cheat(from: string, to: string): string {
  expect(solution).toContain(from);
  return solution.replace(from, to);
}

describe('bitlab-lite', () => {
  it('the reference solution passes the scan and the exhaustive unit test of every puzzle', async () => {
    const r = await go(solution);
    expect(r.results.filter(t => t.status !== 'pass').map(t => `${t.name}: ${t.message}`)).toEqual([]);
    expect(r.results.filter(t => t.kind === 'scan')).toHaveLength(6);
    expect(r.results.filter(t => t.kind === 'unit')).toHaveLength(6);
  }, 60_000);

  it('a forbidden operator is correct but fails the scan', async () => {
    const r = await go(cheat('return ~(~x | ~y);', 'return x & y;'));
    expect(status(r, 'bit_and', 'unit')).toBe('pass');
    expect(status(r, 'bit_and', 'scan')).toBe('fail');
    expect(r.results.find(t => t.kind === 'scan' && t.status === 'fail')?.message).toContain('&');
  }, 60_000);

  it('an `if` is correct but fails the scan', async () => {
    const r = await go(cheat('return (x != 0) & ((x & (x - 1)) == 0);', 'if (x != 0 && (x & (x - 1)) == 0) return 1; return 0;'));
    expect(status(r, 'is_pow2', 'unit')).toBe('pass');
    expect(status(r, 'is_pow2', 'scan')).toBe('fail');
  }, 60_000);

  it('an operator hidden behind a #define is correct but fails the scan', async () => {
    const r = await go('#define AND &\n' + cheat('return ~(~x | ~y);', 'return x AND y;'));
    expect(status(r, 'bit_and', 'unit')).toBe('pass');
    expect(status(r, 'bit_and', 'scan')).toBe('fail');
  }, 60_000);

  it('a wrong answer that obeys the operator rules fails the unit test and passes the scan', async () => {
    const r = await go(cheat('return ~x + 1;', 'return ~x;'));
    expect(status(r, 'negate', 'scan')).toBe('pass');
    expect(status(r, 'negate', 'unit')).toBe('fail');
  }, 60_000);

  // Attacks from the review of PR #43. Each one passed 13/13 before the scan learned to reject it.
  it('a digraph decoy (%:if 0 ... %:endif around a fake bit_and) is rejected by the scan', async () => {
    const real = 'uint8_t bit_and(uint8_t x, uint8_t y) {\n    return x & y;\n}\n';
    const decoy = cheat('uint8_t bit_and(uint8_t x, uint8_t y) {\n    return ~(~x | ~y);\n}\n', '%:if 0\nuint8_t bit_and(uint8_t x, uint8_t y) { return ~(~x | ~y); }\n%:endif\n' + real);
    const r = await go(decoy);
    expect(status(r, 'bit_and', 'unit')).toBe('pass'); // the real one is correct
    expect(status(r, 'bit_and', 'scan')).toBe('fail');
    expect(r.results.find(t => t.kind === 'scan' && t.status === 'fail')?.message).toContain('digraph or trigraph');
  }, 60_000);

  it('a narrowing cast in place of & 255 is correct but fails the scan', async () => {
    const r = await go(cheat('return (x >> (n << 3)) & 255;', 'return (uint8_t)(x >> (n << 3));'));
    expect(status(r, 'byte_of', 'unit')).toBe('pass');
    expect(status(r, 'byte_of', 'scan')).toBe('fail');
  }, 60_000);

  it('a constructor that prints a forged report on the unmodified starter fails every scan test', async () => {
    const starter = readFileSync(path.join(DIR, 'starter.c'), 'utf8');
    const names = spec.tests.filter(t => 'unit' in t).map(t => t.name);
    const forge = `#include <unistd.h>\n__attribute__((constructor)) static void forge(void) { ${names.map(n => `puts("@@PASS ${n}");`).join(' ')} puts("@@DONE"); fflush(stdout); _exit(0); }\n`;
    const r = await go(starter.replace('#include <stdio.h>\n', '#include <stdio.h>\n' + forge));
    expect(r.results.filter(t => t.kind === 'scan' && t.status === 'fail')).toHaveLength(6);
  }, 60_000);
});

