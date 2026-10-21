// Native sessions: the normaliser on real tool output (fixtures/session-captures, captured with gcc 13, clang 22.1.8,
// gdb 16, lldb 22.1.8 and valgrind 3.24 in /tmp/tdcc-capture-7Kq2), session.yaml validation, and the run checks.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverSessions, normaliseSession, runSession, stepsFor, type SessionSpec } from './session';
import { targetRunSessions, type TargetSessionsFile } from './sessions-file';
import { targetRunFails } from './verify';
import type { NativeToolchain } from './native';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = '/tmp/tdcc-capture-7Kq2';
const capture = (name: string) => readFileSync(path.join(HERE, 'fixtures/session-captures', `${name}.txt`), 'utf8');
const norm = (name: string) => normaliseSession([capture(name)], [DIR])[0];

describe('normaliseSession on captured output', () => {
  it('gdb: drops the libthread_db lines and the inferior PID, keeps the short breakpoint offset', () => {
    const raw = capture('gdb');
    expect(raw).toMatch(/libthread_db/);
    expect(raw).toMatch(/\(process \d+\) exited normally/);
    const t = norm('gdb');
    expect(t).not.toMatch(/libthread_db/);
    expect(t).toContain('[Inferior 1 (process <pid>) exited normally]');
    expect(t).toContain('Breakpoint 1 at 0x1184: file w.c, line 6.');
  });

  it('lldb: the work dir, PIDs and addresses become stable names', () => {
    const t = norm('lldb');
    expect(t).toContain("Current executable set to '<dir>/wc' (x86_64).");
    expect(t).toMatch(/^Process <pid> launched: '<dir>\/wc' \(x86_64\)$/m);
    expect(t).toMatch(/^ {4}frame #0: <addr\d+> wc`main at w\.c:6:18$/m);
    expect(t).toMatch(/exited with status = 0 \(0x00000000\)/); // all zeros is not an address
    expect(t).not.toMatch(/\/tmp\/|Process \d|0x(?!0+\b)[0-9a-f]{5,}/);
  });

  it('valgrind: ==PID==, and the banner lines with the version and copyright are dropped', () => {
    const raw = capture('valgrind');
    expect(raw).toMatch(/^==\d+== Copyright/m);
    const t = norm('valgrind');
    expect(t.split('\n')[0]).toBe('==PID== Memcheck, a memory error detector');
    expect(t).not.toMatch(/Copyright|Using Valgrind-|==\d+==/);
    expect(t).toContain('==PID== Command: ./lg');
    expect(t).toMatch(/==PID== 40 bytes in 1 blocks are definitely lost in loss record 1 of 1\n==PID== {4}at <addr1>: malloc/);
    // `-v` and tool warnings print `--PID--` lines (not in this capture).
    expect(normaliseSession(['--4242-- warning: set address range perms: large range\n'], [])).toEqual(['--PID-- warning: set address range perms: large range\n']);
  });

  it('ASan: addresses are numbered by first appearance, equal addresses keep one token, build ids go', () => {
    const t = norm('asan');
    const [, access] = /stack-buffer-overflow on address (<addr\d+>)/.exec(t)!;
    expect(t).toContain(`WRITE of size 4 at ${access} thread T0`);
    expect(t).toContain(`Address ${access} is located in stack of thread T0`);
    expect(t).toMatch(/#0 <addr\d+> in main <dir>\/main\.c:5:39/);
    expect(t).toContain('BuildId: <id>');
    expect(t).not.toMatch(/==\d+==|0x[0-9a-f]{5,}|BuildId: [0-9a-f]/);
  });

  it('ld: compiler temp objects become <tmpN> with their extension (gcc /tmp/ccXXXX.o, clang /tmp/<name>-<hash>.o)', () => {
    expect(capture('ld-gcc')).toMatch(/\/tmp\/cc\w+\.o: in function/);
    expect(norm('ld-gcc')).toBe("/usr/bin/ld: <tmp1>.o: in function `main':\n<dir>/undef.c:6:(.text+0x13): undefined reference to `area'\ncollect2: error: ld returned 1 exit status\n");
    expect(norm('ld-clang')).toContain("<tmp1>.o: in function `main':\n<dir>/undef.c:6:(.text+0x1a): undefined reference to `area'");
  });

  it('numbers addresses across stdout and stderr of one step', () => {
    expect(normaliseSession(['p = 0x7ffd5e0c1a2c\n', 'r = 0x55d0c0de0000, q = 0x7ffd5e0c1a2c\n'], [])).toEqual(['p = <addr1>\n', 'r = <addr2>, q = <addr1>\n']);
  });

  it('macOS leaks: the header lines with dates and versions go, the process PID is replaced', () => {
    const raw = 'Process:         prog [4242]\nDate/Time:       2026-10-21 01:02:03.456 +0000\nOS Version:      macOS 14.7 (23H124)\nParent Process:  leaks [4241]\nleaks Report Version: 4.0\n';
    expect(normaliseSession([raw], [])[0]).toBe('Process:         prog [<pid>]\nleaks Report Version: 4.0\n');
  });
});

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function contentWith(sessions: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'tdcc-session-test-'));
  roots.push(root);
  for (const [id, files] of Object.entries(sessions)) {
    const dir = path.join(root, 'modules/m97-sessions/sessions', id);
    mkdirSync(dir, { recursive: true });
    for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text);
  }
  return root;
}

