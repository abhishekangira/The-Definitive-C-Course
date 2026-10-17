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

  // The report-forging attacks. The unit harness trusts "@@PASS" lines on stdout, and the learner file is compiled with it, so the
  // file must hold nothing but the puzzle functions: every scan test fails for each of these, whatever the spelling.
  const starter = readFileSync(path.join(DIR, 'starter.c'), 'utf8');
  const insert = (extra: string, includes = '') => starter.replace('#include <stdint.h>\n', `#include <stdint.h>\n${includes}${extra}\n`);
  const names = spec.tests.filter(t => 'unit' in t).map(t => t.name);
  const attacks: Array<[string, string]> = [
    ['printf redefined to rewrite @@FAIL into @@PASS with \\x40 escapes (the review attack)',
      insert(`int printf(const char *f, ...) { va_list a; va_start(a, f); if (f[1] == 64 && f[2] == 64 && f[3] == 70) { const char *n = va_arg(a, const char *); fputs("\\n\\x40\\x40PASS ", stdout); fputs(n, stdout); fputs("\\n", stdout); fflush(stdout); va_end(a); return 0; } int r = vprintf(f, a); va_end(a); return r; }`, '#include <stdarg.h>\n#include <stdio.h>\n')],
    ['putchar overridden', insert('int putchar(int c) { return c; }')],
    ['puts overridden', insert('int puts(const char *s) { (void)s; return 0; }', '#include <stdio.h>\n')],
    ['fflush overridden', insert('int fflush(FILE *f) { (void)f; return 0; }', '#include <stdio.h>\n')],
    ['write overridden', insert('ssize_t write(int fd, const void *b, size_t n) { (void)fd; (void)b; return (ssize_t)n; }', '#include <unistd.h>\n')],
    ['a constructor attribute', insert(`__attribute__((constructor)) static void forge(void) { puts("@@PASS ${names[0]}"); }`, '#include <stdio.h>\n')],
    ['a constructor attribute spelled with escapes and no @', insert('__attribute__((constructor)) static void forge(void) { puts("\\x40\\x40" "DONE"); exit(0); }', '#include <stdio.h>\n#include <stdlib.h>\n')],
    ['a destructor attribute', insert('__attribute__((destructor)) void forge(void) { }')],
    ['an atexit handler registered from main', starter.replace('#include <stdint.h>\n', '#include <stdint.h>\n#include <stdlib.h>\n').replace('int main(void) {\n    return 0;', 'int main(void) {\n    atexit(abort);\n    return 0;')],
    ['a file-scope variable with an initialiser', insert('int hook = 1;')],
    ['a macro that renames a library function', insert('#define fflush fclose')],
    ['an extra helper function', insert('int helper(int a) { return a; }')],
    ['a string in main', starter.replace('int main(void) {\n    return 0;', 'int main(void) {\n    return \"\\x40\"[0];')],
  ];
  it.each(attacks)('%s can not complete the exercise: no scan test passes', async (_n, code) => {
    const r = await go(code);
    // A forged report may still make a unit test "pass", but the exercise is only complete when every test passes.
    expect(r.results.filter(t => t.status !== 'pass').length).toBeGreaterThan(0);
    expect(r.results.filter(t => t.kind === 'scan' && t.status === 'pass')).toHaveLength(0);
    expect(r.results.find(t => t.kind === 'compile')?.status, 'the attack compiles, so the scan is what stops it').toBe('pass');
  }, 60_000);

  it('the untouched starter passes all six scans (its (void) lines are not casts) and fails the unit tests', async () => {
    const r = await go(starter);
    expect(r.results.filter(t => t.kind === 'scan').map(t => t.status)).toEqual(Array(6).fill('pass'));
    expect(r.results.filter(t => t.kind === 'unit' && t.status === 'pass')).toHaveLength(0);
  }, 60_000);
});
