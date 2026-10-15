import { describe, expect, it } from 'vitest';
import { isUbsanKind, parseSanitizer, sanitizerKey, ubsanKind } from './sanitizer';

// Trimmed from real gcc 13 / clang 22 reports in this container.
const GCC_UBSAN = `main.c:5:5: runtime error: load of null pointer of type 'int'
    #0 0x556f657af273 in main /tmp/x/main.c:5
    #1 0x7fd4d822a1c9 in __libc_start_call_main ../sysdeps/nptl/libc_start_call_main.h:58
`;
const CLANG_UBSAN = `main.c:5:20: runtime error: load of null pointer of type 'int'
    #0 0x55944eb3b86c in main /tmp/x/main.c:5:20
SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior main.c:5:20
`;
const ASAN = `=================================================================
==3126==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x502000000020 at pc 0x56018636734b bp 0x7ffea1c13220 sp 0x7ffea1c13210
WRITE of size 4 at 0x502000000020 thread T0
    #0 0x56018636734a in main /tmp/x/main.c:6
    #1 0x7f828782a1c9 in __libc_start_call_main ../sysdeps/nptl/libc_start_call_main.h:58

0x502000000020 is located 0 bytes after 16-byte region [0x502000000010,0x502000000020)
allocated by thread T0 here:
    #0 0x7f82884fd9c7 in malloc ../../../../src/libsanitizer/asan/asan_malloc_linux.cpp:69
    #1 0x5601863672be in main /tmp/x/main.c:5

SUMMARY: AddressSanitizer: heap-buffer-overflow /tmp/x/main.c:6 in main
`;
const ASAN_INTERCEPTOR = `==1==ERROR: AddressSanitizer: stack-buffer-overflow on address 0x7ffd at pc 0x1 bp 0x2 sp 0x3
WRITE of size 9 at 0x7ffd thread T0
    #0 0x7f0 in strcpy ../../../../src/libsanitizer/asan/asan_interceptors.cpp:440
    #1 0x55a in main /tmp/x/main.c:7:5
SUMMARY: AddressSanitizer: stack-buffer-overflow main.c:7:5 in main
`;
const LSAN = `=================================================================
==9==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 10 byte(s) in 1 object(s) allocated from:
    #0 0x7f in malloc ../../../../src/libsanitizer/asan/asan_malloc_linux.cpp:69
    #1 0x55 in main /tmp/x/main.c:4

SUMMARY: AddressSanitizer: 10 byte(s) leaked in 1 allocation(s).
`;
const GUARDRAIL = `main.c:7:41: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior main.c:7:41
`;

describe('parseSanitizer', () => {
  it('UBSan: kind and line, columns ignored, same key for gcc and clang', () => {
    const g = parseSanitizer(GCC_UBSAN);
    const c = parseSanitizer(CLANG_UBSAN);
    expect(g).toMatchObject({ ok: false, kind: 'null-pointer-use', file: 'main.c', line: 5 });
    expect(sanitizerKey(g)).toBe(sanitizerKey(c));
    expect(sanitizerKey(g)).toBe('main.c:5:null-pointer-use');
  });

  it('ASan: kind from the ERROR line, line from the first frame in the sample', () => {
    expect(parseSanitizer(ASAN)).toMatchObject({ ok: false, kind: 'heap-buffer-overflow', file: 'main.c', line: 6, report: 'AddressSanitizer: heap-buffer-overflow main.c:6' });
    expect(parseSanitizer(ASAN_INTERCEPTOR)).toMatchObject({ kind: 'stack-buffer-overflow', line: 7 });
  });

  it('LSan: memory-leak at the allocation site', () => {
    expect(parseSanitizer(LSAN)).toMatchObject({ ok: false, kind: 'memory-leak', line: 4, report: 'LeakSanitizer: 10 byte(s) leaked in 1 allocation(s) main.c:4' });
  });

  it('browser guardrail output parses like native UBSan', () => {
    expect(parseSanitizer(GUARDRAIL)).toMatchObject({ kind: 'signed-integer-overflow', line: 7 });
  });

  it('clean stderr is ok', () => {
    expect(parseSanitizer('')).toEqual({ ok: true });
    expect(sanitizerKey({ ok: true })).toBe('clean');
  });

  it('classifies UBSan messages', () => {
    expect(ubsanKind('index 5 out of bounds for type \'int[5]\'')).toBe('array-bounds');
    expect(ubsanKind('shift exponent 40 is too large for 32-bit type \'int\'')).toBe('shift');
    expect(ubsanKind('division by zero')).toBe('integer-divide-by-zero');
    expect(ubsanKind('store to misaligned address 0x1 for type \'int\', which requires 4 byte alignment')).toBe('alignment');
    expect(isUbsanKind('null-pointer-use')).toBe(true);
    expect(isUbsanKind('heap-buffer-overflow')).toBe(false);
  });
});
