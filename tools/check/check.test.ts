// End-to-end tests of the bundled check.mjs on the caesar fixture (ported from the research
// prototype), run the way learners run it: `node check.mjs` inside an unzipped project folder.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildZipFromFolder, projectZipEntries } from '../../src/testing/project-zip';
import type { TestResult } from '../../src/testing/runner';
import { parseLearnerFile, verifyCode } from '../../src/testing/token';
import { buildCheck, LEARNC_H, ROOT } from './build.mjs';
import { assess, SIZEOF_TYPES, type DoctorFacts } from './src/doctor';
import { listFiles, readProjectSource, writeFiles } from './src/project-files';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/caesar');
const VARIANTS = path.join(HERE, 'fixtures/caesar-variants');
const SEED = '0123456789abcdef';
const has = (cmd: string, args = ['--version']) => spawnSync(cmd, args).status === 0;

let tmp: string;
let checkMjs: string;
beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'check-test-'));
  checkMjs = (await buildCheck({ outfile: path.join(tmp, 'check.mjs') })).outfile;
}, 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** An unzipped project folder: the fixture's starter or solution, optionally with caesar.c replaced. */
function project(variant: 'starter' | 'solution', caesar?: string, opts: { learner?: boolean } = {}): string {
  const src = readProjectSource(FIXTURE, { variant });
  const dir = path.join(tmp, `p${++n}`);
  writeFiles(dir, projectZipEntries({
    id: src.id, title: src.title, spec: src.spec, files: src.files,
    checkMjs: readFileSync(checkMjs, 'utf8'), learncH: readFileSync(LEARNC_H, 'utf8'),
    learner: opts.learner === false ? undefined : { version: 1, seed: SEED, exercise: src.id },
  }));
  if (caesar) copyFileSync(caesar, path.join(dir, 'caesar.c'));
  return dir;
}

interface JsonReport {
  passed: number; total: number; allPassed: boolean; bits: string; run: number;
  progressCode?: string; completionToken?: string; learnerProblem?: string; results: TestResult[];
}

