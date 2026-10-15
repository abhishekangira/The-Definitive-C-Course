// End-to-end tests of the bundled check.mjs on the caesar fixture (ported from the research
// prototype), run the way learners run it: `node check.mjs` inside an unzipped project folder.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildZipFromFolder, projectZipEntries } from '../../src/testing/project-zip';
import type { TestResult } from '../../src/testing/runner';
import { parseLearnerFile, verifyCode } from '../../src/testing/token';
import { buildCheck, LEARNC_H, ROOT } from './build.mjs';
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

function check(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['check.mjs', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CC: 'gcc', NO_COLOR: '1', FORCE_COLOR: '', ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function checkJson(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): JsonReport & { status: number | null } {
  const r = check(dir, ['--json', ...args], env);
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
  it.runIf(has('clang-18') && has('valgrind'))('clang without sanitizer runtimes falls back to valgrind', () => {
    const leaky = checkJson(project('solution', path.join(VARIANTS, 'leaky.c')), ['--cc', 'clang-18']);
    expect(byName(leaky, 'no memory errors or leaks').message).toBe('memory leak: 2 bytes allocated at caesar.c:42 were never freed');
    const starter = checkJson(project('starter'), ['--cc', 'clang-18']);
    expect(byName(starter, 'no memory errors or leaks').message).toBe('heap overflow at caesar.c:26: wrote 1 byte just past the end of a 1-byte block allocated at caesar.c:22');
    expect(byName(checkJson(project('solution'), ['--cc', 'clang-18']), 'no memory errors or leaks')).toMatchObject({ status: 'pass', note: 'valgrind' });
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
  const make = (dir: string, args: string[]) => spawnSync('make', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, CC: 'gcc', NO_COLOR: '1' } });

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
