import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileWasm, runWasm } from '../../tools/shared/wasm-node';
import { buildHarness, CHECK_H, CHECK_H_FILE, DONE_MARKER, extractCheckNames, HARNESS_FILE, NEVER_REPORTED, parseHarnessOutput } from './harness';

const LEARNER = `#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>

static int helper(int x) { return x * 2; }

char rotate(char c, int key) {
    if (islower((unsigned char)c)) return (char)('a' + (c - 'a' + key) % 26);
    return c;
}

char *dup_str(const char *s) {
    if (s[0] == 'n') return NULL;
    return (char *)s;
}

int main(int argc, char *argv[]) {
    printf("argc=%d %s", argc, argv[0]);   /* unterminated output, never runs in the harness */
}
`;

const TESTS = `#include "check.h"
// A comment with CHECK(1, "not a check")
int main(void) {
    CHECK_EQ_CHAR(rotate('a', 1), 'b', "rotate('a', 1) gives 'b'");
    CHECK_EQ_CHAR(rotate('z', 1), '{', "rotate('z', 1) is wrong on purpose");
    CHECK_EQ_INT(helper(21), 42, "static helpers are testable");
    CHECK_EQ_LL(1LL << 40, 1LL << 40, "long long");
    CHECK_EQ_STR(dup_str("hi\\tthere"), "hi\\tthere", "strings, " "concatenated");
    CHECK_EQ_STR(dup_str("nope"), "nope", "NULL never equals");
    CHECK_EQ_DBL(0.1 + 0.2, 0.3, 1e-9, "doubles within eps");
    CHECK(helper(1) == 3, "a false condition");
    printf("learner-style output without newline");
    CHECK(1, "after unterminated output");
    return CHECK_RESULT();
}
`;

const EXPECTED_NAMES = [
  "rotate('a', 1) gives 'b'", "rotate('z', 1) is wrong on purpose", 'static helpers are testable', 'long long',
  'strings, concatenated', 'NULL never equals', 'doubles within eps', 'a false condition', 'after unterminated output',
];