// LC_ALL=C keeps gcc/clang diagnostics ASCII for these assertions. check.mjs itself pins LC_ALL=C for the compiler and make,
// whatever the learner's locale is; locale.test.ts covers that.
const checkEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C', CC: 'gcc', NO_COLOR: '1', FORCE_COLOR: '', ...env });
/** `timeoutMs` SIGKILLs a check.mjs that hangs, so a regression fails the test instead of blocking the worker. */
function check(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}, timeoutMs?: number) {
  const r = spawnSync(process.execPath, ['check.mjs', ...args], { cwd: dir, encoding: 'utf8', env: checkEnv(env), timeout: timeoutMs, killSignal: 'SIGKILL' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function checkJson(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}, timeoutMs?: number): JsonReport & { status: number | null } {
  const r = check(dir, ['--json', ...args], env, timeoutMs);
  return { ...(JSON.parse(r.stdout) as JsonReport), status: r.status };
}

const byName = (r: JsonReport, name: string) => r.results.find(x => x.name === name)!;

describe('check.mjs on the caesar fixture (gcc + ASan/UBSan/LSan)', () => {
  it('the reference solution passes every check and earns the completion token', async () => {
    const r = checkJson(project('solution'));
    expect(r.status).toBe(0);
    expect(r).toMatchObject({ passed: 8, total: 8, allPassed: true, bits: '11111111' });
    expect(byName(r, 'no memory errors or leaks').note).toBe('AddressSanitizer, UBSan, LeakSanitizer');
    // exercise.yaml's id is the app-style "project/caesar"; codes spell it "project.caesar". The MAC is
    // checked independently of token.ts with node:crypto in src/testing/token.test.ts.
    expect(r.completionToken).toBe('TDCC1-R1-project.caesar-DONE-2eeb4b39');
    expect(await verifyCode(r.completionToken!, SEED, { exercise: 'project/caesar' })).toMatchObject({ ok: true });
    expect(await verifyCode(r.progressCode!, SEED, { exercise: 'project/caesar' })).toMatchObject({ ok: true, passed: 8, total: 8 });
  }, 60_000);

  it('the buggy starter fails with plain-English explanations and a verifiable progress code', async () => {
    const r = checkJson(project('starter'));
    expect(r.status).toBe(1);
    expect(r).toMatchObject({ passed: 1, total: 8, allPassed: false, bits: '01000000' });
    expect(byName(r, 'compiles without warnings').details).toEqual(["caesar.c:14:14: warning: unused parameter 'argc' [-Wunused-parameter]"]);
    expect(byName(r, 'encrypts "barfoo" with key 23 as "yxocll"')).toMatchObject({
      message: "wrong output: first difference on line 1, character 15: expected 'o', got '\\x89'",
      actual: 'ciphertext: yx\udc89}\udc86\udc86\n', hint: "Letters past 'z' must wrap back round to 'a'.",
    });
    expect(byName(r, 'rejects a missing key').message).toMatch(/^it crashed with a segmentation fault/);
    expect(byName(r, 'rejects a non-numeric key').message).toBe('wrong output: expected no output at all, but got "ciphertext: cde\\n"');
    const unit = byName(r, 'rotate() unit tests');
    expect(unit.message).toBe('2 of 5 checks failed');
    expect(unit.subtests![1]).toEqual({ name: "rotate('z', 1) wraps to 'a'", status: 'fail', message: "expected 'a' (97), got '{' (123)" });
    expect(byName(r, 'no memory errors or leaks').message).toBe('heap overflow at caesar.c:26: wrote 1 byte just past the end of a 1-byte block allocated at caesar.c:22');
    expect(r.completionToken).toBeUndefined();
    expect(await verifyCode(r.progressCode!, SEED, { exercise: 'project/caesar' })).toMatchObject({ ok: true, passed: 1, total: 8 });
  }, 60_000);

  it('a leak-only variant fails just the memory check', () => {
    const r = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')));
    expect(r.bits).toBe('11111110');
    expect(byName(r, 'no memory errors or leaks').message).toBe('memory leak: 2 bytes allocated at caesar.c:42 were never freed');
  }, 60_000);

  it('a syntax error fails the compile check and skips the rest', () => {
    const r = checkJson(project('solution', path.join(VARIANTS, 'syntax.c')));
    expect(r.bits).toBe('00000000');
    expect(byName(r, 'compiles without warnings')).toMatchObject({ status: 'fail', message: "your code doesn't compile yet", details: ["caesar.c:50:36: error: expected ';' before 'free'"] });
    expect(r.results.slice(1).every(x => x.status === 'skip')).toBe(true);
  }, 60_000);

  it('prints friendly text, with colour only when asked', () => {
    const dir = project('solution');
    const plain = check(dir);
    expect(plain.stdout).toContain('✓ compiles without warnings\n');
    expect(plain.stdout).toContain('✓ no memory errors or leaks  (AddressSanitizer, UBSan, LeakSanitizer)');
    expect(plain.stdout).toContain('All 8 checks passed.');
    expect(plain.stdout).toContain('Completion token (paste it into the course):  TDCC1-R1-project.caesar-DONE-2eeb4b39');
    expect(plain.stdout).not.toContain('\x1b[');
    expect(check(dir, [], { NO_COLOR: '', FORCE_COLOR: '1' }).stdout).toContain('\x1b[32m✓\x1b[0m');
  }, 60_000);

  it('reveals hint tiers one at a time with --hint; only full runs count and earn a code', async () => {
    const dir = project('starter');
    const name = 'encrypts "barfoo" with key 23 as "yxocll"';
    const tiers = [1, 2, 3].map(() => check(dir, ['--only', name, '--hint']).stdout);
    expect(tiers[0]).toContain('hint 2: Work with');
    expect(tiers[0]).not.toContain('hint 3:');
    expect(tiers[1]).toContain('hint 3: For lowercase');
    expect(tiers[2]).toContain('No more hints');
    // --only runs print no code (the unselected checks would read as failures) and are not counted.
    expect(tiers[0]).toContain('No progress code for a single check');
    expect(tiers[0]).not.toContain('Progress code (paste');
    const only = checkJson(dir, ['--only', name]);
    expect(only.progressCode).toBeUndefined();
    expect(JSON.parse(readFileSync(path.join(dir, '.check-state'), 'utf8'))).toEqual({ runs: 0, hints: { [name]: 3 } });
    // Full runs count; a full run is also where `make hint` (--hint without --only) reveals the next tier.
    const full = checkJson(dir);
    expect(full.run).toBe(1);
    expect(await verifyCode(full.progressCode!, SEED, { exercise: 'project/caesar' })).toMatchObject({ ok: true, passed: 1, total: 8 });
    expect(checkJson(dir).run).toBe(2);
  }, 60_000);

  it('runs without .learner, but says why there is no code', () => {
    const r = check(project('solution', undefined, { learner: false }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No progress code: there is no .learner file here');
  }, 60_000);

  it('explains an unusable folder with exit status 2', () => {
    const empty = path.join(tmp, 'empty');
    mkdirSync(empty, { recursive: true });
    const r = spawnSync(process.execPath, [checkMjs, empty], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^No check\.json in /);
    const bad = project('solution');
    writeFileSync(path.join(bad, 'check.json'), JSON.stringify({ version: 1, sources: [], tests: [] }));
    const r2 = check(bad);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain('"sources" must be a non-empty list of file names');
  }, 60_000);
});

describe('memory-check fallbacks', () => {
  // "No sanitizer runtime" is simulated with CHECK_NO_SANITIZERS, so the result does not depend on whether the
  // machine's clang happens to ship compiler-rt (the GitHub runner's clang-18 does; a bare box may not).
  const CLANG = ['clang-22', 'clang'].find(c => has(c));
  it.runIf(!!CLANG && has('valgrind'))('clang without sanitizer runtimes falls back to valgrind', () => {
    const noSan = { CHECK_NO_SANITIZERS: '1' };
    const leaky = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), ['--cc', CLANG!], noSan);
    expect(byName(leaky, 'no memory errors or leaks').message).toBe('memory leak: 2 bytes allocated at caesar.c:42 were never freed');
    const starter = checkJson(project('starter'), ['--cc', CLANG!], noSan);
    expect(byName(starter, 'no memory errors or leaks').message).toBe('heap overflow at caesar.c:26: wrote 1 byte just past the end of a 1-byte block allocated at caesar.c:22');
    expect(byName(checkJson(project('solution'), ['--cc', CLANG!], noSan), 'no memory errors or leaks')).toMatchObject({ status: 'pass', note: 'valgrind' });
  }, 120_000);

  it('macOS (simulated): ASan without LeakSanitizer, plus leaks --atExit for leaks', () => {
    // A stand-in for leaks(1) that runs the program and reports one leak in the format leaks prints.
    const bin = path.join(tmp, 'fakebin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'leaks'), [
      '#!/bin/sh',
      '[ "$1" = "--help" ] && exit 0',
      'shift; shift',
      '"$@" > /dev/null',
      'echo "Process 4242: 1 leak for 2 total leaked bytes."',
      'echo "2   caesar   0x100003e94 main + 56  caesar.c:42"',
      'exit 1',
    ].join('\n'));
    chmodSync(path.join(bin, 'leaks'), 0o755);
    const env = { CHECK_PLATFORM: 'darwin', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const r = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), [], env);
    expect(byName(r, 'no memory errors or leaks')).toMatchObject({ status: 'fail', message: 'memory leak: 1 block (2 bytes) never freed (allocated at caesar.c:42)' });
  }, 60_000);
});

