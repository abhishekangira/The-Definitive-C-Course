import { describe, expect, it } from 'vitest';
import type { Diagnostic, TestsSpec } from '../content-model/types';
import type { CompileOptions, CompileOutcome, ExecBackend, ExecOutcome, ExecRunOptions, MakeOptions, MakeOutcome } from './exec';
import { outcomeFromWasi } from './exec';
import { CHECK_H_FILE, HARNESS_FILE } from './harness';
import { MEMORY_SLOWDOWN, plannedTests, runTests, type TestResult } from './runner';

interface Artifact { files: Record<string, string>; sources: string[]; opts: CompileOptions }

interface FakeOptions {
  compile?(files: Record<string, string>, sources: string[], opts: CompileOptions): Partial<CompileOutcome<Artifact>>;
  run(a: Artifact, o: ExecRunOptions): Partial<ExecOutcome>;
  make?(target: string, o: MakeOptions): MakeOutcome;
  combined?: boolean;
  memoryNote?: string;
  memoryHint?: string;
}

/** A scriptable backend that records every call. */
function fake(o: FakeOptions) {
  const calls = { compile: [] as Array<{ sources: string[]; opts: CompileOptions; files: Record<string, string> }>, run: [] as Array<{ a: Artifact; o: ExecRunOptions }> };
  const backend: ExecBackend<Artifact> = {
    name: 'fake cc',
    combinedMemoryBuild: o.combined,
    memoryNote: o.memoryNote,
    memoryHint: o.memoryHint,
    async compile(files, sources, opts) {
      calls.compile.push({ files, sources, opts });
      const r = o.compile?.(files, sources, opts) ?? {};
      const ok = r.ok ?? true;
      return { ok, diagnostics: r.diagnostics ?? [], raw: r.raw ?? '', artifact: ok ? { files, sources, opts } : undefined };
    },
    async run(a, ro) {
      calls.run.push({ a, o: ro });
      return { stdout: '', stderr: '', exit: 0, ...o.run(a, ro) };
    },
    ...(o.make ? { make: async (t: string, mo: MakeOptions) => o.make!(t, mo) } : {}),
  };
  return { backend, calls };
}

const warn = (msg: string): Diagnostic => ({ file: 'main.c', line: 3, col: 14, severity: 'warning', message: msg, flag: '-Wunused-parameter' });

const SPEC: TestsSpec = {
  version: 1,
  sources: ['main.c'],
  tests: [
    { name: 'says hello', run: { stdin: 'Bob\n' }, expect: { stdout: 'hello, Bob\n' } },
    { name: 'rejects extra args', run: { args: ['x'], stdin: '' }, expect: { exit: 1, stderr: { contains: ['Usage'] } }, hint: 'Check argc.' },
    { name: 'greet() unit tests', unit: { harness: 'tests/test_greet.c' } },
  ],
};
const LEARNER = { 'main.c': 'int main(void) { return 0; }\n' };
const EXERCISE = { 'tests/test_greet.c': 'int main(void) {\n  CHECK(1, "one");\n  CHECK(2, "two");\n}\n' };

/** A correct program, as the fake sees it. */
function goodRun(a: Artifact, o: ExecRunOptions): Partial<ExecOutcome> {
  if (a.sources[0] === HARNESS_FILE) return { stdout: '\n@@PASS one\n\n@@PASS two\n\n@@DONE\n' };
  if (o.args?.length) return { stderr: 'Usage: ./main\n', exit: 1 };
  return { stdout: `hello, ${o.stdin?.trim()}\n` };
}

describe('plannedTests', () => {
  it('compile check first, spec tests, memory check last', () => {
    expect(plannedTests({ ...SPEC, memory: true }).map(p => `${p.kind}:${p.name}`)).toEqual([
      'compile:compiles without warnings', 'io:says hello', 'io:rejects extra args', 'unit:greet() unit tests', 'memory:no memory errors or leaks',
    ]);
    expect(plannedTests({ ...SPEC, warnings: 'allow' })[0].name).toBe('compiles');
  });
});