describe('buildHarness', () => {
  it('includes the learner file with main renamed and diagnostics silenced', () => {
    const h = buildHarness({ learnerFile: 'caesar.c', testFile: 'tests/test_rotate.c', testSource: 'int main(void) { return 0; }' });
    expect(h).toContain('#include "check.h"');
    expect(h).toMatch(/#pragma GCC diagnostic push\n#pragma GCC diagnostic ignored "-Wreturn-type"\n#pragma GCC diagnostic ignored "-Wmissing-prototypes"\n#define main learner_main\n#include "caesar.c"\n#undef main\n#pragma GCC diagnostic pop/);
    expect(h).toContain('#line 1 "tests/test_rotate.c"\nint main(void) { return 0; }\n#undef main');
    expect(h).toContain(`puts("\\n${DONE_MARKER}")`);
  });
  it('points #line back at the harness right after the test file', () => {
    const h = buildHarness({ learnerFile: 'a.c', testFile: 't.c', testSource: 'x\ny\n' });
    const lines = h.split('\n');
    const i = lines.findIndex(l => l.startsWith(`#line `) && l.includes(HARNESS_FILE));
    expect(lines[i]).toBe(`#line ${i + 2} "${HARNESS_FILE}"`);
  });
});

describe('extractCheckNames', () => {
  it('reads literal names in order, skipping comments, macros and non-literals', () => {
    expect(extractCheckNames(TESTS)).toEqual(EXPECTED_NAMES);
  });
  it('handles commas and parentheses inside arguments, and escapes', () => {
    const src = `
      CHECK_EQ_STR(join("a,b", f(1, (2))), "a,b", "commas, (parens) and \\"quotes\\"");
      CHECK(x, name_variable);
      /* CHECK(1, "commented out") */
      #define CHECK_TWICE(n) CHECK(1, n)
      CHECK_EQ_INT(g(','), ')', "chars ',' and ')'");
    `;
    expect(extractCheckNames(src)).toEqual(['commas, (parens) and "quotes"', "chars ',' and ')'"]);
  });
});

describe('parseHarnessOutput', () => {
  it('reads passes, failures, missing checks and the done marker', () => {
    const out = '\n@@PASS a\nnoise\n@@FAIL b\texpected 1, got 2\n@@PASS extra\n';
    const r = parseHarnessOutput(out, ['a', 'b', 'c']);
    expect(r.done).toBe(false);
    expect(r.missing).toEqual(['c']);
    expect(r.subtests).toEqual([
      { name: 'a', status: 'pass' },
      { name: 'b', status: 'fail', message: 'expected 1, got 2' },
      { name: 'c', status: 'fail', message: NEVER_REPORTED },
      { name: 'extra', status: 'pass' },
    ]);
    expect(parseHarnessOutput(`@@PASS a\n\n${DONE_MARKER}\n`, ['a']).done).toBe(true);
  });
  it('a check reported twice fails if either report failed', () => {
    const r = parseHarnessOutput('@@FAIL x\tfirst\n@@PASS x\n', ['x']);
    expect(r.subtests).toEqual([{ name: 'x', status: 'fail', message: 'first' }]);
  });
});

// ---------------------------------------------------------------- real compilers

const work = mkdtempSync(path.join(tmpdir(), 'harness-test-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
writeFileSync(path.join(work, CHECK_H_FILE), CHECK_H);
writeFileSync(path.join(work, 'caesar.c'), LEARNER);
writeFileSync(path.join(work, HARNESS_FILE), buildHarness({ learnerFile: 'caesar.c', testFile: 'tests/test_rotate.c', testSource: TESTS }));

const EXPECTED_RESULTS = [
  { name: "rotate('a', 1) gives 'b'", status: 'pass' },
  { name: "rotate('z', 1) is wrong on purpose", status: 'fail', message: "expected '{' (123), got 'a' (97)" },
  { name: 'static helpers are testable', status: 'pass' },
  { name: 'long long', status: 'pass' },
  { name: 'strings, concatenated', status: 'pass' },
  { name: 'NULL never equals', status: 'fail', message: 'expected "nope", got NULL' },
  { name: 'doubles within eps', status: 'pass' },
  { name: 'a false condition', status: 'fail', message: 'this was false: helper(1) == 3' },
  { name: 'after unterminated output', status: 'pass' },
];

const has = (cc: string) => spawnSync(cc, ['--version']).status === 0;
const STRICT = ['-std=c17', '-Wall', '-Wextra', '-pedantic', '-Werror', '-Wmissing-prototypes', '-g', '-O0'];

describe.each(['gcc', 'clang-22'].filter(has))('the harness with %s', cc => {
  it('compiles with -Werror (learner main without return, static helpers) and reports every check', () => {
    const exe = path.join(work, `h-${cc}`);
    execFileSync(cc, [...STRICT, '-fdiagnostics-color=never', HARNESS_FILE, '-o', exe], { cwd: work, stdio: 'pipe' });
    const r = spawnSync(exe, [], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const parsed = parseHarnessOutput(r.stdout, EXPECTED_NAMES);
    expect(parsed.done).toBe(true);
    expect(parsed.subtests).toEqual(EXPECTED_RESULTS);
  });
  it('a crash part-way leaves the remaining checks unreported', () => {
    const src = 'int main(void) {\n  CHECK(1, "first");\n  volatile int *p = 0;\n  CHECK(*p == 0, "second");\n  return 0;\n}\n';
    writeFileSync(path.join(work, 'crash.c'), buildHarness({ learnerFile: 'caesar.c', testFile: 't.c', testSource: src }));
    const exe = path.join(work, `crash-${cc}`);
    // No -Werror: this harness never calls the learner's static helper (the runner ignores harness warnings).
    execFileSync(cc, [...STRICT.filter(f => f !== '-Werror'), 'crash.c', '-o', exe], { cwd: work, stdio: 'pipe' });
    const r = spawnSync(exe, [], { encoding: 'utf8' });
    expect(r.signal).toBe('SIGSEGV');
    const parsed = parseHarnessOutput(r.stdout, extractCheckNames(src));
    expect(parsed).toMatchObject({ done: false, missing: ['second'] });
  });
});

describe('the harness with the browser toolchain (wasm32, clang 22)', () => {
  it('compiles warning-free and reports every check', async () => {
    const files = { [CHECK_H_FILE]: CHECK_H, 'caesar.c': LEARNER, [HARNESS_FILE]: buildHarness({ learnerFile: 'caesar.c', testFile: 'tests/test_rotate.c', testSource: TESTS }) };
    const c = await compileWasm({ files, sources: [HARNESS_FILE] });
    expect(c.raw).toBe('');
    expect(c.ok).toBe(true);
    const r = await runWasm(c.wasm!);
    const parsed = parseHarnessOutput(r.stdout, EXPECTED_NAMES);
    expect(parsed.done).toBe(true);
    expect(parsed.subtests).toEqual(EXPECTED_RESULTS);
  }, 60_000);
});
