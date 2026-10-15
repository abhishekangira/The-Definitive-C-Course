// ExecBackend for the learner's own machine (check.mjs): their compiler, their make, and the memory
// tools their platform has. Bundled into dist-tools/check.mjs, so: Node 18+, node: imports only.
//
// Memory checks (PLAN §4.1-4.2):
//   Linux / WSL  ASan + UBSan, with LeakSanitizer (part of ASan) for leaks
//   macOS        ASan + UBSan with detect_leaks=0 (Apple's runtime has no LSan) + `leaks --atExit` on a plain build
//   no sanitizer runtime (e.g. clang without compiler-rt): valgrind on a plain build, when installed
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Diagnostic } from '../../../src/content-model/types';
import { parseDiagnostics } from '../../../src/runtime/compile-core';
import { decodeBytes } from '../../../src/testing/compare';
import type { CompileOptions, CompileOutcome, ExecBackend, ExecOutcome, ExecRunOptions, MakeOptions, MakeOutcome } from '../../../src/testing/exec';
import { parseLeaksReport, parseSanitizerReport, parseValgrindReport, type MemoryIssue } from '../../../src/testing/memory';

export const STRICT_FLAGS = ['-std=c17', '-Wall', '-Wextra', '-pedantic', '-g', '-O0'];
export const SANITIZE_FLAGS = ['-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-fno-sanitize-recover=all'];
const UBSAN_FLAGS = ['-fsanitize=undefined', '-fno-sanitize-recover=all'];
const LIBS = ['-lm'];
/** Exit codes we give the sanitizers, so their reports are never mistaken for the program's own status. */
const ASAN_EXIT = 86;
const UBSAN_EXIT = 87;
const VALGRIND_EXIT = 99;
const MAX_OUTPUT = 16 << 20;

export interface Compiler {
  cc: string;
  /** First line of `cc --version`, e.g. "gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0". */
  version: string;
  /** What `cc` really is ("cc" is gcc on Ubuntu and Apple clang on macOS). */
  kind: 'gcc' | 'clang' | 'Apple clang' | 'unknown';
  apple: boolean;
}

export interface Capabilities {
  /** ASan+UBSan binaries build and run. */
  sanitizers: boolean;
  /** LeakSanitizer actually reports leaks (Linux; can fail in containers without ptrace). */
  lsan: boolean;
  valgrind: boolean;
  /** macOS leaks(1). */
  leaks: boolean;
}

export interface NativeArtifact {
  exe: string;
  mode: 'plain' | 'asan' | 'valgrind';
  /** A plain build of the same sources, for `leaks` or valgrind leak checks next to ASan. */
  plainExe?: string;
  /** A memory check was asked for, but this machine has no tool for it. */
  memoryUnavailable?: boolean;
}

export interface NativeOptions {
  /** The project folder: sources are compiled from here and programs run here. */
  dir: string;
  /** Preferred compiler (--cc), tried before $CC, cc, clang, gcc. */
  cc?: string;
  /** Platform override, for testing the macOS paths on Linux (CHECK_PLATFORM). */
  platform?: string;
  /** Learner file names, used to pick the right frames from memory reports. */
  learnerFiles?: string[];
  /** Keep the build folder (--keep). */
  keep?: boolean;
  /** Pretend there is no sanitizer runtime (CHECK_NO_SANITIZERS), to test the valgrind path. */
  noSanitizers?: boolean;
}

interface Proc {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  missing: boolean;
  outputLimit: boolean;
}

function sh(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}): Proc {
  const r: SpawnSyncReturns<Buffer> = spawnSync(cmd, args, {
    cwd: opts.cwd, input: opts.input ?? '', timeout: opts.timeout, env: opts.env, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT, windowsHide: true,
  });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ? decodeBytes(r.stdout) : '',
    stderr: r.stderr ? decodeBytes(r.stderr) : '',
    timedOut: code === 'ETIMEDOUT',
    missing: code === 'ENOENT',
    outputLimit: code === 'ENOBUFS',
  };
}