describe('macOS (simulated): a leaks that does not finish fails the memory check (issue #101)', () => {
  /** A stand-in leaks(1) on PATH: `--help` succeeds, otherwise it runs `body` with the program as "$@". */
  function fakeLeaks(name: string, body: string[]) {
    const bin = path.join(tmp, `fakebin-${name}`);
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'leaks'), ['#!/bin/sh', '[ "$1" = "--help" ] && exit 0', 'shift; shift', ...body].join('\n'));
    chmodSync(path.join(bin, 'leaks'), 0o755);
    return { CHECK_PLATFORM: 'darwin', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  }
  const MEMORY = 'no memory errors or leaks';
  const timed = <T>(f: () => T) => { const t0 = Date.now(); const value = f(); return { value, s: (Date.now() - t0) / 1000 }; };
  const LIMIT = 45_000;
  /** Pids recorded in `file` that are still running (a zombie counts as gone). */
  const alivePids = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []).filter(pid => {
    const st = spawnSync('ps', ['-o', 'stat=', '-p', pid], { encoding: 'utf8' }).stdout.trim();
    return st !== '' && !st.startsWith('Z');
  });
  const killPids = (file: string) => alivePids(file).forEach(pid => spawnSync('kill', ['-9', pid]));

  it('silent: no summary on stdout, one line on stderr, exit 1', () => {
    const env = fakeLeaks('silent', ['"$@" > /dev/null', 'echo "leaks: cannot examine process" >&2', 'exit 1']);
    const r = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), [], env, LIMIT);
    expect(byName(r, MEMORY)).toMatchObject({ status: 'fail', message: 'leaks exited with status 1 without its summary line, so leaks were not checked' });
    expect(byName(r, MEMORY).details?.[0]).toBe('leaks: cannot examine process');
    expect(r.completionToken).toBeUndefined();
    expect(r.status).toBe(1);
  }, 60_000);

  it('hanging: runs the program, then never exits', () => {
    const env = fakeLeaks('hang', ['"$@" > /dev/null', 'exec sleep 600']);
    const { value: r, s } = timed(() => checkJson(project('solution'), [], { ...env, CHECK_TOOL_TIMEOUT_MS: '1000' }, LIMIT));
    expect(byName(r, MEMORY)).toMatchObject({ status: 'fail', message: 'leaks did not finish within 1 s, so leaks were not checked' });
    expect(r.completionToken).toBeUndefined();
    expect(s).toBeLessThan(30);
    // A clean summary printed before the hang doesn't count either: the run didn't finish.
    const late = fakeLeaks('hang-after-summary', ['"$@" > /dev/null', 'echo "Process 4242: 0 leaks for 0 total leaked bytes."', 'exec sleep 600']);
    const r2 = checkJson(project('solution'), [], { ...late, CHECK_TOOL_TIMEOUT_MS: '1000' }, LIMIT);
    expect(byName(r2, MEMORY)).toMatchObject({ status: 'fail', message: 'leaks did not finish within 1 s, so leaks were not checked' });
    expect(r2.completionToken).toBeUndefined();
  }, 60_000);

  it('lingering: a correct report, but a background process keeps stdout open', () => {
    const pids = path.join(tmp, 'linger-pids');
    const env = { ...fakeLeaks('linger', [
      '"$@" > /dev/null',
      `sleep 600 & echo $! >> ${pids}`,
      'case "$PWD" in *leaky*) echo "Process 4242: 1 leak for 2 total leaked bytes."; echo "2   caesar   0x100003e94 main + 56  caesar.c:42";;',
      '  *) echo "Process 4242: 0 leaks for 0 total leaked bytes.";; esac',
      'exit 0',
    ]) };
    const leakyDir = project('solution', path.join(VARIANTS, 'leaky.c'));
    const leakyPath = `${leakyDir}-leaky`;
    rmSync(leakyPath, { recursive: true, force: true });
    spawnSync('mv', [leakyDir, leakyPath]);
    try {
      const leaky = timed(() => checkJson(leakyPath, [], env, LIMIT));
      expect(byName(leaky.value, MEMORY)).toMatchObject({ status: 'fail', message: 'memory leak: 1 block (2 bytes) never freed (allocated at caesar.c:42)' });
      const clean = timed(() => checkJson(project('solution'), [], env, LIMIT));
      expect(byName(clean.value, MEMORY)).toMatchObject({ status: 'pass', note: 'AddressSanitizer, UBSan, leaks' });
      expect(clean.value.completionToken).toBeDefined();
      expect([leaky.s, clean.s].every(s => s < 10), `check.mjs took ${leaky.s} s and ${clean.s} s`).toBe(true);
      expect(readFileSync(pids, 'utf8').split('\n').filter(Boolean).length).toBeGreaterThan(0);
      expect(alivePids(pids), 'leftover processes after check.mjs exited').toEqual([]);
    } finally {
      killPids(pids);
    }
  }, 120_000);

  it('Ctrl+C: SIGINT to check.mjs\'s group also ends the memory tool, which runs in its own session', async () => {
    const pids = path.join(tmp, 'sigint-pids');
    const env = fakeLeaks('sigint', ['"$@" > /dev/null', `echo $$ >> ${pids}`, 'exec sleep 600']);
    const dir = project('solution');
    // Started the way a terminal starts a job: check.mjs leads its own process group, and the signal goes to that group.
    const child = spawn(process.execPath, ['check.mjs', '--json'], { cwd: dir, env: checkEnv(env), stdio: 'ignore', detached: true });
    const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(res => child.on('exit', (code, signal) => res({ code, signal })));
    try {
      const t0 = Date.now();
      while (!existsSync(pids) && Date.now() - t0 < LIMIT) await new Promise(r => setTimeout(r, 100));
      expect(existsSync(pids), 'the leaks stand-in never started').toBe(true);
      process.kill(-child.pid!, 'SIGINT');
      const r = await Promise.race([ended, new Promise<'hung'>(res => setTimeout(() => res('hung'), 10_000))]);
      expect(r === 'hung' ? r : r.signal === 'SIGINT' || r.code === 130, `check.mjs after SIGINT: ${JSON.stringify(r)}`).toBe(true);
      await new Promise(r => setTimeout(r, 2000));
      expect(alivePids(pids), 'the memory tool outlived check.mjs').toEqual([]);
    } finally {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
      killPids(pids);
    }
  }, 120_000);

  it('a leaks that exists but cannot be started (mode 644) fails, naming the error', () => {
    const bin = path.join(tmp, 'fakebin-leaks-644');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'leaks'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(bin, 'leaks'), 0o644);
    const r = checkJson(project('solution'), [], { CHECK_PLATFORM: 'darwin', PATH: `${bin}${path.delimiter}${process.env.PATH}` }, LIMIT);
    expect(byName(r, MEMORY)).toMatchObject({ status: 'fail', message: 'leaks could not be started (EACCES), so leaks were not checked' });
    expect(r.completionToken).toBeUndefined();
  }, 60_000);
});

