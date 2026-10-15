// The fixtures in __fixtures__/memory are real reports from this repo's CI image (gcc 13.3 ASan+UBSan,
// valgrind 3.22), with the build directory shortened to /work.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dedupeIssues, leakEventsToIssues, parseLeaksReport, parseSanitizerReport, parseValgrindReport } from './memory';

const fx = (name: string) => readFileSync(new URL(`./__fixtures__/memory/${name}`, import.meta.url), 'utf8');

describe('leakEventsToIssues (browser leak checker)', () => {
  it('formats leaks, overflows and invalid frees', () => {
    const issues = leakEventsToIssues([
      { type: 'overflow', bytes: 5, file: 'main.c', line: 11 },
      { type: 'invalid-free', bytes: 0, file: 'main.c', line: 13 },
      { type: 'leak', bytes: 12, file: 'main.c', line: 14, seq: 2 },
      { type: 'invalid-realloc', bytes: 8, file: 'main.c', line: 20 },
    ]);
    expect(issues.map(i => i.message)).toEqual([
      'heap overflow: wrote past the end of a 5-byte block allocated at main.c:11',
      'invalid free at main.c:13 (double free?)',
      'invalid realloc at main.c:20: the pointer did not come from malloc, or was already freed',
      'memory leak: 12 bytes allocated at main.c:14 were never freed',
    ]);
    expect(issues[0]).toMatchObject({ kind: 'heap-overflow', tool: 'leakcheck', file: 'main.c', line: 11, bytes: 5 });
  });
  it('merges leaks from one allocation site and handles unknown locations', () => {
    const issues = leakEventsToIssues([
      { type: 'leak', bytes: 4, file: 'list.c', line: 9 },
      { type: 'leak', bytes: 4, file: 'list.c', line: 9 },
      { type: 'leak', bytes: 1, file: '', line: 0 },
      { type: 'invalid-free', bytes: 0, file: '', line: 0 },
    ]);
    expect(issues.map(i => i.message)).toEqual([
      'invalid free of a pointer that malloc did not return (double free?)',
      'memory leak: 2 blocks (8 bytes) allocated at list.c:9 were never freed',
      'memory leak: 1 byte allocated at an unknown location was never freed',
    ]);
  });
});

describe('parseSanitizerReport (gcc 13 ASan + UBSan)', () => {
  const one = (file: string, sources: string[]) => {
    const issues = parseSanitizerReport(fx(file), sources);
    expect(issues).toHaveLength(1);
    return issues[0];
  };
  it('heap-buffer-overflow', () => {
    expect(one('asan-overflow.txt', ['overflow.c'])).toEqual({
      kind: 'heap-overflow', tool: 'asan', file: 'overflow.c', line: 6, bytes: 6,
      message: 'heap overflow at overflow.c:6: wrote 1 byte just past the end of a 6-byte block allocated at overflow.c:4',
    });
  });
  it('heap-use-after-free', () => {
    expect(one('asan-uaf.txt', ['uaf.c']).message)
      .toBe('use after free at uaf.c:7: read 4 bytes from a 40-byte block that was already freed at uaf.c:6 (allocated at uaf.c:4)');
  });
  it('double free and invalid free', () => {
    expect(one('asan-dfree.txt', ['dfree.c']).message).toBe('double free at dfree.c:5: this 5-byte block was already freed at dfree.c:4 (allocated at dfree.c:3)');
    expect(one('asan-badfree.txt', ['badfree.c']).message).toBe("invalid free at badfree.c:5: that pointer did not come from malloc (it points to the local variable 'x')");
  });
  it('stack buffer overflow, SEGV and stack exhaustion', () => {
    expect(one('asan-stack.txt', ['stack.c']).message).toBe("stack buffer overflow at stack.c:4: wrote 4 bytes past the end of the local variable 'a' (declared on line 3)");
    expect(one('asan-null.txt', ['null.c'])).toMatchObject({ kind: 'segv', message: 'segmentation fault at null.c:4: read through a NULL pointer' });
    expect(one('asan-rec.txt', ['rec.c']).message).toMatch(/^stack overflow in f\(\) at rec\.c:2: the call stack ran out/);
  });
  it('LeakSanitizer: direct leaks first, indirect ones explained', () => {
    const issues = parseSanitizerReport(fx('asan-leak.txt'), ['leak.c']);
    expect(issues.map(i => i.message)).toEqual([
      'memory leak: 8 bytes allocated at leak.c:6 were never freed',
      'memory leak: 7 bytes allocated at leak.c:4 were never freed',
      'memory leak: 12 bytes allocated at leak.c:7 were never freed (it was only reachable through another leaked block)',
    ]);
    expect(issues.every(i => i.tool === 'lsan' && i.kind === 'leak')).toBe(true);
  });
  it('UBSan runtime errors', () => {
    expect(one('asan-ub.txt', ['ub.c'])).toMatchObject({
      kind: 'undefined-behaviour', tool: 'ubsan', file: 'ub.c', line: 5,
      message: "undefined behaviour at ub.c:5: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'",
    });
  });
  it('falls back to a heuristic when the learner files are not given', () => {
    expect(parseSanitizerReport(fx('asan-overflow.txt'))[0].file).toBe('overflow.c');
  });
  it('clang 22 frames carry a column', () => {
    const clang = [
      '==1==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x7b46de3e0016 at pc 0x1 bp 0x2 sp 0x3',
      'WRITE of size 1 at 0x7b46de3e0016 thread T0',
      '    #0 0x55af7e3fd90a in main /work/overflow.c:6:10',
      '0x7b46de3e0016 is located 0 bytes after 6-byte region [0x7b46de3e0010,0x7b46de3e0016)',
      'allocated by thread T0 here:',
      '    #0 0x55af7e3b95f8 in malloc (/work/ov22+0xd35f8) (BuildId: c2a1)',
      '    #1 0x55af7e3fd830 in main /work/overflow.c:4:15',
    ].join('\n');
    expect(parseSanitizerReport(clang, ['overflow.c'])[0].message).toBe('heap overflow at overflow.c:6: wrote 1 byte just past the end of a 6-byte block allocated at overflow.c:4');
  });
  it('returns nothing for clean output', () => {
    expect(parseSanitizerReport('hello\n', ['x.c'])).toEqual([]);
  });
});