// macOS captures: the stored steps of Targets run 39510251850 (macos-14, Apple clang 15, b9af3bf; macos-ld-duplicate.txt:
// run 39551410511, 7eb7881), as written to its
// sessions-fixture artifact, so the rules of that commit (<dir>, <addrN>, <pid>, ==PID==) had already run. The second
// run's lines come from the run's own instability report in the same file.
describe('normaliseSession on macOS output (Targets run 39510251850)', () => {
  const swap = (text: string, pairs: Array<[string, string]>) => pairs.reduce((t, [a, b]) => { expect(t).toContain(a); return t.replace(a, b); }, text);
  it('bash\'s signal-death line: the PID after `bash: line N:` becomes <pid>, and two runs agree', () => {
    for (const [name, pid, other] of [['macos-asan', '8667', '9261'], ['macos-ubsan', '9666', '9786']]) {
      const raw = capture(name);
      const t = normaliseSession([raw], [])[0];
      expect(t).toContain('bash: line 1:  <pid> Abort trap: 6           ./prog\n');
      expect(t).not.toContain(pid);
      expect(normaliseSession([swap(raw, [[`  ${pid} Abort`, `  ${other} Abort`]])], [])[0]).toBe(t);
    }
    // Only after that prefix: other numbers on such a line, or elsewhere, stay.
    expect(normaliseSession(['line 1:  8667 Abort trap: 6\nbash: line 12: 8667 Killed: 9  sleep 30\n'], [])[0]).toBe('line 1:  8667 Abort trap: 6\nbash: line 12: <pid> Killed: 9  sleep 30\n');
  });

  it('leaks: the Physical footprint lines are dropped, and two runs agree', () => {
    const raw = capture('macos-leaks');
    const t = normaliseSession([raw], [])[0];
    expect(raw).toMatch(/^Physical footprint: +3345K\nPhysical footprint \(peak\): +3345K$/m);
    expect(t).not.toContain('Physical footprint');
    expect(t).toMatch(/^Platform: +macOS\n\nReport Version: +7\n/m);
    expect(t).toMatch(/Process <pid>: 1 leak for 48 total leaked bytes\.\n/);
    expect(normaliseSession([swap(raw, [['footprint:         3345K', 'footprint:         3329K'], ['(peak):  3345K', '(peak):  3329K']])], [])[0].replace(/Binary Images[^]*/, '')).toBe(t.replace(/Binary Images[^]*/, ''));
  });

  it('leaks: the whole Binary Images block is dropped (its UUIDs change with each link), and two runs agree', () => {
    const raw = capture('macos-leaks');
    expect(raw).toMatch(/^Binary Images:\n.*\+prog \(0\) <DACD0D32-8E25-46FE-A60A-472F5E3E7DE8>/m);
    const t = normaliseSession([raw], [])[0];
    expect(t).not.toMatch(/Binary Images|libobjc|DACD0D32/);
    expect(t).toMatch(/ROOT LEAK: <malloc in main <addr\d+>> \[48\]\n*$/);
    expect(normaliseSession([swap(raw, [['DACD0D32-8E25-46FE-A60A-472F5E3E7DE8', '929A32F2-FCC2-4506-95FD-7B6CE896E51B']])], [])[0]).toBe(t);
    // It ends at a blank line: what follows stays.
    expect(normaliseSession(['a\nBinary Images:\n  x.dylib\n\nafter\n'], [])[0]).toBe('a\n\nafter\n');
  });

  it('Apple ld: the files of a duplicate symbol are sorted, so either order agrees (Targets run 39551410511)', () => {
    const raw = capture('macos-ld-duplicate');
    expect(raw).toContain("duplicate symbol '_count' in:\n    <dir>/bump.o\n    <dir>/main.o\n");
    const swapped = raw.replace('    <dir>/bump.o\n    <dir>/main.o\n', '    <dir>/main.o\n    <dir>/bump.o\n');
    expect(swapped).not.toBe(raw);
    const t = normaliseSession([raw], [])[0];
    expect(normaliseSession([swapped], [])[0]).toBe(t);
    expect(t).toBe("duplicate symbol '_count' in:\n    <dir>/bump.o\n    <dir>/main.o\nld: 1 duplicate symbols\nclang: error: linker command failed with exit code 1 (use -v to see invocation)\n");
  });
});

