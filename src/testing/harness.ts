// Unit-test harness: one scheme for the in-browser runner and check.mjs (PLAN §4.2).
//
// A unit test is a C file (e.g. tests/test_rotate.c) with an `int main(void)` that calls the CHECK
// macros from check.h. The runner never compiles it on its own: it generates one translation unit,
//
//     #include "check.h"
//     #pragma GCC diagnostic push / ignored "-Wreturn-type" / ignored "-Wmissing-prototypes"
//     #define main learner_main
//     #include "caesar.c"              <- the learner's file that defines main (static helpers stay testable)
//     #undef main
//     #pragma GCC diagnostic pop
//     #define main check_tests_main_
//     #line 1 "tests/test_rotate.c"
//     ...the test file's text...
//     #undef main
//     int main(void) { check_tests_main_(); puts("@@DONE"); return 0; }
//
// so test files never need to know how the learner's code gets in, and the learner's main() (whose
// return value is never trusted) is out of the way. Each check prints "@@PASS name" or
// "@@FAIL name<TAB>why" on its own line. A check that never reports (the program crashed, called
// exit(), or looped forever first) counts as failed, and "@@DONE" tells a finished run from one that
// stopped early. Environment-neutral: no DOM and no Node imports.

/** Name of the generated assertions header (written next to the generated harness). */
export const CHECK_H_FILE = 'check.h';
/** Name of the generated translation unit. */
export const HARNESS_FILE = '__check_harness__.c';
/** Last line a harness prints when every check ran. */
export const DONE_MARKER = '@@DONE';