describe('a memory run that does not finish fails the memory check (issue #101)', () => {
  it('valgrind (no sanitizer runtime) that never exits', () => {
    const bin = path.join(tmp, 'fakebin-valgrind');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'valgrind'), ['#!/bin/sh', '[ "$1" = "--version" ] && { echo valgrind-3.22.0; exit 0; }', 'exec sleep 600'].join('\n'));
    chmodSync(path.join(bin, 'valgrind'), 0o755);
    const env = { CHECK_NO_SANITIZERS: '1', CHECK_TOOL_TIMEOUT_MS: '1000', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const r = checkJson(project('solution'), [], env, 45_000);
    expect(byName(r, 'no memory errors or leaks')).toMatchObject({ status: 'fail', message: 'valgrind did not finish within 1 s, so memory errors and leaks were not checked' });
    expect(r.completionToken).toBeUndefined();
  }, 60_000);

  it('valgrind that exists but cannot be started (mode 644) fails, naming the error', () => {
    // A PATH with every tool except the real valgrind: execvp skips a file it can't execute and keeps searching.
    const bin = path.join(tmp, 'path-valgrind-644');
    mkdirSync(bin, { recursive: true });
    for (const d of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
      let names: string[] = [];
      try { names = readdirSync(d); } catch { continue; }
      for (const f of names) if (!f.startsWith('valgrind') && !existsSync(path.join(bin, f))) symlinkSync(path.join(d, f), path.join(bin, f));
    }
    writeFileSync(path.join(bin, 'valgrind'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(bin, 'valgrind'), 0o644);
    const r = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), [], { CHECK_NO_SANITIZERS: '1', PATH: bin }, 45_000);
    expect(byName(r, 'no memory errors or leaks')).toMatchObject({
      status: 'fail', message: 'valgrind could not be started (EACCES), so memory errors and leaks were not checked',
    });
    expect(r.completionToken).toBeUndefined();
    expect(r.status).not.toBe(0);
  }, 60_000);

  it('a program that times out under AddressSanitizer', () => {
    const dir = path.join(tmp, 'asan-timeout');
    mkdirSync(dir, { recursive: true });
    const spec = { version: 1, sources: ['spin.c'], memory: true, tests: [{ name: 'runs', run: { stdin: '', timeoutMs: 200 }, expect: { stdout: '' } }] };
    writeFiles(dir, {
      'check.json': JSON.stringify(spec), 'check.mjs': readFileSync(checkMjs, 'utf8'),
      'spin.c': '#include <unistd.h>\nint main(void) { for (;;) sleep(1); }\n',
    });
    const r = checkJson(dir);
    expect(byName(r, 'no memory errors or leaks')).toMatchObject({
      status: 'fail', message: 'the program did not finish within 1 s under AddressSanitizer, so memory errors and leaks were not checked',
    });
  }, 60_000);
});