describe('normaliseSession on a program\'s own output', () => {
  const out = 'mask = 0xDEADBEEF\nprocess 3 items\n0x10000 vs 0x00010000\nPID: 7\n';
  it('a step without `as:` keeps hex, PIDs and numbers as printed; only the work dir and temp files change', () => {
    expect(normaliseSession([out + 'in /w/x and /tmp/ccAbC123.o\n'], ['/w'], { tool: false })).toEqual([out + 'in <dir>/x and <tmp1>.o\n']);
  });
  it('a tool step (`as:`) gets the address and PID rules', () => {
    expect(normaliseSession([out], [], { tool: true })).toEqual(['mask = <addr1>\nprocess <pid> items\n<addr2> vs <addr2>\nPID: <pid>\n']);
  });
});

describe('discoverSessions', () => {
  it('reads the step groups, with exit defaulting to ok', () => {
    const root = contentWith({ hello: { 'session.yaml': 'steps:\n  all:\n    - run: echo hi\n  linux:\n    - run: "false"\n      exit: fail\n      as: ld\n' } });
    const { sessions, errors } = discoverSessions(root);
    expect(errors).toEqual([]);
    expect(sessions[0]).toMatchObject({ id: 'hello', module: 'm97', groups: { all: [{ run: 'echo hi', exit: 'ok' }], linux: [{ run: 'false', exit: 'fail', as: 'ld' }], macos: [] } });
  });

  it('rejects unknown groups and keys, a bad exit or only, a missing run, no steps and a non-kebab id', () => {
    const bad = (yaml: string, id = 'bad') => discoverSessions(contentWith({ [id]: { 'session.yaml': yaml } })).errors.join('\n');
    expect(bad('steps:\n  windows:\n    - run: x\n')).toMatch(/steps\.windows: expected one of all, linux, macos/);
    expect(bad('steps:\n  all:\n    - run: x\n      expect: ok\n')).toMatch(/unknown key\(s\) expect/);
    expect(bad('steps:\n  all:\n    - run: x\n      exit: maybe\n')).toMatch(/exit must be ok, fail or any/);
    expect(bad('steps:\n  all:\n    - run: x\n      only: msvc\n')).toMatch(/only must be gcc or clang/);
    expect(bad('steps:\n  all:\n    - as: ld\n')).toMatch(/needs `run: <shell command>`/);
    expect(bad('steps:\n  all: []\n')).toMatch(/has no steps/);
    expect(bad('title: x\n')).toMatch(/needs `steps:`/);
    expect(bad('steps:\n  all:\n    - run: x\n', 'Bad_Id')).toMatch(/lower-case kebab-case/);
  });

  it('rejects a session id used in two modules (ids are unique across the course)', () => {
    const root = contentWith({ same: { 'session.yaml': 'steps:\n  all:\n    - run: x\n' } });
    const other = path.join(root, 'modules/m96-other/sessions/same');
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, 'session.yaml'), 'steps:\n  all:\n    - run: x\n');
    const { sessions, errors } = discoverSessions(root);
    expect(sessions).toHaveLength(1);
    expect(errors.join('\n')).toMatch(/duplicate session id "same" \(ids are unique across the course/);
  });
});

