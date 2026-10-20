// Native sessions: the normaliser on real tool output (fixtures/session-captures, captured with gcc 13, clang 22.1.8,
// gdb 16, lldb 22.1.8 and valgrind 3.24 in /tmp/tdcc-capture-7Kq2), session.yaml validation, and the run checks.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverSessions, normaliseSession, runSession, stepsFor, type SessionSpec } from './session';

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