/** Finds a working C compiler: preferred, $CC, cc, clang, gcc. */
export function findCompiler(preferred?: string, env: NodeJS.ProcessEnv = process.env): Compiler | undefined {
  const seen = new Set<string>();
  for (const cc of [preferred, env.CC, 'cc', 'clang', 'gcc']) {
    if (!cc || seen.has(cc)) continue;
    seen.add(cc);
    const r = sh(cc, ['--version'], { timeout: 10_000 });
    if (r.status === 0) {
      const text = r.stdout || r.stderr;
      const version = text.split('\n')[0].trim();
      const apple = /Apple (clang|LLVM)/.test(text);
      const kind = apple ? 'Apple clang' : /clang/i.test(text) ? 'clang' : /Free Software Foundation|\bgcc\b|GCC/.test(text) ? 'gcc' : 'unknown';
      return { cc, version, kind, apple };
    }
  }
  return undefined;
}

/** Short display name: "gcc 13.3.0", "clang 22.1.8", "Apple clang 15.0.0". */
export function shortCompilerName(c: Compiler): string {
  const v = /(\d+\.\d+(?:\.\d+)?)(?!.*\d+\.\d+)/.exec(c.version.replace(/\(.*?\)/g, ''))?.[1] ?? '';
  const kind = c.kind === 'unknown' ? c.cc : c.kind;
  return v ? `${kind} ${v}` : c.version;
}

export class NativeBackend implements ExecBackend<NativeArtifact> {
  readonly name: string;
  readonly combinedMemoryBuild = false;
  readonly memoryHint: string;
  readonly compiler: Compiler;
  readonly platform: string;
  private readonly work: string;
  private readonly dir: string;
  private caps?: Capabilities;
  private builds = 0;

  constructor(compiler: Compiler, private readonly opts: NativeOptions) {
    this.compiler = compiler;
    this.name = shortCompilerName(compiler);
    this.dir = path.resolve(opts.dir);
    this.platform = opts.platform ?? process.platform;
    this.work = mkdtempSync(path.join(tmpdir(), 'check-'));
    this.memoryHint = this.platform === 'darwin'
      ? 'See the full report yourself: build with -fsanitize=address,undefined -g and run it, then run `leaks --atExit -- ./program` for leaks.'
      : 'See the full report yourself: build with -fsanitize=address,undefined -g and run it (or run the plain build under valgrind --leak-check=full).';
  }

  /** Deletes the build folder (unless --keep). */
  dispose(): void {
    if (!this.opts.keep) rmSync(this.work, { recursive: true, force: true });
  }

  get workDir(): string { return this.work; }

  private sanitizerEnv(): NodeJS.ProcessEnv {
    const leaks = this.platform === 'linux' && this.capabilities().lsan ? 1 : 0;
    return {
      ...process.env,
      ASAN_OPTIONS: `detect_leaks=${leaks}:abort_on_error=0:exitcode=${ASAN_EXIT}:color=never`,
      UBSAN_OPTIONS: `print_stacktrace=1:halt_on_error=1:exitcode=${UBSAN_EXIT}:color=never`,
      MallocNanoZone: '0', // silences a known macOS ASan warning
    };
  }