describe('stepsFor', () => {
  const spec = { groups: { all: [{ run: 'a', exit: 'ok' }, { run: 'gdb', exit: 'ok', only: 'gcc' }], linux: [{ run: 'lldb', exit: 'ok', only: 'clang' }], macos: [{ run: 'leaks', exit: 'any' }] } } as unknown as SessionSpec;
  it('runs all, then the platform group, without the other compiler\'s steps (macOS counts as clang)', () => {
    expect(stepsFor(spec, 'linux-gcc').map(s => s.run)).toEqual(['a', 'gdb']);
    expect(stepsFor(spec, 'linux-clang').map(s => s.run)).toEqual(['a', 'lldb']);
    expect(stepsFor(spec, 'macos').map(s => s.run)).toEqual(['a', 'leaks']);
  });
});

describe('runSession', () => {
  const tools = () => ({ cc: 'cc', lldb: 'lldb', workRoot: mkdtempSync(path.join(tmpdir(), 'tdcc-session-work-')) });
  const one = (yaml: string, files: Record<string, string> = {}) => discoverSessions(contentWith({ s: { 'session.yaml': yaml, ...files } })).sessions[0];

  it('runs the steps in order in one work dir, with stdin, LC_ALL=C and the work dir normalised', async () => {
    const r = await runSession(one('steps:\n  all:\n    - run: cat > got.txt && pwd && echo "$LC_ALL $CC $CFLAGS"\n      stdin: "42\\n"\n    - run: cat got.txt input.txt; exit 3\n      exit: fail\n', { 'input.txt': 'data\n' }), 'linux-gcc', tools());
    expect(r.problems).toEqual([]);
    expect(r.steps.map(s => [s.stdout, s.exit])).toEqual([['<dir>\nC cc -std=c17 -Wall -Wextra -pedantic -g -O0\n', 0], ['42\ndata\n', 3]]);
  });

  it('reports a step whose exit status is not the expected kind, naming the step', async () => {
    const r = await runSession(one('steps:\n  all:\n    - run: echo oops >&2; exit 1\n'), 'linux-gcc', tools());
    expect(r.problems).toEqual(['step 1 `echo oops >&2; exit 1`: expected exit ok, got 1\noops']);
  });

  it('a timeout kills the whole step, children included, and records the problem (Targets run 39498908355 hung on leaks)', async () => {
    const t0 = performance.now();
    const r = await runSession(one('steps:\n  all:\n    - run: sleep 8; true\n    - run: echo never\n'), 'linux-gcc', { ...tools(), timeoutMs: 1000 });
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(r.timedOut).toBe(true);
    expect(r.problems).toEqual(['step 1 `sleep 8; true` timed out after 1 s']);
    expect(r.steps).toHaveLength(1);
  });

  it('a background job left running after the step does not hold it open', async () => {
    const t0 = performance.now();
    const r = await runSession(one('steps:\n  all:\n    - run: (sleep 8; echo late) & echo now\n'), 'linux-gcc', { ...tools(), timeoutMs: 20_000 });
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(r.problems).toEqual([]);
    expect(r.steps[0].stdout).toBe('now\n');
  });

  it.skipIf(spawnSync('setsid', ['--version']).status !== 0)('a process that left the group (setsid) holds the pipes for at most 2 s more', async () => {
    const t0 = performance.now();
    const r = await runSession(one('steps:\n  all:\n    - run: setsid sleep 8 & sleep 0.5; echo now\n'), 'linux-gcc', { ...tools(), timeoutMs: 20_000 });
    expect(performance.now() - t0).toBeLessThan(9000); // two runs of ~2.5 s; without the cut-off, 2 × 8 s
    expect(r.steps[0]).toMatchObject({ stdout: 'now\n', exit: 0 });
  }, 15_000);

  it('normalises addresses only in steps with `as:`', async () => {
    const r = await runSession(one('steps:\n  all:\n    - run: echo "mask = 0xDEADBEEF, process 3 items"\n    - run: echo "mask = 0xDEADBEEF, process 3 items"\n      as: tool\n'), 'linux-gcc', tools());
    expect(r.steps.map(s => s.stdout)).toEqual(['mask = 0xDEADBEEF, process 3 items\n', 'mask = <addr1>, process <pid> items\n']);
  });

  it('rejects a step whose output differs between two runs (the stability check)', async () => {
    const r = await runSession(one('steps:\n  all:\n    - run: echo stable\n    - run: date +%N\n'), 'linux-gcc', tools());
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^step 2 `date \+%N` is unstable: its stdout differs between two runs\n- \d+\n\+ \d+/);
  });

  it('reports a signal death as 128 + the signal number, as the shell does', async () => {
    const r = await runSession(one('steps:\n  all:\n    - run: kill -SEGV $$\n      exit: fail\n'), 'linux-gcc', tools());
    expect(r.steps[0].exit).toBe(139);
  });
});