describe('a valgrind that reports its own error fails the memory check (issue #108)', () => {
  const MEMORY = 'no memory errors or leaks';
  // VALGRIND_LIB pointing nowhere stands in for a broken valgrind install: valgrind prints
  // "valgrind: failed to start tool 'memcheck' ..." and exits 1 without running the program.
  const brokenLib = () => path.join(tmp, 'no-such-valgrind-lib');
  // A suppression for every leak makes the LeakSanitizer probe find nothing, so caps.lsan is false and the
  // valgrind leak pass runs next to ASan (as on a Linux where LeakSanitizer doesn't work).
  const noLsan = () => {
    const file = path.join(tmp, 'lsan-suppress-all.txt');
    writeFileSync(file, 'leak:*\n');
    return `suppressions=${file}`;
  };

  it.runIf(has('valgrind'))('valgrind mode, broken install', () => {
    const r = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), [], { CHECK_NO_SANITIZERS: '1', VALGRIND_LIB: brokenLib() }, 45_000);
    expect(byName(r, MEMORY)).toMatchObject({
      status: 'fail', message: 'valgrind reported an error of its own (exit status 1), so memory errors and leaks were not checked',
    });
    expect(byName(r, MEMORY).details?.[0]).toMatch(/^valgrind: failed to start tool 'memcheck'/);
    expect(r.completionToken).toBeUndefined();
    expect(r.status).not.toBe(0);
  }, 60_000);

  it.runIf(has('valgrind'))('valgrind leak pass next to ASan, broken install', () => {
    const r = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), [], { LSAN_OPTIONS: noLsan(), VALGRIND_LIB: brokenLib() }, 45_000);
    expect(byName(r, MEMORY)).toMatchObject({
      status: 'fail', message: 'valgrind reported an error of its own (exit status 1), so leaks were not checked',
    });
    expect(byName(r, MEMORY).details?.[0]).toMatch(/^valgrind: failed to start tool 'memcheck'/);
    expect(r.completionToken).toBeUndefined();
    expect(r.status).not.toBe(0);
  }, 60_000);

  it('a capitalised "Valgrind: FATAL: ..." line counts too (a stand-in valgrind)', () => {
    // Memcheck's core prints fatal errors as "Valgrind: FATAL: ...", which no real run here reproduced, so a stand-in prints one.
    const bin = path.join(tmp, 'path-valgrind-fatal');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'valgrind'), ['#!/bin/sh', '[ "$1" = "--version" ] && { echo valgrind-3.22.0; exit 0; }',
      'echo "Valgrind: FATAL: aspacem assertion failed:" >&2', 'exit 1'].join('\n'));
    chmodSync(path.join(bin, 'valgrind'), 0o755);
    const env = { CHECK_NO_SANITIZERS: '1', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const r = checkJson(project('solution'), [], env, 45_000);
    expect(byName(r, MEMORY)).toMatchObject({
      status: 'fail', message: 'valgrind reported an error of its own (exit status 1), so memory errors and leaks were not checked',
    });
    expect(byName(r, MEMORY).details?.[0]).toBe('Valgrind: FATAL: aspacem assertion failed:');
    expect(r.completionToken).toBeUndefined();
  }, 60_000);

  it.runIf(has('valgrind'))('the match is narrow: "valgrind: " on stdout, or "valgrind" later in a stderr line, still passes', () => {
    const dir = path.join(tmp, 'valgrind-lookalike');
    mkdirSync(dir, { recursive: true });
    const spec = { version: 1, sources: ['say.c'], memory: true, tests: [{ name: 'says hi', run: { stdin: '', timeoutMs: 10_000 }, expect: { stdout: 'valgrind: hi\n' } }] };
    writeFiles(dir, {
      'check.json': JSON.stringify(spec), 'check.mjs': readFileSync(checkMjs, 'utf8'),
      'say.c': '#include <stdio.h>\nint main(void) {\n  printf("valgrind: hi\\n");\n  fprintf(stderr, "not a valgrind: error, just the program\\n");\n  return 0;\n}\n',
    });
    const r = checkJson(dir, [], { CHECK_NO_SANITIZERS: '1' }, 45_000);
    expect(byName(r, 'says hi')).toMatchObject({ status: 'pass' });
    expect(byName(r, MEMORY)).toMatchObject({ status: 'pass', note: 'valgrind' });
  }, 60_000);

  it.runIf(has('valgrind'))('control: the valgrind leak pass next to ASan, with a working valgrind', () => {
    const env = { LSAN_OPTIONS: noLsan() };
    const clean = checkJson(project('solution'), [], env, 45_000);
    expect(byName(clean, MEMORY)).toMatchObject({ status: 'pass', note: 'AddressSanitizer, UBSan, valgrind (leaks)' });
    expect(clean.completionToken).toBeDefined();
    const leaky = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), [], env, 45_000);
    expect(byName(leaky, MEMORY)).toMatchObject({ status: 'fail', message: 'memory leak: 2 bytes allocated at caesar.c:42 were never freed' });
    expect(leaky.completionToken).toBeUndefined();
  }, 120_000);
});

