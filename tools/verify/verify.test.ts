// Integration: the whole pipeline (gcc 13, clang 22, the browser toolchain in Node) on the
// throwaway fixture modules in tools/verify/fixtures. Results are cached in .cache/verify-test,
// so reruns take well under a second; a cold run takes a few seconds per module.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { SamplesFile, TraceFile } from '../../src/content-model/types';
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