describe('targetRunSessions (macOS on the Targets workflow)', () => {
  it('writes a failing session into the file with its problems and returns them as warnings, not failures', async () => {
    const root = contentWith({ good: { 'session.yaml': 'steps:\n  macos:\n    - run: echo ok\n' }, broken: { 'session.yaml': 'steps:\n  all:\n    - run: exit 3\n' } });
    const outDir = mkdtempSync(path.join(tmpdir(), 'tdcc-session-out-'));
    roots.push(outDir);
    const tc = { target: 'macos-arm64-appleclang', kind: 'clang', cc: 'cc', version: 'cc test', sanitizers: false } as const satisfies NativeToolchain;
    const r = await targetRunSessions({ contentRoot: root, outDir, cacheDir: path.join(outDir, 'cache'), workRoot: path.join(outDir, 'work'), tc });
    expect(r).not.toHaveProperty('problems');
    expect(r.warnings).toEqual(['modules/m97-sessions/sessions/broken (macos): step 1 `exit 3`: expected exit ok, got 3']);
    const file = JSON.parse(readFileSync(path.join(outDir, 'm97.sessions.json'), 'utf8')) as TargetSessionsFile;
    expect(file.sessions.good).toMatchObject({ steps: [{ stdout: 'ok\n', exit: 0 }] });
    expect(file.sessions.good.problems).toBeUndefined();
    expect(file.sessions.broken).toMatchObject({ steps: [{ exit: 3 }], problems: ['step 1 `exit 3`: expected exit ok, got 3'] });
  });
});

describe('targetRunFails (the exit status of --target-run)', () => {
  it('session problems fail only with --strict-sessions (the Targets fixture step); sample problems always fail', () => {
    expect(targetRunFails({ problems: [], warnings: ['asan (macos): unstable'] }, false)).toBe(false);
    expect(targetRunFails({ problems: [], warnings: ['asan (macos): unstable'] }, true)).toBe(true);
    expect(targetRunFails({ problems: ['fx: exit 1'], warnings: [] }, false)).toBe(true);
    expect(targetRunFails({ problems: [], warnings: [] }, true)).toBe(false);
  });
});
