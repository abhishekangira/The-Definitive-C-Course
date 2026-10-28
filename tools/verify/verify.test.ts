// Integration: the whole pipeline (gcc 13, clang 22, the browser toolchain in Node) on the
// throwaway fixture modules in tools/verify/fixtures. Results are cached in .cache/verify-test,
// so reruns take well under a second; a cold run takes a few seconds per module.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { SamplesFile, SessionsFile, TraceFile } from '../../src/content-model/types';
import { stableStringify } from '../shared/stable-json';
import { ROOT } from '../shared/wasm-node';
import { isCacheable } from './cache';
import { checkFragment, checkProjection, cleanupScratch, verify } from './verify';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.join(HERE, 'fixtures/content');
const cacheDir = path.join(ROOT, '.cache/verify-test');
const generatedRoot = mkdtempSync(path.join(tmpdir(), 'tdcc-verify-test-'));
afterAll(() => { rmSync(generatedRoot, { recursive: true, force: true }); cleanupScratch(); });

const toolchainReady = existsSync(path.join(ROOT, 'src/generated/toolchain-version.json'));
const hasGdb = spawnSync('gdb', ['--version']).status === 0 && process.platform === 'linux' && process.arch === 'x64';
// The m97 sessions need the CI toolchain (root AGENTS.md "Start here" step 3), lldb-22 included. Missing tools skip
// the test with a warning naming them; on CI they are an error, so a green CI run always ran it.
const missingSessionTools = hasGdb ? ['valgrind', 'make', process.env.LLDB22 ?? 'lldb-22'].filter(t => spawnSync(t, ['--version']).status !== 0) : ['gdb (x86-64 Linux)'];
const hasSessionTools = missingSessionTools.length === 0 || !!process.env.CI;
if (!hasSessionTools) process.stderr.write(`\nverify.test.ts: SKIPPING the m97 native-session test: missing ${missingSessionTools.join(', ')}. Install the CI toolchain (root AGENTS.md, "Start here" step 3).\n`);