describe('make checks', () => {
  it('runs make targets and checks that a header change rebuilds the program', () => {
    const dir = path.join(tmp, 'make-proj');
    mkdirSync(dir, { recursive: true });
    const spec = { version: 1, sources: ['greet.c'], tests: [
      { name: 'make builds greet', make: { target: 'greet', expectRebuild: ['greet.h'] } },
      { name: 'greets', run: { stdin: '' }, expect: { stdout: 'hi\n' } },
    ] };
    writeFiles(dir, {
      'check.json': JSON.stringify(spec), 'check.mjs': readFileSync(checkMjs, 'utf8'),
      'greet.h': '#define GREETING "hi"\n', 'greet.c': '#include <stdio.h>\n#include "greet.h"\nint main(void) { puts(GREETING); return 0; }\n',
      Makefile: 'greet: greet.c\n\t$(CC) -o greet greet.c\n',
    });
    const missingDep = checkJson(dir);
    expect(byName(missingDep, 'make builds greet')).toMatchObject({ status: 'fail', message: 'after greet.h changed, make still thought greet was up to date' });
    writeFileSync(path.join(dir, 'Makefile'), 'greet: greet.c greet.h\n\t$(CC) -o greet greet.c\n');
    expect(checkJson(dir)).toMatchObject({ allPassed: true, bits: '111' });
    writeFileSync(path.join(dir, 'Makefile'), 'greet: greet.c greet.h\n\t$(CC) -o greet greet.c --no-such-flag\n');
    rmSync(path.join(dir, 'greet')); // otherwise make has nothing to do
    expect(byName(checkJson(dir), 'make builds greet').message).toBe('make greet failed (exit code 2)');
  }, 60_000);
});

describe('file checks', () => {
  it('passes when the file exists and matches, fails when it is missing or wrong, and reads binary files', () => {
    const dir = path.join(tmp, 'file-proj');
    mkdirSync(dir, { recursive: true });
    const spec = { version: 1, sources: ['greet.c'], tests: [
      { name: 'make builds greet', make: { target: 'greet' } },
      { name: 'greet is a program', file: { path: 'greet', expect: { matches: '^(\\x7fELF|\\xcf\\xfa\\xed\\xfe)' }, binary: true } },
      { name: 'notes.txt says done', file: { path: 'notes.txt', expect: { contains: ['done'] } } },
    ] };
    writeFiles(dir, {
      'check.json': JSON.stringify(spec), 'check.mjs': readFileSync(checkMjs, 'utf8'),
      'greet.c': '#include <stdio.h>\nint main(void) { puts("hi"); return 0; }\n', Makefile: 'greet: greet.c\n\t$(CC) -o greet greet.c\n',
    });
    const missing = checkJson(dir);
    expect(byName(missing, 'notes.txt says done')).toMatchObject({ kind: 'file', status: 'fail', message: 'there is no file notes.txt' });
    expect(missing.bits).toBe('1110');
    writeFileSync(path.join(dir, 'notes.txt'), 'todo\n');
    expect(byName(checkJson(dir), 'notes.txt says done')).toMatchObject({ status: 'fail', message: 'notes.txt should contain "done", but it doesn\'t' });
    writeFileSync(path.join(dir, 'notes.txt'), 'all done\n');
    const pass = checkJson(dir);
    expect(byName(pass, 'notes.txt says done')).toMatchObject({ kind: 'file', status: 'pass' });
    expect(pass).toMatchObject({ allPassed: true, bits: '1111' });
    const text = check(dir);
    expect(text.stdout).toContain('✓ notes.txt says done');
  }, 60_000);
});