/** check.h: the assertion macros. Clean under -std=c17 -Wall -Wextra -pedantic (gcc, clang, wasm). */
export const CHECK_H = String.raw`/* check.h - assertions for The Definitive C Course's unit tests (MIT License).
 *
 *   CHECK(cond, name)                       cond is true
 *   CHECK_EQ_INT(actual, expected, name)    integers (compared as long long)
 *   CHECK_EQ_LL(actual, expected, name)     long long
 *   CHECK_EQ_CHAR(actual, expected, name)   characters (shown escaped, with their codes)
 *   CHECK_EQ_STR(actual, expected, name)    strings (NULL never equals anything)
 *   CHECK_EQ_DBL(actual, expected, eps, name)  |actual - expected| <= eps
 *
 * name must be a string literal: the runner reads the names from the test file, so a check that never
 * runs (because the program crashed or exited first) is reported as failed. Every check prints one
 * line, "@@PASS name" or "@@FAIL name<TAB>why", and flushes stdout so nothing is lost in a crash.
 * Each argument is evaluated exactly once.
 */
#ifndef CHECK_H
#define CHECK_H

#include <stdio.h>
#include <string.h>

/* Counts failures (a static local keeps the header warning-free when it is unused). */
static inline int check_failures_(int add) {
    static int failures;
    failures += add;
    return failures;
}

static inline void check_put_char_(int c) {
    switch (c) {
    case '\n': fputs("\\n", stdout); break;
    case '\t': fputs("\\t", stdout); break;
    case '\r': fputs("\\r", stdout); break;
    case '\0': fputs("\\0", stdout); break;
    case '\\': fputs("\\\\", stdout); break;
    default:
        if (c < 32 || c >= 127) printf("\\x%02x", (unsigned)c & 0xffu);
        else putchar(c);
    }
}

static inline void check_put_str_(const char *s) {
    if (!s) { fputs("NULL", stdout); return; }
    putchar('"');
    for (; *s; s++) {
        if (*s == '"') fputs("\\\"", stdout);
        else check_put_char_((unsigned char)*s);
    }
    putchar('"');
}

/* A leading newline keeps the marker at the start of a line even after unterminated learner output. */
static inline void check_pass_(const char *name) {
    fflush(stdout);
    printf("\n@@PASS %s\n", name);
    fflush(stdout);
}

static inline void check_fail_begin_(const char *name) {
    fflush(stdout);
    check_failures_(1);
    printf("\n@@FAIL %s\t", name);
}

static inline void check_fail_end_(void) {
    putchar('\n');
    fflush(stdout);
}

#define CHECK(cond, name) do { \
    if (cond) check_pass_(name); \
    else { check_fail_begin_(name); fputs("this was false: " #cond, stdout); check_fail_end_(); } \
} while (0)

#define CHECK_EQ_LL(actual, expected, name) do { \
    long long check_a_ = (long long)(actual), check_e_ = (long long)(expected); \
    if (check_a_ == check_e_) check_pass_(name); \
    else { check_fail_begin_(name); printf("expected %lld, got %lld", check_e_, check_a_); check_fail_end_(); } \
} while (0)

#define CHECK_EQ_INT(actual, expected, name) CHECK_EQ_LL(actual, expected, name)

#define CHECK_EQ_CHAR(actual, expected, name) do { \
    int check_a_ = (unsigned char)(actual), check_e_ = (unsigned char)(expected); \
    if (check_a_ == check_e_) check_pass_(name); \
    else { \
        check_fail_begin_(name); \
        fputs("expected '", stdout); check_put_char_(check_e_); printf("' (%d), got '", check_e_); \
        check_put_char_(check_a_); printf("' (%d)", check_a_); \
        check_fail_end_(); \
    } \
} while (0)

#define CHECK_EQ_STR(actual, expected, name) do { \
    const char *check_a_ = (actual), *check_e_ = (expected); \
    if (check_a_ && check_e_ && strcmp(check_a_, check_e_) == 0) check_pass_(name); \
    else { \
        check_fail_begin_(name); \
        fputs("expected ", stdout); check_put_str_(check_e_); fputs(", got ", stdout); check_put_str_(check_a_); \
        check_fail_end_(); \
    } \
} while (0)

#define CHECK_EQ_DBL(actual, expected, eps, name) do { \
    double check_a_ = (double)(actual), check_e_ = (double)(expected), check_eps_ = (double)(eps); \
    double check_d_ = check_a_ - check_e_; \
    if (check_d_ < 0) check_d_ = -check_d_; \
    if (check_d_ <= check_eps_) check_pass_(name); \
    else { check_fail_begin_(name); printf("expected %.10g (within %g), got %.10g", check_e_, check_eps_, check_a_); check_fail_end_(); } \
} while (0)

/* Optional: the number of failed checks so far, e.g. return CHECK_RESULT(); (the runner ignores it). */
#define CHECK_RESULT() (check_failures_(0) ? 1 : 0)

#endif
`;

const cString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export interface HarnessInput {
  /** The learner's file that defines main (spec.sources[0]), as an include path. */
  learnerFile: string;
  /** Path of the test file, used for #line so diagnostics point at the right file. */
  testFile: string;
  /** Text of the test file. */
  testSource: string;
}

/** Generates the harness translation unit (see the header comment for the scheme). */
export function buildHarness({ learnerFile, testFile, testSource }: HarnessInput): string {
  const body = testSource.endsWith('\n') ? testSource : testSource + '\n';
  // 12 header lines, the test file, "#undef main", then the #line itself: the line after it is this one.
  const after = 14 + body.split('\n').length;
  return [
    '/* Generated by the course test runner. Do not edit. */',
    `#include ${cString(CHECK_H_FILE)}`,
    '#pragma GCC diagnostic push',
    '#pragma GCC diagnostic ignored "-Wreturn-type"',
    '#pragma GCC diagnostic ignored "-Wmissing-prototypes"',
    '#define main learner_main',
    `#include ${cString(learnerFile)}`,
    '#undef main',
    '#pragma GCC diagnostic pop',
    'int check_tests_main_(void);',
    '#define main check_tests_main_',
    `#line 1 ${cString(testFile)}`,
    body + '#undef main',
    `#line ${after} ${cString(HARNESS_FILE)}`,
    'int main(void) {',
    '    check_tests_main_();',
    '    fflush(stdout);',
    `    puts("\\n${DONE_MARKER}");`,
    '    return 0;',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- reading test files

/** Removes comments while keeping string and character literals (and line structure) intact. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = src.slice(i, end < 0 ? src.length : end + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      i += chunk.length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Decodes the C escapes that are likely in a check name. */
function unescapeC(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, e: string) => {
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ({ n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v' } as Record<string, string>)[e] ?? e;
  });
}

/** Splits a macro argument list at top-level commas (respecting parentheses and literals). */
function splitArgs(src: string, open: number): { args: string[]; end: number } | undefined {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(src.slice(start, i).trim()); return { args, end: i }; }
    } else if (c === ',' && depth === 1) { args.push(src.slice(start, i).trim()); start = i + 1; }
  }
  return undefined;
}