describe('runTests', () => {
  it('passes a correct program and streams results in order', async () => {
    const { backend, calls } = fake({ run: goodRun });
    const seen: number[] = [];
    const r = await runTests(SPEC, LEARNER, EXERCISE, backend, { onResult: (_, i) => seen.push(i) });
    expect(r.results.map(x => x.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(r).toMatchObject({ passed: 4, total: 4, allPassed: true, bits: '1111', backend: 'fake cc' });
    expect(seen).toEqual([0, 1, 2, 3]);
    // The harness build gets check.h and the generated translation unit; the learner build does not.
    expect(calls.compile[0].sources).toEqual(['main.c']);
    expect(calls.compile[1].sources).toEqual([HARNESS_FILE]);
    expect(Object.keys(calls.compile[1].files)).toEqual(expect.arrayContaining([CHECK_H_FILE, HARNESS_FILE, 'main.c', 'tests/test_greet.c']));
    expect(calls.compile[1].files[HARNESS_FILE]).toContain('#include "main.c"');
    expect(r.results[3].subtests).toEqual([{ name: 'one', status: 'pass' }, { name: 'two', status: 'pass' }]);
  });

  it('fails the first check on warnings but still runs the rest', async () => {
    const { backend } = fake({ compile: () => ({ diagnostics: [warn("unused parameter 'argc'")] }), run: goodRun });
    const r = await runTests(SPEC, LEARNER, EXERCISE, backend);
    expect(r.results[0]).toMatchObject({
      name: 'compiles without warnings', status: 'fail', message: 'the compiler printed 1 warning',
      details: ["main.c:3:14: warning: unused parameter 'argc' [-Wunused-parameter]"],
    });
    expect(r.results[0].hint).toMatch(/-Wall -Wextra -pedantic/);
    expect(r.bits).toBe('0111');
  });

  it('ignores warnings when the spec allows them, and warnings in support files always', async () => {
    const { backend } = fake({ compile: () => ({ diagnostics: [warn('x')] }), run: goodRun });
    expect((await runTests({ ...SPEC, warnings: 'allow' }, LEARNER, EXERCISE, backend)).results[0]).toMatchObject({ name: 'compiles', status: 'pass' });
    const { backend: b2 } = fake({ compile: () => ({ diagnostics: [{ ...warn('x'), file: 'leakcheck.c' }] }), run: goodRun });
    expect((await runTests(SPEC, LEARNER, EXERCISE, b2)).results[0].status).toBe('pass');
  });

  it('skips everything after a compile error', async () => {
    const { backend, calls } = fake({
      compile: () => ({ ok: false, diagnostics: [{ file: 'main.c', line: 5, col: 3, severity: 'error', message: "expected ';' before 'return'" }] }),
      run: goodRun,
    });
    const r = await runTests({ ...SPEC, memory: true }, LEARNER, EXERCISE, backend);
    expect(r.results[0]).toMatchObject({ status: 'fail', message: "your code doesn't compile yet", details: ["main.c:5:3: error: expected ';' before 'return'"] });
    expect(r.results.slice(1).map(x => [x.status, x.message])).toEqual(Array(4).fill(['skip', "can't check this until your code compiles"]));
    expect(r.bits).toBe('00000');
    expect(calls.run).toHaveLength(0);
  });

  it('explains link errors that have no file:line', async () => {
    const { backend } = fake({ compile: () => ({ ok: false, raw: "/usr/bin/ld: /tmp/cc.o: in function `main':\nmain.c:(.text+0x9): undefined reference to `greet'\ncollect2: error: ld returned 1 exit status\n" }), run: goodRun });
    const r = await runTests(SPEC, LEARNER, EXERCISE, backend);
    expect(r.results[0].message).toBe("your code doesn't compile yet: the function greet() is called but never defined (a typo, or a file missing from the build?)");
    expect(r.results[0].details).toEqual(["main.c:(.text+0x9): undefined reference to `greet'"]);
  });

  it('reports wrong output with the first difference', async () => {
    const { backend } = fake({ run: (a, o) => (o.stdin ? { stdout: 'hello, bob\n' } : goodRun(a, o)) });
    const r = (await runTests(SPEC, LEARNER, EXERCISE, backend)).results[1];
    expect(r).toMatchObject({
      status: 'fail', stream: 'stdout', how: 'exactly', expected: 'hello, Bob\n', actual: 'hello, bob\n', command: './main', stdin: 'Bob\n',
      message: "wrong output: first difference on line 1, character 8: expected 'B', got 'b'",
    });
    expect(r.firstDiff).toMatchObject({ line: 1, column: 8 });
  });

  it('explains crashes, timeouts, traps, undefined behaviour and exit codes', async () => {
    const cases: Array<[Partial<ExecOutcome>, RegExp]> = [
      [{ signal: 'SIGSEGV', exit: null, stdout: 'hel' }, /^it crashed with a segmentation fault/],
      [{ timedOut: true, exit: null }, /still running after 2 s/],
      [{ trap: 'memory access out of bounds', exit: null }, /Natively this is SIGSEGV/],
      [{ stderr: "main.c:4:9: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'\n", exit: 1 }, /^undefined behaviour at main\.c:4: signed integer overflow/],
      [{ stdout: 'hello, Bob\n', exit: 3 }, /^expected exit code 0, but it exited with 3$/],
    ];
    for (const [out, re] of cases) {
      const { backend } = fake({ run: (a, o) => (o.stdin === 'Bob\n' ? out : goodRun(a, o)) });
      const r = (await runTests(SPEC, LEARNER, EXERCISE, backend)).results[1];
      expect(r.status).toBe('fail');
      expect(r.message).toMatch(re);
    }
  });

  it('attaches hint tiers to failures only', async () => {
    const spec: TestsSpec = { ...SPEC, tests: [{ ...SPEC.tests[1], hints: ['Look at argc.', 'argc counts the program name too.'] } as unknown as TestsSpec['tests'][number]] };
    const { backend } = fake({ run: () => ({ exit: 0 }) });
    const r = (await runTests(spec, LEARNER, EXERCISE, backend)).results[1];
    expect(r).toMatchObject({ hint: 'Look at argc.', hints: ['Look at argc.', 'argc counts the program name too.'] });
    const { backend: ok } = fake({ run: goodRun });
    expect((await runTests(spec, LEARNER, EXERCISE, ok)).results[1].hint).toBeUndefined();
  });

  it('unit tests: failed checks, a crash part-way, and harness compile errors', async () => {
    const failing = fake({ run: (a, o) => (a.sources[0] === HARNESS_FILE ? { stdout: '@@PASS one\n@@FAIL two\texpected 2, got 3\n@@DONE\n' } : goodRun(a, o)) });
    const r1 = (await runTests(SPEC, LEARNER, EXERCISE, failing.backend)).results[3];
    expect(r1).toMatchObject({ status: 'fail', message: '1 of 2 checks failed', subtests: [{ name: 'one', status: 'pass' }, { name: 'two', status: 'fail', message: 'expected 2, got 3' }] });

    const crashing = fake({ run: (a, o) => (a.sources[0] === HARNESS_FILE ? { stdout: '@@PASS one\n', signal: 'SIGSEGV', exit: null } : goodRun(a, o)) });
    const r2 = (await runTests(SPEC, LEARNER, EXERCISE, crashing.backend)).results[3];
    expect(r2.status).toBe('fail');
    expect(r2.message).toMatch(/^it crashed with a segmentation fault/);
    expect(r2.subtests![1]).toMatchObject({ name: 'two', status: 'fail' });
    expect(r2.subtests![1].message).toMatch(/^never ran: it crashed with a segmentation fault/);

    const exited = fake({ run: (a, o) => (a.sources[0] === HARNESS_FILE ? { stdout: '@@PASS one\n@@PASS two\n', exit: 1 } : goodRun(a, o)) });
    const r3 = (await runTests(SPEC, LEARNER, EXERCISE, exited.backend)).results[3];
    expect(r3.subtests!.at(-1)).toMatchObject({ name: '(after the last check)', status: 'fail' });
    expect(r3.subtests!.at(-1)!.message).toMatch(/stopped early with exit code 1/);

    const noCompile = fake({
      compile: (_f, s) => (s[0] === HARNESS_FILE ? { ok: false, diagnostics: [{ file: 'tests/test_greet.c', line: 2, col: 3, severity: 'error', message: "call to undeclared function 'greet'" }] } : {}),
      run: goodRun,
    });
    const r4 = (await runTests(SPEC, LEARNER, EXERCISE, noCompile.backend)).results[3];
    expect(r4).toMatchObject({ status: 'fail', message: "the unit tests don't compile against your code", details: ["tests/test_greet.c:2:3: error: call to undeclared function 'greet'"] });
    expect(r4.hint).toMatch(/exactly the name/);
  });

  it('compiles and runs a harness shared by two unit tests once', async () => {
    const spec: TestsSpec = { ...SPEC, tests: [SPEC.tests[2], { name: 'again', unit: { harness: 'tests/test_greet.c' } }] };
    const { backend, calls } = fake({ run: goodRun });
    const r = await runTests(spec, LEARNER, EXERCISE, backend);
    expect(r.results.map(x => x.status)).toEqual(['pass', 'pass', 'pass']);
    expect(calls.compile.filter(c => c.sources[0] === HARNESS_FILE)).toHaveLength(1);
  });

  it('browser (combined) memory check: one leak-checked build, issues gathered from the I/O runs', async () => {
    const { backend, calls } = fake({
      combined: true, memoryNote: 'leak checker',
      run: (a, o) => ({ ...goodRun(a, o), leakcheck: o.stdin === 'Bob\n' ? [{ type: 'leak', bytes: 12, file: 'main.c', line: 14 }] : [] }),
    });
    const r = await runTests({ ...SPEC, leakcheck: true }, LEARNER, EXERCISE, backend);
    expect(calls.compile[0].opts.leakcheck).toBe(true);
    expect(calls.compile.some(c => c.opts.purpose === 'memory')).toBe(false);
    expect(r.results[4]).toMatchObject({
      name: 'no memory errors or leaks', status: 'fail', message: 'memory leak: 12 bytes allocated at main.c:14 were never freed',
      details: ['seen while running ./main with input "Bob\\n"'],
    });
    const { backend: clean } = fake({ combined: true, memoryNote: 'leak checker', run: goodRun });
    expect((await runTests({ ...SPEC, leakcheck: true }, LEARNER, EXERCISE, clean)).results[4]).toMatchObject({ status: 'pass', note: 'leak checker' });
  });

  it('native (separate) memory check: a memory build re-runs the I/O inputs with a longer timeout', async () => {
    const { backend, calls } = fake({
      memoryHint: 'Build with -fsanitize=address,undefined -g and run it yourself.',
      run: (a, o) => (a.opts.leakcheck
        ? { memoryTools: ['AddressSanitizer', 'LeakSanitizer'], memory: o.args?.length ? [] : [{ kind: 'heap-overflow', tool: 'asan', message: 'heap overflow at main.c:9: wrote 1 byte just past the end of a 5-byte block allocated at main.c:7' }] }
        : goodRun(a, o)),
    });
    const r = await runTests({ ...SPEC, memory: true }, LEARNER, EXERCISE, backend);
    expect(calls.compile[0].opts.leakcheck).toBe(false);
    expect(calls.compile.at(-1)!.opts).toMatchObject({ leakcheck: true, purpose: 'memory' });
    expect(calls.run.filter(c => c.a.opts.leakcheck).map(c => c.o.timeoutMs)).toEqual([2000 * MEMORY_SLOWDOWN, 2000 * MEMORY_SLOWDOWN]);
    expect(r.results[4]).toMatchObject({ status: 'fail', message: expect.stringMatching(/^heap overflow at main\.c:9/), hint: 'Build with -fsanitize=address,undefined -g and run it yourself.' });

    const noLeaks = fake({ run: (a, o) => (a.opts.leakcheck ? { memoryTools: ['AddressSanitizer', 'UBSan'], leaksChecked: false } : goodRun(a, o)) });
    expect((await runTests({ ...SPEC, memory: true }, LEARNER, EXERCISE, noLeaks.backend)).results[4])
      .toMatchObject({ status: 'pass', note: 'AddressSanitizer, UBSan, leaks NOT checked: no leak detector found' });
  });

  it('make tests: skipped without make, failures explained', async () => {
    const spec: TestsSpec = { ...SPEC, tests: [{ name: 'make builds it', make: { target: 'greet', expectRebuild: ['greet.h'] } }] };
    const none = fake({ run: goodRun });
    expect((await runTests(spec, LEARNER, {}, none.backend)).results[1]).toMatchObject({ status: 'skip' });
    const results = await Promise.all([
      { ok: false, exit: 2, output: 'make: *** No rule to make target `greet\'.  Stop.\n' },
      { ok: true, exit: 0, output: '', notRebuilt: ['greet.h'] },
      { ok: true, exit: 0, output: '' },
    ].map(async m => (await runTests(spec, LEARNER, {}, fake({ run: goodRun, make: () => m }).backend)).results[1]));
    expect(results[0]).toMatchObject({ status: 'fail', message: 'make greet failed (exit code 2)' });
    expect(results[1]).toMatchObject({ status: 'fail', message: 'after greet.h changed, make still thought greet was up to date' });
    expect(results[1].hint).toMatch(/prerequisites/);
    expect(results[2].status).toBe('pass');
  });

  it('--only runs just one check (plus the compile check)', async () => {
    const { backend, calls } = fake({ run: goodRun });
    const r = await runTests(SPEC, LEARNER, EXERCISE, backend, { only: 'rejects extra args' });
    expect(r.results.map(x => x.status)).toEqual(['pass', 'skip', 'pass', 'skip']);
    expect(r.allPassed).toBe(false);
    expect(calls.run).toHaveLength(1);
  });

  it('--only on the memory check still runs I/O tests silently in combined mode', async () => {
    const { backend, calls } = fake({ combined: true, run: (a, o) => ({ ...goodRun(a, o), leakcheck: [{ type: 'invalid-free', bytes: 0, file: 'main.c', line: 13 }] }) });
    const r = await runTests({ ...SPEC, leakcheck: true }, LEARNER, EXERCISE, backend, { only: 'no memory errors or leaks' });
    expect(r.results.map((x: TestResult) => x.status)).toEqual(['pass', 'skip', 'skip', 'skip', 'fail']);
    expect(r.results[4].message).toBe('invalid free at main.c:13 (double free?)');
    expect(calls.run).toHaveLength(2);
  });
});

describe('file tests', () => {
  const NOTES = { name: 'notes.txt says done', file: { path: 'notes.txt', expect: { contains: ['done'] } } };
  const spec: TestsSpec = { ...SPEC, tests: [NOTES] };
  const enc = (s: string) => new TextEncoder().encode(s);
  const run = async (files: Record<string, Uint8Array>, t: TestsSpec = spec) =>
    runTests(t, LEARNER, {}, fake({ run: goodRun }).backend, { readFile: p => files[p] });

  it('are planned as file tests, never as make tests', () => {
    expect(plannedTests(spec).map(p => p.kind)).toEqual(['compile', 'file']);
  });

  it('pass when the file exists and matches', async () => {
    expect(await run({ 'notes.txt': enc('all done\n') })).toMatchObject({ allPassed: true, bits: '11', results: [{}, { kind: 'file', status: 'pass' }] });
  });

  it('fail when the file is missing', async () => {
    const r = await run({});
    expect(r.bits).toBe('10');
    expect(r.results[1]).toMatchObject({ kind: 'file', status: 'fail', message: 'there is no file notes.txt' });
  });

  it('fail when the content is wrong', async () => {
    const r = await run({ 'notes.txt': enc('todo\n') });
    expect(r.results[1]).toMatchObject({ status: 'fail', how: 'containing', expected: 'done', message: 'notes.txt should contain "done", but it doesn\'t' });
    const exact = await run({ 'notes.txt': enc('done!\n') }, { ...SPEC, tests: [{ ...NOTES, file: { path: 'notes.txt', expect: 'done\n' } }] });
    expect(exact.results[1].message).toMatch(/^notes\.txt is not what it should be: /);
  });

  it('binary files are read one byte per character', async () => {
    const elf = { ...SPEC, tests: [{ name: 'hello is a program', file: { path: 'hello', expect: { matches: '^\\x7fELF' }, binary: true as const } }] };
    const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0xff, 0x00]);
    expect((await run({ hello: bytes }, elf)).results[1].status).toBe('pass');
    // Bytes above 0x7f too: a Mach-O 64-bit header is not valid UTF-8.
    const macho = { ...SPEC, tests: [{ name: 'hello is a program', file: { path: 'hello', expect: { matches: '^\\xcf\\xfa\\xed\\xfe' }, binary: true as const } }] };
    expect((await run({ hello: new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x0c]) }, macho)).results[1].status).toBe('pass');
    expect((await run({ hello: enc('#!/bin/sh\n') }, elf)).results[1]).toMatchObject({ status: 'fail', message: "hello doesn't match the pattern /^\\x7fELF/" });
  });

  it('a backend that cannot read the learner\'s files (the browser) skips them with the reason, never passes', async () => {
    const r = await runTests(spec, LEARNER, {}, fake({ run: goodRun }).backend);
    expect(r.results[1]).toMatchObject({ kind: 'file', status: 'skip', message: 'this check reads notes.txt on your own machine, so only check.mjs runs it' });
    expect(r).toMatchObject({ allPassed: false, passed: 1, bits: '10' });
  });
});

