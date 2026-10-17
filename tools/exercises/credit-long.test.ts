// PLAN (Module 2, project Credit): "the browser runner's `long` is 32-bit, so 16-digit numbers expose
// learners who used `long` instead of `long long`". Proved here on the real browser toolchain: the mutant
// is made from the real solution by text replacement, the reference solution passes every case, and the
// mutant fails at least one case that has 13 or more digits.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TestsSpec } from '../../src/content-model/types';
import { runTests } from '../../src/testing/runner';
import { browserSupportFiles } from './verify';
import { WasmNodeBackend } from './wasm-backend';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../content/modules/m02-bits-bytes-numbers/project/credit');
const spec = JSON.parse(readFileSync(path.join(DIR, 'check.json'), 'utf8')) as TestsSpec;
const solution = readFileSync(path.join(DIR, 'solution/credit.c'), 'utf8');
const files = browserSupportFiles(DIR);
const backend = new WasmNodeBackend();

describe('Credit and the 32-bit long of the browser toolchain', () => {
  it('the reference solution passes every case', async () => {
    const r = await runTests(spec, { 'credit.c': solution }, files, backend);
    expect(r.results.filter(t => t.status !== 'pass').map(t => t.name)).toEqual([]);
  }, 60_000);

  it('a long-instead-of-long-long mutant fails the 13-to-17-digit cases', async () => {
    expect(solution).toContain('long long');
    const mutant = solution.replaceAll('long long', 'long');
    expect(mutant).not.toContain('long long');
    const r = await runTests(spec, { 'credit.c': mutant }, files, backend);
    const failing = r.results.filter(t => t.status === 'fail');
    const big = (name: string) => {
      const test = spec.tests.find(t => t.name === name);
      const stdin = test && 'run' in test ? (test.run.stdin ?? '') : '';
      return stdin.split('\n').some(line => /^\d{13,}$/.test(line));
    };
    expect(failing.length).toBeGreaterThan(0);
    expect(failing.some(t => big(t.name))).toBe(true);
    // The small cases still pass: only the width differs.
    expect(r.results.find(t => t.name === 'A short number')?.status).toBe('pass');
  }, 60_000);

  // Mutants found by the review of PR #43 (all of them passed the first version of check.json). Each is made from the real
  // solution by text replacement, so a change to the solution that breaks a replacement fails loudly here.
  const mutants: Array<[string, string, string]> = [
    ['checksum accepts any total divisible by 5', 'return sum % 10 == 0;', 'return sum % 5 == 0;'],
    ['checksum accepts any even total', 'return sum % 10 == 0;', 'return sum % 2 == 0;'],
    ...[30, 32, 33, 35, 36, 38].map((p): [string, string, string] => [`Amex also accepts prefix ${p}`, 'prefix == 34 || prefix == 37', `prefix == 34 || prefix == 37 || prefix == ${p}`]),
    ['Amex also accepts 16 digits', 'digits == 15 && (prefix == 34', '(digits == 15 || digits == 16) && (prefix == 34'],
    ['Mastercard also accepts 17 digits', 'digits == 16 && prefix >= 51', '(digits == 16 || digits == 17) && prefix >= 51'],
    ['Visa also accepts 15 digits', '(digits == 13 || digits == 16) && prefix / 10', '(digits == 13 || digits == 15 || digits == 16) && prefix / 10'],
    ['Visa also accepts 19 digits', '(digits == 13 || digits == 16) && prefix / 10', '(digits == 13 || digits == 16 || digits == 19) && prefix / 10'],
  ];
  it.each(mutants)('mutant "%s" fails at least one case', async (_name, from, to) => {
    expect(solution).toContain(from);
    const r = await runTests(spec, { 'credit.c': solution.replace(from, to) }, files, backend);
    expect(r.results.filter(t => t.status === 'fail').length).toBeGreaterThan(0);
  }, 60_000);
});