describe('the zip the app builds in the browser (buildZipFromFolder), used the way a learner would', () => {
  /** The files the app loads for a project folder (src/content-runtime/course.ts folderFiles): no solution/, no yaml/mdx. */
  function appFolder(): Record<string, string> {
    const folder: Record<string, string> = {};
    for (const f of listFiles(FIXTURE, ['solution'])) {
      if (/\.(c|h|json|txt|md|mk)$|(^|\/)Makefile$/.test(f)) folder[f] = readFileSync(path.join(FIXTURE, f), 'utf8');
    }
    return folder;
  }
  function unzipped(name: string, folder: Record<string, string>): string {
    const zip = buildZipFromFolder({ exerciseId: 'project/caesar', title: 'Caesar cipher', folder, seed: SEED, checkMjs: readFileSync(checkMjs, 'utf8'), learncH: readFileSync(LEARNC_H, 'utf8') });
    const dir = path.join(tmp, name);
    for (const [p, data] of Object.entries(unzipSync(zip))) {
      const dest = path.join(dir, p.replace(/^caesar\//, ''));
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, data);
    }
    return dir;
  }
  const make = (dir: string, args: string[]) => spawnSync('make', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', CC: 'gcc', NO_COLOR: '1' } });

  it('`make` builds the starter, `make test` prints a progress code that the app accepts, `make hint` shows the next hint', async () => {
    const dir = unzipped('app-zip-starter', appFolder());
    const built = make(dir, []);
    expect(built.status, built.stderr).toBe(0);
    expect(spawnSync('./caesar', ['1'], { cwd: dir, input: 'abc\n', encoding: 'utf8' }).stdout).toBe('ciphertext: bcd\n');
    const t = make(dir, ['test']);
    expect(t.status).toBe(2); // make reports the failing check.mjs run (exit status 1) as its own status 2
    const code = /Progress code \(paste it into the course\):\s+(\S+)/.exec(t.stdout)?.[1];
    expect(await verifyCode(code!, SEED, { exercise: 'project/caesar' })).toMatchObject({ ok: true, passed: 1, total: 8 });
    expect(make(dir, ['hint']).stdout).toContain('hint ');
  }, 60_000);

  it('with the reference solution in place, `make test` prints the completion token', async () => {
    const dir = unzipped('app-zip-solution', appFolder());
    copyFileSync(path.join(FIXTURE, 'solution/caesar.c'), path.join(dir, 'caesar.c'));
    const t = make(dir, ['test']);
    expect(t.status, t.stdout).toBe(0);
    expect(t.stdout).toContain('Completion token (paste it into the course):  TDCC1-R1-project.caesar-DONE-2eeb4b39');
  }, 60_000);
});

describe('build.mjs --zip', () => {
  it('writes the reference zip with the documented layout', () => {
    const out = path.join(tmp, 'caesar.zip');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/check/build.mjs'), '--zip', FIXTURE, '--out', out, '--seed', SEED], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const files = unzipSync(readFileSync(out));
    expect(Object.keys(files).sort()).toEqual([
      'caesar/.learner', 'caesar/Makefile', 'caesar/README.md', 'caesar/caesar.c', 'caesar/check.json', 'caesar/check.mjs', 'caesar/learnc.h', 'caesar/tests/test_rotate.c',
    ]);
    // .learner keeps the id as the app spells it; reading it normalises "/" to ".".
    const learnerText = new TextDecoder().decode(files['caesar/.learner']);
    expect(JSON.parse(learnerText)).toMatchObject({ seed: SEED, exercise: 'project/caesar' });
    expect(parseLearnerFile(learnerText)).toMatchObject({ seed: SEED, exercise: 'project.caesar' });
    // Starter code ships, the solution never does.
    expect(new TextDecoder().decode(files['caesar/caesar.c'])).toContain('TODO: wrap around');
  }, 60_000);
});

describe('check.mjs --doctor', () => {
  const doctor = (env: NodeJS.ProcessEnv = {}) => {
    const r = spawnSync(process.execPath, [checkMjs, '--doctor'], { cwd: tmp, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1', ...env } });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const row = (out: string, key: string) => new RegExp(`^  ${key.padEnd(18).replace(/[*]/g, '\\*')}(.*)$`, 'm').exec(out)?.[1];
  /** A folder on PATH with stand-ins for macOS commands (an Apple-chip Mac, Node under Rosetta). */
  const fakeMac = () => {
    const bin = path.join(tmp, 'fakemac');
    mkdirSync(bin, { recursive: true });
    const script = (name: string, body: string) => { writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
    script('sysctl', 'case "$2" in hw.optional.arm64) echo 1;; sysctl.proc_translated) echo 1;; hw.cachelinesize) echo 128;; hw.pagesize) echo 16384;; *) exit 1;; esac');
    script('sw_vers', 'echo 14.7.1');
    script('lldb', 'exit 0');
    script('leaks', 'exit 0');
    return bin;
  };

  it('reports this machine', () => {
    const r = doctor();
    console.log(`node check.mjs --doctor on this machine:\n${r.out}`); // the CI log is the evidence for the PR
    expect(r.status).toBe(0);
    expect(row(r.out, 'C compiler')).toMatch(/^\S+: .*\d+\.\d+/);
    expect(row(r.out, 'Node')).toBe(process.version);
    expect(row(r.out, '    int')).toBe('4');
    expect(row(r.out, '    void *')).toMatch(/^(4|8)$/);
    expect(row(r.out, 'Page size')).toMatch(/^\d+ B/);
    expect(row(r.out, 'Memory checks')).toContain('ASan + UBSan');
    if (process.platform === 'linux') expect(r.out).toMatch(/^"My machine" in the course: (wsl|linux-x86|linux-arm)$/m);
    expect(r.out).not.toMatch(/ 0( B)?$/m);
  }, 60_000);

  it('CHECK_NO_SANITIZERS=1: no sanitizer memory checks, Valgrind if installed', () => {
    const r = doctor({ CHECK_NO_SANITIZERS: '1' });
    expect(r.status).toBe(0);
    expect(row(r.out, 'Memory checks')).toBe(has('valgrind') ? 'Valgrind (no sanitizer runtime)' : 'none');
  }, 60_000);

  it.runIf(process.arch === 'x64')('CHECK_PLATFORM=darwin: an Apple-chip Mac with Node under Rosetta says so and how to change it', () => {
    const r = doctor({ CHECK_PLATFORM: 'darwin', PATH: `${fakeMac()}${path.delimiter}${process.env.PATH}` });
    expect(r.status).toBe(0);
    expect(row(r.out, 'Architecture')).toMatch(/\(Node: x64, under Rosetta\)$/);
    expect(row(r.out, 'Operating system')).toBe('macOS 14.7.1');
    expect(row(r.out, 'Cache line')).toBe('128 B');
    expect(row(r.out, 'Page size')).toBe('16384 B (16 KiB)');
    expect(r.out).toMatch(/^"My machine" in the course: mac-arm$/m);
    expect(r.out).toContain('! This Mac has an Apple chip, but Node runs as x64 under Rosetta');
    expect(r.out).toContain('Then node -p process.arch prints arm64.');
    expect(r.out).not.toContain('gdb (the debugger'); // gdb is not needed on a Mac
  }, 60_000);

  it('CHECK_PLATFORM=darwin without the macOS commands: unreadable values are "unknown", never 0', () => {
    const r = doctor({ CHECK_PLATFORM: 'darwin' });
    expect(r.status).toBe(0);
    for (const k of ['Operating system', 'Cache line', 'Page size']) expect(row(r.out, k)).toBe('unknown');
    if (process.arch === 'x64') expect(r.out).toMatch(/^"My machine" in the course: unknown$/m);
    expect(r.out).toContain('Note: lldb (the macOS debugger) was not found.');
  }, 60_000);

  it('no compiler: exits 1 with the install command for the platform', () => {
    const empty = path.join(tmp, 'emptybin');
    mkdirSync(empty, { recursive: true });
    const linux = doctor({ PATH: empty, CC: '' });
    expect(linux.status).toBe(1);
    expect(linux.out).toContain('✗ No C compiler found (tried $CC, cc, clang and gcc).\n    Install one:  sudo apt install build-essential');
    expect(linux.out).toContain('✗ Not ready yet');
    for (const t of SIZEOF_TYPES) expect(row(linux.out, `    ${t}`)).toBe('unknown');
    expect(linux.out).not.toMatch(/ 0( B)?$/m);
    const mac = doctor({ PATH: empty, CC: '', CHECK_PLATFORM: 'darwin' });
    expect(mac.status).toBe(1);
    expect(mac.out).toContain('Install the Xcode Command Line Tools:  xcode-select --install');
  }, 60_000);

  const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
    platform: 'linux', nodeArch: 'x64', nodeVersion: '22.11.0', machine: 'x86_64', wsl: false,
    compiler: { cc: 'gcc', version: 'gcc 13.3.0', kind: 'gcc', apple: false },
    tools: { gdb: true, lldb: false, valgrind: true, leaks: false }, memory: { sanitizers: true, lsan: true, valgrind: true, leaks: false },
    sizes: {}, ...over,
  });

  it('too old a Node is an error with a way to update; Node 18 is a note', () => {
    const old = assess(facts({ nodeVersion: '16.20.2' }));
    expect(old.ok).toBe(false);
    expect(old.findings[0]).toMatchObject({ level: 'error', text: 'Node 16.20.2 is too old: the course\'s tools need Node 18 or newer.' });
    expect(old.findings[0].remedy).toContain('sudo apt install nodejs');
    const eol = assess(facts({ nodeVersion: '18.19.1' }));
    expect(eol.ok).toBe(true);
    expect(eol.findings.map(f => f.text)).toEqual(['Node 18 works but is past end of life; any newer LTS works too.']);
    expect(assess(facts()).findings).toEqual([]);
  });

  it('missing gdb, Valgrind or leaks is a note, not an error', () => {
    const linux = assess(facts({ tools: { gdb: false, lldb: false, valgrind: false, leaks: false } }));
    expect(linux.ok).toBe(true);
    expect(linux.findings.map(f => [f.level, f.remedy])).toEqual([['note', 'sudo apt install gdb'], ['note', 'sudo apt install valgrind']]);
    const mac = assess(facts({ platform: 'darwin', nodeArch: 'arm64', appleSilicon: true, tools: { gdb: false, lldb: true, valgrind: false, leaks: false } }));
    expect(mac).toMatchObject({ ok: true, machine: 'mac-arm', findings: [{ level: 'note', text: 'leaks (the macOS leak checker) was not found.' }] });
  });

  it('suggests the "my machine" value', () => {
    expect(assess(facts()).machine).toBe('linux-x86');
    expect(assess(facts({ machine: 'aarch64', nodeArch: 'arm64' })).machine).toBe('linux-arm');
    expect(assess(facts({ wsl: true })).machine).toBe('wsl');
    const intel = assess(facts({ platform: 'darwin', appleSilicon: false, tools: { gdb: false, lldb: true, valgrind: false, leaks: true } }));
    expect(intel).toMatchObject({ machine: 'mac-intel', findings: [] });
  });
});