describe.skipIf(!toolchainReady || process.platform === 'win32')('verify (fixtures)', () => {
  it('m99: every sample passes and the generated file has the expected answers', async () => {
    const r = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm99', trace: hasGdb });
    expect(r.problems).toEqual([]);
    const file = JSON.parse(readFileSync(path.join(generatedRoot, 'samples/m99.json'), 'utf8')) as SamplesFile;
    const s = file.samples;
    expect(Object.keys(s)).toHaveLength(14);
    expect(file.generatedBy).toMatch(/gcc: .*13\.\d.*clang22: .*22\.\d.*wasm: yowasp-clang 22/);

    expect(s['fx-sum-stdin'].answer).toEqual({ stdout: '3 + 4 = 7\n', outcome: 'runs', native: { stdout: '3 + 4 = 7\n', outcome: 'runs' } });
    // %p normalised identically on all three targets; %#x untouched; NULL unified.
    const ptr = '&x      = <addr1>\n&y      = <addr2>\np       = <addr1> (same as &x? yes)\nnothing = <NULL>\nmagic   = 0xdeadbeef\n';
    for (const t of ['wasm32-clang22', 'linux-x86_64-gcc13', 'linux-x86_64-clang22'] as const) expect(s['fx-pointers'].results[t]!.run!.stdout).toBe(ptr);
    expect(s['fx-pointers'].results['wasm32-clang22']!.run!.stdoutDisplay).toMatch(/^&x {6}= 0x[0-9a-f]{5,6}\n/);
    expect(s['fx-pointers'].results['linux-x86_64-gcc13']!.run!.stdoutDisplay).toContain('nothing = (nil)');

    expect(s['fx-sizeof-long']).toMatchObject({ flagged: true, answer: { stdout: 'sizeof(long) = 4\n', native: { stdout: 'sizeof(long) = 8\n' } } });
    expect(s['fx-null-deref']).toMatchObject({ flagged: true, answer: { outcome: 'runs', native: { outcome: 'runtime-error' } } });
    expect(s['fx-null-deref'].results['linux-x86_64-gcc13']).toMatchObject({ run: { signal: 'SIGSEGV', stdout: 'about to read *p\n' }, sanitizer: { ok: false, kind: 'null-pointer-use', line: 6 } });
    expect(s['fx-null-deref'].results['wasm32-clang22']!.guardrail!.stderr).toContain("main.c:6:20: runtime error: load of null pointer of type 'int'");
    expect(s['fx-compile-error'].answer.outcome).toBe('compile-error');
    expect(s['fx-warning'].results['wasm32-clang22']!.compile.diagnostics[0]).toMatchObject({ line: 4, severity: 'warning', flag: '-Wunused-variable' });
    expect(s['fx-uninit'].results['linux-x86_64-gcc13']!.observed!.length).toBeGreaterThanOrEqual(1);
    // The canonical UB form: no raw output is stored, only the outcome categories (tools/verify/ub.ts).
    expect(s['fx-uninit'].results['linux-x86_64-gcc13']).toMatchObject({ run: { stdout: '', stderr: '' }, ub: { runs: 3 } });
    expect(s['fx-uninit'].answer).toMatchObject({ outcome: 'runs' });
    expect(s['fx-choice']).toMatchObject({ lesson: 'quiz:checkpoint', answer: { stdout: '3\n' } });
    expect(s['fx-hello'].hash).toMatch(/^[0-9a-f]{16}$/);
    expect(s['fx-args'].answer.stdout).toBe('2 argument(s)\n[one]\n[two words]\n');
    expect(s['fx-learnc'].answer.stdout).toBe('n? 42\n'); // learnc.h is available natively too
    // stdout=both: the tty run keeps the line printed before abort(); the pipe run loses it.
    expect(s['fx-buffering'].results['linux-x86_64-gcc13']).toMatchObject({ run: { stdout: 'this line was printed\n', signal: 'SIGABRT' }, runPipe: { stdout: '', signal: 'SIGABRT' } });
    expect(s['fx-buffering'].results['wasm32-clang22']!.run).toMatchObject({ stdout: 'this line was printed\n', trap: 'unreachable' });
    expect(Object.keys(s['fx-fork'].results).sort()).toEqual(['linux-x86_64-clang22', 'linux-x86_64-gcc13']);
    expect(s['fx-fork'].answer.stdout).toBe('child\nchild exited with 3\n');

    expect(r.fragments.checked).toBe(2);
    expect(r.fragments.partial).toHaveLength(1);

    if (hasGdb) {
      const trace = JSON.parse(readFileSync(path.join(generatedRoot, 'traces/fx-swap.json'), 'utf8')) as TraceFile;
      expect(trace).toMatchObject({ version: 1, sample: 'fx-swap', platform: 'linux-x86_64-gcc', exit_code: 0, truncated: false });
    }

    // --check against what was just written: up to date.
    const again = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm99', check: true, trace: hasGdb });
    expect(again.problems).toEqual([]);
    expect(again.files.stale).toEqual([]);

    // --check compares behaviour only: a version-string-only change passes, an output change fails.
    const samplesPath = path.join(generatedRoot, 'samples/m99.json');
    const onDisk = readFileSync(samplesPath, 'utf8');
    const reversioned = JSON.parse(onDisk) as SamplesFile;
    reversioned.generatedBy = 'tools/verify; gcc: gcc 99.0; clang22: clang 99 (++20990101000000); wasm: other';
    for (const sample of Object.values(reversioned.samples)) for (const t of Object.values(sample.results)) t!.compiler = 'some other compiler 99.0';
    writeFileSync(samplesPath, JSON.stringify(reversioned, null, 1));
    const versionOnly = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm99', check: true, trace: false });
    expect(versionOnly.problems).toEqual([]);
    expect(versionOnly.files.stale).toEqual([]);

    const changedOutput = JSON.parse(onDisk) as SamplesFile;
    changedOutput.samples['fx-hello'].results['linux-x86_64-gcc13']!.run!.stdout += 'extra\n';
    // Writing (not checking) over a difference that is only versions (UB garbage is the same kind of noise) keeps the committed file as it is.
    writeFileSync(samplesPath, JSON.stringify(reversioned, null, 1));
    const rewrite = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm99', trace: false });
    expect(rewrite.files.written).toEqual([]);
    expect(JSON.parse(readFileSync(samplesPath, 'utf8')).generatedBy).toBe(reversioned.generatedBy);
    writeFileSync(samplesPath, JSON.stringify(changedOutput));
    const outputChanged = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm99', check: true, trace: false });
    expect(outputChanged.files.stale).toHaveLength(1);
    expect(outputChanged.problems.join('\n')).toMatch(/m99\.json is stale.*Changed: fx-hello/);
    const regenerated = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm99', trace: false });
    expect(regenerated.files.written).toHaveLength(1); // an output change is written, with the current versions
    expect(JSON.parse(readFileSync(samplesPath, 'utf8')).generatedBy).toBe(file.generatedBy);
    // A rerun with no behaviour change writes nothing, even though UB samples print new garbage each time.
    const rerun = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm99', trace: false, force: true });
    expect(rerun.files.written).toEqual([]);
    writeFileSync(samplesPath, onDisk);
  }, 120_000);

  it.skipIf(!hasSessionTools)(`m97: every native session runs twice, stable, and stores the real tool output${missingSessionTools.length ? ` (missing: ${missingSessionTools.join(', ')})` : ''}`, async () => {
    expect(missingSessionTools, 'the CI toolchain must include every session tool').toEqual([]);
    const r = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm97', trace: false });
    expect(r.problems).toEqual([]);
    const file = JSON.parse(readFileSync(path.join(generatedRoot, 'sessions/m97.json'), 'utf8')) as SessionsFile;
    expect(Object.keys(file.sessions).sort()).toEqual(['analyser', 'asan', 'compile-error', 'gdb', 'libm', 'link-multiple', 'link-order', 'link-undefined', 'lldb', 'make', 'pipeline', 'ubsan', 'valgrind-leak', 'valgrind-uninit']);
    expect(file.generatedBy).toMatch(/gcc: .*13\.\d.*clang22: .*22\.\d.*gdb: GNU gdb.*valgrind: valgrind-3.*lldb: lldb version 22.*make: GNU Make/);

    // The committed copy is the app's test data (<Transcript>: src/components/transcript-tabs.test.ts and Transcript.dom.test.ts, e2e/transcript.spec.ts), so
    // it is this output on the CI toolchain, never typed or edited: everything but the version line must match. On a
    // mismatch the fresh file goes to test-results/, which CI uploads (artifact playwright-report) when the job fails.
    const committed = path.join(HERE, 'fixtures/generated/sessions/m97.json');
    const fresh = readFileSync(path.join(generatedRoot, 'sessions/m97.json'), 'utf8');
    const behaviour = (text: string) => stableStringify({ ...(JSON.parse(text) as SessionsFile), generatedBy: '<version>' });
    if (!existsSync(committed) || behaviour(readFileSync(committed, 'utf8')) !== behaviour(fresh)) {
      const out = path.join(ROOT, 'test-results/session-fixtures/m97.json');
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, fresh);
      // TEMP fixture bootstrap (removed before merge): print CI's fresh file so the author can commit CI's copy.
      const b64 = Buffer.from(fresh, 'utf8').toString('base64');
      console.log('M97_FRESH_BEGIN');
      for (let i = 0; i < b64.length; i += 120) console.log(`M97:${b64.slice(i, i + 120)}`);
      console.log('M97_FRESH_END');
      expect.fail(`${path.relative(ROOT, committed)} is not what tools/verify writes now. The fresh file is ${path.relative(ROOT, out)}: commit it in its place, from a CI run (root AGENTS.md, Reference environment)`);
    }
    const step = (id: string, platform: 'linux-gcc' | 'linux-clang', i: number) => file.sessions[id].runs[platform]![i];
    for (const p of ['linux-gcc', 'linux-clang'] as const) {
      expect(step('compile-error', p, 0)).toMatchObject({ exit: 1, cmd: '$CC $CFLAGS -c main.c' });
      expect(step('compile-error', p, 0).stderr).toMatch(/^main\.c:5:\d+: error: /m);
      expect(step('link-undefined', p, 1)).toMatchObject({ as: 'ld', exit: 1 });
      expect(step('link-undefined', p, 1).stderr).toContain("<dir>/main.c:6:(.text+0x");
      expect(step('link-undefined', p, 1).stderr).toContain("undefined reference to `area'");
      expect(step('link-undefined', p, 2).stdout).toMatch(/^ +U area\n(.*\n)?0+ T main\n +U printf\n$/m);
      expect(step('link-multiple', p, 1).stderr).toMatch(/multiple definition of `count'/);
      expect(step('link-order', p, 1).stderr).toContain("undefined reference to `b'");
      expect(step('link-order', p, 2)).toMatchObject({ stdout: '42\n', exit: 0 });
      expect(step('libm', p, 0).stderr).toMatch(/<tmp1>\.o: in function `main':\n<dir>\/main\.c:7:.*undefined reference to `sqrt'/);
      expect(step('libm', p, 2)).toMatchObject({ stdout: '1.414\n', exit: 0 });
      // UBSan reports and continues by default; with -fno-sanitize-recover=all it stops before printing.
      expect(step('ubsan', p, 0)).toMatchObject({ stdout: 'done\n', exit: 0 });
      expect(step('ubsan', p, 0).stderr).toMatch(/^main\.c:6:\d+: runtime error: signed integer overflow: 2147483647 \+ 1 cannot be represented in type 'int'/m);
      expect(step('ubsan', p, 1).stdout).toBe('');
      expect(step('ubsan', p, 1).exit).not.toBe(0);
      expect(step('asan', p, 0).stderr).toMatch(/==PID==ERROR: AddressSanitizer: stack-buffer-overflow on address <addr1>[^]*#0 <addr\d+> in main <dir>\/main\.c:5/);
      expect(step('valgrind-uninit', p, 1).stderr).toMatch(/Conditional jump or move depends on uninitialised value\(s\)\n==PID== {4}at <addr\d+>: main \(u\.c:8\)\n==PID== {2}Uninitialised value was created by a stack allocation\n==PID== {4}at <addr\d+>: main \(u\.c:5\)/);
      expect(step('valgrind-leak', p, 1).stderr).toMatch(/40 bytes in 1 blocks are definitely lost/);
      expect(step('make', p, 1).stdout).toBe("make: 'credit' is up to date.\n");
      expect(step('make', p, 2).stdout).toMatch(/-c main\.c\n.*-c luhn\.c\n.*-o credit main\.o luhn\.o\n$/);
      expect(step('make', p, 3)).toMatchObject({ exit: 2, stderr: 'spaces.mk:2: *** missing separator.  Stop.\n' });
    }
    expect(step('analyser', 'linux-gcc', 0).stderr).toMatch(/u\.c:3:\d+: warning: use of uninitialized value '\*sum' .*\[-Wanalyzer-use-of-uninitialized-value\]/);
    expect(step('analyser', 'linux-clang', 0).stderr).toMatch(/\[core\.uninitialized\.Assign\]/);
    expect(step('gdb', 'linux-gcc', 1).stdout).toMatch(/^Breakpoint 1, main \(\) at w\.c:6\n6\t {8}total \+= n;\n\$1 = 3\n/m);
    expect(step('gdb', 'linux-gcc', 1).stdout).toContain('[Inferior 1 (process <pid>) exited normally]');
    expect(step('lldb', 'linux-clang', 1).stdout).toMatch(/\(lldb\) frame variable n\n\(int\) n = 3\n/);
    expect(file.sessions.gdb.runs['linux-clang']).toBeUndefined(); // only: gcc
    // Which platforms have steps, so the app can tell a run still to come (macOS before Targets) from one that never runs.
    expect(file.sessions.gdb.platforms).toEqual(['linux-gcc']);
    expect(file.sessions.lldb.platforms).toEqual(['linux-clang', 'macos']);
    expect(file.sessions['valgrind-uninit'].platforms).toEqual(['linux-gcc', 'linux-clang']);
    expect(file.sessions['link-undefined'].platforms).toEqual(['linux-gcc', 'linux-clang', 'macos']);
    // The session's sources, as committed, for the line a report points at.
    expect(Object.keys(file.sessions['link-multiple'].sources)).toEqual(['bump.c', 'count.h', 'main.c']);
    expect(file.sessions.asan.sources['main.c']).toBe(readFileSync(path.join(contentRoot, 'modules/m97-sessions/sessions/asan/main.c'), 'utf8'));
    expect(file.sessions.lldb.runs['linux-gcc']).toBeUndefined(); // only: clang

    // Two more runs without the cache: --check finds the stored file up to date.
    const again = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm97', check: true, force: true, trace: false });
    expect(again.problems).toEqual([]);
    expect(again.files.stale).toEqual([]);

    // A stored macOS run is merged in while the session is unchanged, and reported stale when it changed.
    const macDir = path.join(generatedRoot, 'targets/macos-arm64-appleclang');
    mkdirSync(macDir, { recursive: true });
    const mac = [{ cmd: 'make', stdout: 'make: `credit\' is up to date.\n', stderr: '', exit: 0 }];
    const stored = (hash: string) => writeFileSync(path.join(macDir, 'm97.sessions.json'), JSON.stringify({ module: 'm97', target: 'macos-arm64-appleclang', generatedBy: 'x', sessions: { make: { hash, steps: mac } } }));
    stored(file.sessions.make.hash);
    await verify({ contentRoot, generatedRoot, cacheDir, module: 'm97', trace: false });
    expect((JSON.parse(readFileSync(path.join(generatedRoot, 'sessions/m97.json'), 'utf8')) as SessionsFile).sessions.make.runs.macos).toEqual(mac);
    stored('0000000000000000');
    const staleMac = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm97', trace: false });
    expect(staleMac.notes).toContain('modules/m97-sessions/sessions/make: the stored macOS run is stale (the session changed); rerun the Targets workflow');
    rmSync(macDir, { recursive: true, force: true });
  }, 180_000);

  it('never caches a timed-out run, so a later run is not poisoned by it', async () => {
    const freshCache = mkdtempSync(path.join(tmpdir(), 'tdcc-verify-cache-'));
    try {
      const first = await verify({ contentRoot, generatedRoot, cacheDir: freshCache, module: 'm98', only: 'neg-timeout', trace: false });
      expect(first.samples[0].problems.join('\n')).toMatch(/timed out/);
      expect(first.samples[0].cached).toBe(false);
      expect(readdirSync(freshCache).filter(f => f.endsWith('.json'))).toEqual([]);
      const second = await verify({ contentRoot, generatedRoot, cacheDir: freshCache, module: 'm98', only: 'neg-timeout', trace: false });
      expect(second.samples[0].cached).toBe(false); // ran again instead of replaying the timeout
      // A sample that finishes is still cached.
      await verify({ contentRoot, generatedRoot, cacheDir: freshCache, module: 'm99', only: 'fx-hello', trace: false });
      expect(readdirSync(freshCache).filter(f => f.endsWith('.json'))).toHaveLength(1);
    } finally { rmSync(freshCache, { recursive: true, force: true }); }
  }, 120_000);

  it('m98: each negative sample fails for its reason', async () => {
    const r = await verify({ contentRoot, generatedRoot, cacheDir, module: 'm98', trace: false });
    const by = (id: string) => r.samples.find(s => s.sample.id === id)!.problems.join('\n');
    expect(by('neg-sizeof-undeclared')).toMatch(/add `platform` and `predict64=/);
    expect(by('neg-unexpected-warning')).toMatch(/gcc 13 \(x86-64 Linux\): compile failed \(warnings are errors/);
    expect(by('neg-unexpected-warning')).toMatch(/browser compile must be warning-free/);
    expect(by('neg-asan')).toMatch(/ASan\/UBSan is not clean: AddressSanitizer: heap-buffer-overflow main\.c:7/);
    expect(by('neg-choice')).toMatch(/matches 0/);
    expect(by('neg-timeout')).toMatch(/browser \(wasm32\): timed out/);
    expect(r.problems.some(p => /C fence needs id=/.test(p))).toBe(true);
  }, 120_000);
});

describe('checkFragment', () => {
  it('accepts file-scope and statement fragments, rejects broken ones', () => {
    expect(checkFragment('int scores[3] = {1, 2, 3};\n').ok).toBe(true);
    expect(checkFragment('int t = 0;\nfor (int i = 0; i < 3; i++) t += i;\n').ok).toBe(true);
    const bad = checkFragment('for (int i = 0; i < 3; i++) total += i;\n');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics).toMatch(/fragment\.c:1:\d+: error: 'total' undeclared/);
  });

  it('reports ASCII quotes even when the caller runs in a UTF-8 locale', () => {
    const saved = process.env.LC_ALL;
    process.env.LC_ALL = 'C.UTF-8'; // gcc prints \u2018total\u2019 here unless checkFragment pins LC_ALL=C itself
    try {
      const bad = checkFragment('for (int i = 0; i < 3; i++) total += i;\n');
      expect(bad.diagnostics).toContain("'total' undeclared");
      expect(bad.diagnostics).not.toMatch(/[\u2018\u2019]/);
    } finally {
      if (saved === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = saved;
    }
  });
});

describe('isCacheable', () => {
  const ok = { stdout: '', stderr: '', exit: 0 };
  const target = (extra: object) => ({ 'linux-x86_64-gcc13': { target: 'linux-x86_64-gcc13', compiler: 'g', compile: { ok: true, diagnostics: [], raw: '' }, ...extra } });
  it('rejects hard errors and a timeout anywhere in the results, accepts clean runs', () => {
    expect(isCacheable({ errors: [], results: target({ run: ok }) })).toBe(true);
    expect(isCacheable({ errors: ['pty_run crashed'], results: target({ run: ok }) })).toBe(false);
    expect(isCacheable({ errors: [], results: target({ run: { ...ok, exit: null, timedOut: true } }) })).toBe(false);
    expect(isCacheable({ errors: [], results: target({ run: ok, observed: [ok, { ...ok, timedOut: true }] }) })).toBe(false);
    expect(isCacheable({ errors: [], results: target({ run: ok, guardrail: { ...ok, timedOut: true } }) })).toBe(false);
    expect(isCacheable({ errors: [], results: target({ run: ok, sanitizer: { ok: false, kind: 'timeout' } }) })).toBe(false);
    expect(isCacheable({ errors: [], results: target({ run: ok, sanitizer: { ok: true } }) })).toBe(true);
  });
});

describe('checkProjection', () => {
  it('ignores version strings but not behaviour', () => {
    const mk = (by: string, compiler: string, stdout: string): SamplesFile => ({
      module: 'm', generatedBy: by, samples: {
        p: { id: 'p', module: 'm', lesson: 'l', code: 'c', meta: { id: 'p' }, hash: 'h', flagged: false, answer: { stdout, outcome: 'runs' }, results: { 'linux-x86_64-clang22': { target: 'linux-x86_64-clang22', compiler, compile: { ok: true, diagnostics: [], raw: '' }, run: { stdout, stderr: '', exit: 0 } } } },
      },
    });
    expect(checkProjection(mk('a', 'clang 22.1.0 ++2026', 'x\n'))).toEqual(checkProjection(mk('b', 'clang 22.1.1 ++2027', 'x\n')));
    expect(checkProjection(mk('a', 'c', 'x\n'))).not.toEqual(checkProjection(mk('a', 'c', 'y\n')));
  });

  it('treats a committed file from before the canonical UB form as equal to the canonical one', () => {
    const file = (t: object): SamplesFile => ({
      module: 'm', generatedBy: 'g', samples: {
        u: { id: 'u', module: 'm', lesson: 'l', code: 'c', meta: { id: 'u', expect: 'ub' }, hash: 'h', flagged: false, answer: { stdout: '', outcome: 'runs' }, results: { 'linux-x86_64-gcc13': { target: 'linux-x86_64-gcc13', compiler: 'g', compile: { ok: true, diagnostics: [], raw: '' }, ...t } } },
      },
    });
    const old = file({ run: { stdout: '123\n', stderr: '', exit: 0, signal: null }, observed: [{ stdout: '123\n', stderr: '', exit: 0, signal: null }, { stdout: '456\n', stderr: '', exit: 0, signal: null }] });
    const canonical = file({ run: { stdout: '', stderr: '', exit: 0 }, observed: [{ stdout: '', stderr: '', exit: 0 }], ub: { runs: 3, outcomes: ['runs'] } });
    expect(checkProjection(old)).toEqual(checkProjection(canonical));
  });

  it('ignores UB garbage and display text, nothing else', () => {
    const mk = (garbage: string, display: string): SamplesFile => ({
      module: 'm', generatedBy: 'g', samples: {
        u: { id: 'u', module: 'm', lesson: 'l', code: 'c', meta: { id: 'u', expect: 'ub' }, hash: 'h', flagged: false, answer: { stdout: garbage, outcome: 'runs' }, results: { 'linux-x86_64-gcc13': { target: 'linux-x86_64-gcc13', compiler: 'g', compile: { ok: true, diagnostics: [], raw: '' }, run: { stdout: garbage, stderr: '', exit: 0 }, observed: [{ stdout: garbage, stderr: '', exit: 0 }] } } },
        p: { id: 'p', module: 'm', lesson: 'l', code: 'c', meta: { id: 'p' }, hash: 'h', flagged: false, answer: { stdout: '<addr1>\n', outcome: 'runs' }, results: { 'linux-x86_64-gcc13': { target: 'linux-x86_64-gcc13', compiler: 'g', compile: { ok: true, diagnostics: [], raw: '' }, run: { stdout: '<addr1>\n', stdoutDisplay: display, stderr: '', exit: 0 } } } },
      },
    });
    expect(checkProjection(mk('1\n', '0x1\n'))).toEqual(checkProjection(mk('2\n', '0x2\n')));
    const changed = mk('1\n', '0x1\n');
    changed.samples.p.answer.stdout = 'different\n';
    expect(checkProjection(changed)).not.toEqual(checkProjection(mk('1\n', '0x1\n')));
  });
});
