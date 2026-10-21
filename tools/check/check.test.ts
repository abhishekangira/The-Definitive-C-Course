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
function check(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['check.mjs', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', CC: 'gcc', NO_COLOR: '1', FORCE_COLOR: '', ...env } });
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