  /** Probes once (lazily) what this machine can do. */
  capabilities(): Capabilities {
    if (this.caps) return this.caps;
    const has = (cmd: string, args: string[]) => !sh(cmd, args, { timeout: 10_000 }).missing;
    let sanitizers = false;
    let lsan = false;
    if (!this.opts.noSanitizers) {
      const probe = path.join(this.work, 'probe.c');
      writeFileSync(probe, '#include <stdlib.h>\nint main(void) { void *p = malloc(7); return p == 0; }\n');
      const exe = path.join(this.work, 'probe');
      const b = sh(this.compiler.cc, [...SANITIZE_FLAGS, probe, '-o', exe], { timeout: 60_000 });
      if (b.status === 0) {
        const quiet = { ...process.env, ASAN_OPTIONS: 'detect_leaks=0', MallocNanoZone: '0' };
        sanitizers = sh(exe, [], { env: quiet, timeout: 20_000 }).status === 0;
        if (sanitizers && this.platform === 'linux') {
          const r = sh(exe, [], { env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1' }, timeout: 20_000 });
          lsan = /LeakSanitizer: detected memory leaks/.test(r.stderr);
        }
      }
    }
    this.caps = {
      sanitizers,
      lsan,
      valgrind: this.platform === 'linux' && has('valgrind', ['--version']),
      leaks: this.platform === 'darwin' && has('leaks', ['--help']),
    };
    return this.caps;
  }

  /**
   * Files that differ from the project folder (generated harnesses, check.h) are written to the build
   * folder; everything else is compiled in place, so diagnostics name the learner's own files.
   */
  private place(files: Record<string, string>): Set<string> {
    const generated = new Set<string>();
    for (const [rel, text] of Object.entries(files)) {
      const onDisk = path.join(this.dir, rel);
      if (existsSync(onDisk) && readFileSync(onDisk, 'utf8') === text) continue;
      const dest = path.join(this.work, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, text);
      generated.add(rel);
    }
    return generated;
  }

  private build(sources: string[], generated: Set<string>, flags: string[], out: string) {
    const srcArgs = sources.map(s => (generated.has(s) ? path.join(this.work, s) : s));
    const args = ['-fdiagnostics-color=never', ...STRICT_FLAGS, ...flags, `-I${this.work}`, `-I${this.dir}`, ...srcArgs, '-o', out, ...LIBS];
    const r = sh(this.compiler.cc, args, { cwd: this.dir, timeout: 120_000 });
    // Show generated files by their logical names, not their temporary paths.
    const raw = (r.stderr + r.stdout).split(this.work + path.sep).join('');
    return { ok: r.status === 0, raw, diagnostics: parseDiagnostics(raw) as Diagnostic[] };
  }

  async compile(files: Record<string, string>, sources: string[], o: CompileOptions): Promise<CompileOutcome<NativeArtifact>> {
    const generated = this.place(files);
    const n = ++this.builds;
    const exe = path.join(this.work, `${o.purpose ?? 'program'}-${n}`);
    const caps = o.leakcheck || o.guardrail ? this.capabilities() : undefined;
    const extra = [...(o.extraFlags ?? [])];
    let mode: NativeArtifact['mode'] = 'plain';
    if (o.leakcheck && caps?.sanitizers) { extra.push(...SANITIZE_FLAGS); mode = 'asan'; }
    else if (o.leakcheck && caps?.valgrind) mode = 'valgrind';
    else if (o.guardrail && caps?.sanitizers) extra.push(...UBSAN_FLAGS);

    const main = this.build(sources, generated, extra, exe);
    if (!main.ok) return { ok: false, raw: main.raw, diagnostics: main.diagnostics };
    const artifact: NativeArtifact = { exe, mode, memoryUnavailable: o.leakcheck && mode === 'plain' };
    // Leak checking next to ASan: macOS `leaks`, or valgrind where LeakSanitizer does not work.
    if (mode === 'asan' && caps && ((this.platform === 'darwin' && caps.leaks) || (this.platform === 'linux' && !caps.lsan && caps.valgrind))) {
      const plain = this.build(sources, generated, o.extraFlags ?? [], `${exe}-plain`);
      if (plain.ok) artifact.plainExe = `${exe}-plain`;
    }
    return { ok: true, raw: main.raw, diagnostics: main.diagnostics, artifact };
  }

  async run(a: NativeArtifact, o: ExecRunOptions): Promise<ExecOutcome> {
    const learner = this.opts.learnerFiles ?? [];
    const base = (p: Proc): ExecOutcome => ({
      stdout: p.stdout, stderr: p.stderr, exit: p.signal || p.timedOut ? null : p.status,
      signal: p.timedOut ? null : p.signal, timedOut: p.timedOut, outputLimit: p.outputLimit,
    });

    if (a.mode === 'valgrind') {
      const r = sh('valgrind', ['-q', `--error-exitcode=${VALGRIND_EXIT}`, '--leak-check=full', '--errors-for-leak-kinds=definite,indirect',
        '--show-leak-kinds=definite,indirect', a.exe, ...(o.args ?? [])], { cwd: this.dir, input: o.stdin, timeout: Math.max(o.timeoutMs * 4, 20_000) });
      return { ...base(r), memory: parseValgrindReport(r.stderr, learner), memoryTools: ['valgrind'], leaksChecked: true };
    }

    if (a.mode === 'asan') {
      const caps = this.capabilities();
      const r = sh(a.exe, o.args ?? [], { cwd: this.dir, input: o.stdin, timeout: o.timeoutMs, env: this.sanitizerEnv() });
      const memory: MemoryIssue[] = parseSanitizerReport(r.stderr, learner);
      const tools = ['AddressSanitizer', 'UBSan'];
      let leaksChecked = this.platform === 'linux' && caps.lsan;
      if (leaksChecked) tools.push('LeakSanitizer');
      // A crashed or timed-out run has no meaningful leak report.
      const finished = !r.timedOut && !r.signal && r.status !== ASAN_EXIT && r.status !== UBSAN_EXIT;
      if (a.plainExe && this.platform === 'darwin') {
        tools.push('leaks');
        leaksChecked = true;
        if (finished) {
          const l = sh('leaks', ['--atExit', '--', a.plainExe, ...(o.args ?? [])],
            { cwd: this.dir, input: o.stdin, timeout: Math.max(o.timeoutMs * 4, 30_000), env: { ...process.env, MallocStackLogging: '1' } });
          memory.push(...parseLeaksReport(l.stdout, learner));
        }
      } else if (a.plainExe) {
        tools.push('valgrind (leaks)');
        leaksChecked = true;
        if (finished) {
          const v = sh('valgrind', ['-q', '--leak-check=full', '--errors-for-leak-kinds=definite,indirect', '--show-leak-kinds=definite,indirect',
            a.plainExe, ...(o.args ?? [])], { cwd: this.dir, input: o.stdin, timeout: Math.max(o.timeoutMs * 4, 20_000) });
          memory.push(...parseValgrindReport(v.stderr, learner).filter(i => i.kind === 'leak'));
        }
      }
      return { ...base(r), memory, memoryTools: tools, leaksChecked };
    }

    const r = sh(a.exe, o.args ?? [], { cwd: this.dir, input: o.stdin, timeout: o.timeoutMs, env: this.sanitizerEnv() });
    if (a.memoryUnavailable) {
      const how = this.platform === 'darwin' ? 'install the Xcode Command Line Tools (xcode-select --install)' : 'install valgrind (sudo apt install valgrind), or use gcc, whose sanitizers ship with build-essential';
      return { ...base(r), memoryUnavailable: `no memory checker works with ${this.name} on this machine: ${how}` };
    }
    return base(r);
  }

  async make(target: string, o: MakeOptions): Promise<MakeOutcome> {
    const env = { ...process.env, CC: this.compiler.cc };
    const r = sh('make', [target], { cwd: this.dir, timeout: o.timeoutMs, env });
    const output = r.stdout + r.stderr;
    if (r.missing) return { ok: false, exit: null, output, missing: true };
    if (r.timedOut) return { ok: false, exit: null, output, timedOut: true };
    if (r.status !== 0) return { ok: false, exit: r.status, output };
    const notRebuilt: string[] = [];
    for (const f of o.expectRebuild ?? []) {
      const p = path.join(this.dir, f);
      if (!existsSync(p)) return { ok: false, exit: null, output: `${output}\n${f} does not exist, so the rebuild check cannot run` };
      const { atime, mtime } = statSync(p);
      try {
        // Make the file newer than anything make built (mtime granularity can be a whole second).
        utimesSync(p, atime, new Date(Date.now() + 2000));
        const q = sh('make', ['-q', target], { cwd: this.dir, timeout: o.timeoutMs, env });
        if (q.status === 0) notRebuilt.push(f); // 0 = "up to date": the Makefile does not depend on f
      } finally {
        utimesSync(p, atime, mtime);
      }
    }
    return { ok: true, exit: 0, output, notRebuilt };
  }
}