describe('scan tests', () => {
  const SCAN_SPEC: TestsSpec = {
    version: 1,
    sources: ['bitlab.c'],
    tests: [
      { name: 'bit_and works', unit: { harness: 'tests/test_and.c' } },
      { name: 'bit_and uses only ~ and |', scan: { function: 'bit_and', allow: ['~', '|'], maxOps: 4 }, hint: 'Use De Morgan.' },
    ],
  };
  const EX = { 'tests/test_and.c': 'int main(void) {\n  CHECK(1, "all inputs");\n}\n' };
  const unitPass = (a: Artifact): Partial<ExecOutcome> => (a.sources[0] === HARNESS_FILE ? { stdout: '\n@@PASS all inputs\n\n@@DONE\n' } : {});
  const good = { 'bitlab.c': 'int bit_and(int x, int y) { return ~(~x | ~y); }\nint main(void) { return 0; }\n' };
  const cheat = { 'bitlab.c': 'int bit_and(int x, int y) { return x & y; }\nint main(void) { return 0; }\n' };

  it('plans a scan check in order, and passes a conforming solution', async () => {
    expect(plannedTests(SCAN_SPEC).map(p => `${p.kind}:${p.name}`)).toEqual(['compile:compiles without warnings', 'unit:bit_and works', 'scan:bit_and uses only ~ and |']);
    const { backend, calls } = fake({ run: unitPass });
    const r = await runTests(SCAN_SPEC, good, EX, backend);
    expect(r.bits).toBe('111');
    expect(r.results[2]).toMatchObject({ kind: 'scan', status: 'pass', note: '4 of 4 operators used' });
    expect(calls.compile).toHaveLength(2); // the learner build and the harness build: the scan compiles nothing
  });
  it('fails a cheat that passes the unit test, with the plain sentence and the hint', async () => {
    const { backend } = fake({ run: unitPass });
    const r = await runTests(SCAN_SPEC, cheat, EX, backend);
    expect(r.results[1].status).toBe('pass');
    expect(r.results[2]).toMatchObject({
      kind: 'scan', status: 'fail', hint: 'Use De Morgan.',
      message: 'line 1: bit_and() uses &, which is not allowed here (allowed: ~ |)',
    });
    expect(r.bits).toBe('110');
  });
  it('is skipped with the rest when the code does not compile, and honours --only', async () => {
    const { backend } = fake({ compile: () => ({ ok: false }), run: unitPass });
    expect((await runTests(SCAN_SPEC, good, EX, backend)).results[2].status).toBe('skip');
    const { backend: b2 } = fake({ run: unitPass });
    const only = await runTests(SCAN_SPEC, cheat, EX, b2, { only: 'bit_and works' });
    expect(only.results.map(x => x.status)).toEqual(['pass', 'pass', 'skip']);
  });
  it('leaves specs without scan tests exactly as before (kinds and progress bitmap)', async () => {
    expect(plannedTests(SPEC).map(p => p.kind)).toEqual(['compile', 'io', 'io', 'unit']);
    const { backend } = fake({ run: (a, o) => (o.stdin ? { stdout: 'wrong\n' } : goodRun(a, o)) });
    const r = await runTests(SPEC, LEARNER, EXERCISE, backend);
    expect(r.bits).toBe('1011');
  });
});

describe('outcomeFromWasi', () => {
  it('maps every RunResult kind', () => {
    expect(outcomeFromWasi({ kind: 'exit', exitCode: 3, ms: 1 }, 'o', 'e')).toMatchObject({ stdout: 'o', stderr: 'e', exit: 3, trap: null, timedOut: false });
    expect(outcomeFromWasi({ kind: 'trap', exitCode: null, message: 'unreachable', ms: 1 }, '', '')).toMatchObject({ exit: null, trap: 'unreachable' });
    expect(outcomeFromWasi({ kind: 'timeout', exitCode: null, ms: 1 }, '', '')).toMatchObject({ timedOut: true });
    expect(outcomeFromWasi({ kind: 'output-limit', exitCode: null, ms: 1 }, '', '')).toMatchObject({ outputLimit: true });
    expect(outcomeFromWasi({ kind: 'killed', exitCode: null, ms: 1 }, '', '')).toMatchObject({ signal: 'SIGKILL' });
    const leak = [{ type: 'leak' as const, bytes: 1, file: 'a.c', line: 1 }];
    expect(outcomeFromWasi({ kind: 'exit', exitCode: 0, ms: 1, leakcheck: leak }, '', '').leakcheck).toBe(leak);
  });
});