describe('parseValgrindReport (valgrind 3.22)', () => {
  it('invalid write past a block', () => {
    expect(parseValgrindReport(fx('valgrind-overflow.txt'), ['overflow.c'])).toEqual([{
      kind: 'heap-overflow', tool: 'valgrind', file: 'overflow.c', line: 6, bytes: 6,
      message: 'heap overflow at overflow.c:6: wrote 1 byte just past the end of a 6-byte block allocated at overflow.c:4',
    }]);
  });
  it('use after free, double free, invalid free', () => {
    expect(parseValgrindReport(fx('valgrind-uaf.txt'), ['uaf.c'])[0].message)
      .toBe('use after free at uaf.c:7: read 4 bytes from a 40-byte block that was already freed at uaf.c:6 (allocated at uaf.c:4)');
    expect(parseValgrindReport(fx('valgrind-dfree.txt'), ['dfree.c'])[0].message)
      .toBe('double free at dfree.c:5: this block was already freed at dfree.c:4 (allocated at dfree.c:3)');
    expect(parseValgrindReport(fx('valgrind-badfree.txt'), ['badfree.c'])[0].message)
      .toBe('invalid free at badfree.c:5: that pointer did not come from malloc (it points into the stack)');
  });
  it('leaks: direct part only, indirect explained', () => {
    expect(parseValgrindReport(fx('valgrind-leak.txt'), ['leak.c']).map(i => i.message)).toEqual([
      'memory leak: 7 bytes allocated at leak.c:4 were never freed',
      'memory leak: 8 bytes allocated at leak.c:6 were never freed',
      'memory leak: 12 bytes allocated at leak.c:7 were never freed (it was only reachable through another leaked block)',
    ]);
  });
  it('NULL dereference (two reports of one problem dedupe to one)', () => {
    const issues = dedupeIssues(parseValgrindReport(fx('valgrind-null.txt'), ['null.c']));
    expect(issues).toEqual([{ kind: 'segv', tool: 'valgrind', file: 'null.c', line: 4, message: 'invalid read at null.c:4: through a NULL pointer' }]);
  });
  it('uninitialised values', () => {
    expect(parseValgrindReport(fx('valgrind-uninit.txt'), ['uninit.c'])[0]).toMatchObject({
      kind: 'uninitialised', message: 'used an uninitialised value at uninit.c:4 (conditional jump or move depends on uninitialised values)',
    });
  });
});

describe('parseLeaksReport (macOS leaks --atExit)', () => {
  // Shape from the leaks(1) man page and published samples; not yet run on a real Mac.
  const sample = [
    'Process:         caesar [41023]',
    'leaks Report Version: 4.0, multi-line stacks',
    'Process 41023: 215 nodes malloced for 17 KB',
    'Process 41023: 1 leak for 16 total leaked bytes.',
    '',
    'STACK OF 1 INSTANCE OF \'ROOT LEAK: <malloc in main>\':',
    '3   dyld                       0x18f6b10e0 start + 2360',
    '2   caesar                     0x100003e94 main + 56  caesar.c:42',
    '1   libsystem_malloc.dylib     0x18f8a2a8c _malloc_zone_malloc_instrumented_or_legacy + 128',
    '====',
  ].join('\n');
  it('reports the total and the allocation site', () => {
    expect(parseLeaksReport(sample, ['caesar.c'])).toEqual([{
      kind: 'leak', tool: 'leaks', bytes: 16, file: 'caesar.c', line: 42,
      message: 'memory leak: 1 block (16 bytes) never freed (allocated at caesar.c:42)',
    }]);
  });
  it('reports nothing when there are no leaks', () => {
    expect(parseLeaksReport('Process 1: 0 leaks for 0 total leaked bytes.', ['caesar.c'])).toEqual([]);
  });
});