const CHECK_MACROS = new Set(['CHECK', 'CHECK_EQ_INT', 'CHECK_EQ_LL', 'CHECK_EQ_CHAR', 'CHECK_EQ_STR', 'CHECK_EQ_DBL']);

/**
 * Names of the checks a test file makes, in source order, read from the last (string-literal)
 * argument of each CHECK* call. Calls whose name is not a literal are ignored; their results still
 * appear when they report.
 */
export function extractCheckNames(testSource: string): string[] {
  const src = stripComments(testSource).replace(/^[ \t]*#.*$/gm, ''); // ignore preprocessor lines
  const names: string[] = [];
  for (const m of src.matchAll(/\b(CHECK\w*)\s*\(/g)) {
    if (!CHECK_MACROS.has(m[1])) continue;
    const parsed = splitArgs(src, m.index! + m[0].length - 1);
    const last = parsed?.args.at(-1);
    if (!last || !/^"(?:[^"\\]|\\.)*"(?:\s*"(?:[^"\\]|\\.)*")*$/.test(last)) continue;
    const name = [...last.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(p => unescapeC(p[1])).join('');
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// ---------------------------------------------------------------- reading harness output

export interface SubtestResult {
  name: string;
  status: 'pass' | 'fail';
  /** For failures: what the check printed ("expected 'a' (97), got '{' (123)"), or why it never reported. */
  message?: string;
}

export interface HarnessOutput {
  subtests: SubtestResult[];
  /** True when the harness printed @@DONE (every check ran). */
  done: boolean;
  /** Expected names that never reported. */
  missing: string[];
}

export const NEVER_REPORTED = 'never ran: the test program stopped before reaching this check';

/**
 * Reads @@PASS/@@FAIL/@@DONE lines. Results are listed in the order of `expected` (the names found in
 * the test file), followed by any other names that reported. A name that reports more than once fails
 * if any report failed.
 */
export function parseHarnessOutput(stdout: string, expected: readonly string[] = []): HarnessOutput {
  const reported = new Map<string, SubtestResult>();
  for (const m of stdout.matchAll(/^@@(PASS|FAIL) ([^\t\r\n]*)(?:\t([^\r\n]*))?\r?$/gm)) {
    const name = m[2];
    const prev = reported.get(name);
    if (prev?.status === 'fail') continue;
    reported.set(name, m[1] === 'PASS' ? { name, status: 'pass' } : { name, status: 'fail', message: m[3] ?? '' });
  }
  const done = new RegExp(`^${DONE_MARKER}\\r?$`, 'm').test(stdout);
  const subtests: SubtestResult[] = [];
  const missing: string[] = [];
  for (const name of expected) {
    const r = reported.get(name);
    if (r) subtests.push(r);
    else { missing.push(name); subtests.push({ name, status: 'fail', message: NEVER_REPORTED }); }
  }
  for (const [name, r] of reported) if (!expected.includes(name)) subtests.push(r);
  return { subtests, done, missing };
}
