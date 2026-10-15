// Native compilers and the native run (PLAN §3.1 steps 2–3). Linux x86-64 gcc 13 and clang 22 run
// on every verify; `--target-run` uses the same code on the CI runners (macOS arm64 Apple clang,
// Linux aarch64 gcc, Windows MSVC).
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { parseDiagnostics } from '../../src/runtime/compile-core';
import type { Diagnostic, Severity, TargetId } from '../../src/content-model/types';
import { ROOT } from '../shared/wasm-node';
import { run } from './proc';

export type NativeKind = 'gcc' | 'clang' | 'msvc';

export interface NativeToolchain {
  target: TargetId;
  kind: NativeKind;
  /** Executable, e.g. "gcc", "clang-22", "cc", "cl". */
  cc: string;
  /** First line of `--version` (or cl's banner). */
  version: string;
  /** Whether -fsanitize=address,undefined builds and runs here (probed lazily). */
  readonly sanitizers: boolean;
  /** Set when the requested compiler was missing and a fallback is used. */
  warning?: string;
}

export const BASE_FLAGS = ['-std=c17', '-Wall', '-Wextra', '-pedantic', '-g', '-O0', '-fdiagnostics-color=never'];
export const SANITIZE_FLAGS = ['-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-fno-omit-frame-pointer'];
export const MSVC_FLAGS = ['/nologo', '/std:c17', '/W4', '/Zi', '/Od', '/diagnostics:classic'];

/** Sanitizer runtime options: halt at the first report; reports are classified from stderr, not exit codes. */
export const SANITIZER_ENV = {
  ASAN_OPTIONS: 'detect_leaks=1:abort_on_error=0:exitcode=86:color=never:symbolize=1',
  UBSAN_OPTIONS: 'print_stacktrace=1:halt_on_error=1:exitcode=87:color=never',
};

const has = (cmd: string): boolean => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
const firstLine = (cmd: string, args = ['--version']) => (spawnSync(cmd, args, { encoding: 'utf8' }).stdout ?? '').split('\n')[0].trim();

function probeSanitizers(cc: string, scratch: string): boolean {
  mkdirSync(scratch, { recursive: true });
  const src = path.join(scratch, 'probe.c');
  const exe = path.join(scratch, 'probe');
  writeFileSync(src, '#include <stdlib.h>\nint main(void) { int *p = malloc(4); p[0] = 1; int r = p[0] - 1; free(p); return r; }\n');
  const c = spawnSync(cc, [...SANITIZE_FLAGS, src, '-o', exe], { encoding: 'utf8' });
  if (c.status !== 0) return false;
  return spawnSync(exe, [], { encoding: 'utf8', env: { ...process.env, ...SANITIZER_ENV } }).status === 0;
}

/** Resolves the toolchain for a target on this machine. Throws when it cannot be found at all. */
export function resolveToolchain(target: TargetId, scratch: string): NativeToolchain {
  const mk = (kind: NativeKind, cc: string, warning?: string): NativeToolchain => {
    let probed: boolean | undefined; // probing compiles and runs a program: only when first needed
    return {
      target, kind, cc, warning,
      version: kind === 'msvc' ? (spawnSync(cc, [], { encoding: 'utf8' }).stderr ?? '').split('\n')[0].trim() : firstLine(cc),
      get sanitizers() { return (probed ??= kind !== 'msvc' && probeSanitizers(cc, path.join(scratch, `probe-${target}`))); },
    };
  };
  switch (target) {
    case 'linux-x86_64-gcc13':
    case 'linux-aarch64-gcc':
      if (!has(process.env.GCC ?? 'gcc')) throw new Error(`${target}: gcc not found`);
      return mk('gcc', process.env.GCC ?? 'gcc');
    case 'linux-x86_64-clang22': {
      const want = process.env.CLANG22 ?? 'clang-22';
      if (has(want)) return mk('clang', want);
      if (has('clang')) {
        return mk('clang', 'clang', `clang 22 not found (${want}); FALLING BACK to "${firstLine('clang')}". ` +
          'Outputs are not comparable with the browser compiler; install clang-22 or set CLANG22.');
      }
      throw new Error(`${target}: neither ${want} nor clang found`);
    }
    case 'macos-arm64-appleclang':
      return mk('clang', process.env.CC ?? 'cc');
    case 'windows-x64-msvc':
      return mk('msvc', 'cl');
    default:
      throw new Error(`${target} is not a native target`);
  }
}

/** Header files a sample may include that live next to it (the browser has them in its tree). */
export const SUPPORT_HEADERS = ['learnc.h'];

export function writeSources(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  for (const h of SUPPORT_HEADERS) {
    const dst = path.join(dir, h);
    if (!existsSync(dst)) copyFileSync(path.join(ROOT, 'src/runtime/c', h), dst);
  }
}

export interface NativeCompileOptions {
  dir: string;
  sources: string[];
  exe: string; // file name inside dir
  werror: boolean;
  posix?: boolean;
  sanitize?: boolean;
  extraFlags?: string[];
}

export interface NativeCompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  raw: string;
  command: string;
}

const MSVC_DIAG_RE = /^(.+?)\((\d+)(?:,(\d+))?\): (fatal error|error|warning|note) (C\d+): (.*)$/gm;

/** MSVC "main.c(5): warning C4477: …" → Diagnostic (flag = the C-number). */
export function parseMsvcDiagnostics(text: string): Diagnostic[] {
  return [...text.matchAll(MSVC_DIAG_RE)].map(m => ({
    file: path.basename(m[1]),
    line: Number(m[2]),
    col: Number(m[3] ?? 0),
    severity: m[4] as Severity,
    message: m[6],
    flag: m[5],
  }));
}

export async function compileNative(tc: NativeToolchain, o: NativeCompileOptions): Promise<NativeCompileResult> {
  let args: string[];
  if (tc.kind === 'msvc') {
    args = [...MSVC_FLAGS, ...(o.werror ? ['/WX'] : []), ...(o.extraFlags ?? []), ...o.sources, `/Fe:${o.exe}`];
  } else {
    args = [
      ...BASE_FLAGS,
      ...(o.werror ? ['-Werror'] : []),
      ...(o.posix ? ['-D_POSIX_C_SOURCE=200809L'] : []),
      ...(o.sanitize ? SANITIZE_FLAGS : []),
      ...(o.extraFlags ?? []),
      ...o.sources,
      '-o', o.exe, '-lm',
    ];
  }
  const r = await run(tc.cc, args, { cwd: o.dir });
  // Diagnostics name files relative to dir (we compile there), so no temp paths leak into output.
  const raw = ((r.stdout ?? '') + (r.stderr ?? '')).split(o.dir + path.sep).join('');
  const diagnostics = tc.kind === 'msvc' ? parseMsvcDiagnostics(raw) : parseDiagnostics(raw);
  return { ok: r.status === 0, diagnostics, raw: tc.kind === 'msvc' ? raw.replace(/^main\.c\r?\n/m, '') : raw, command: [tc.cc, ...args].join(' ') };
}

export interface NativeRunOptions {
  dir: string;
  exe: string;
  stdin?: string;
  args?: string[];
  timeoutMs: number;
  stdoutMode: 'tty' | 'pipe';
  maxBytes?: number;
  env?: Record<string, string>;
}

export interface NativeRunResult {
  stdout: string;
  stderr: string;
  exit: number | null;
  signal: string | null;
  timedOut: boolean;
  ms: number;
}

const decode = (b64: string) => new TextDecoder().decode(Buffer.from(b64, 'base64'));
const PTY_RUN = path.join(ROOT, 'tools/verify/pty_run.py');

/** Minimal child environment: the browser has none; sanitizers get their options. */
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C', ...extra };
}

export async function runNative(o: NativeRunOptions): Promise<NativeRunResult> {
  const exePath = path.join(o.dir, o.exe);
  if (process.platform === 'win32') {
    // No pty on Windows: pipes only, no output cap (documented; only `platform` samples run there).
    const t0 = performance.now();
    const r = await run(exePath, o.args ?? [], { cwd: o.dir, input: o.stdin ?? '', env: { ...process.env, ...o.env }, timeoutMs: o.timeoutMs });
    return {
      stdout: r.stdout.replace(/\r\n/g, '\n'),
      stderr: r.stderr.replace(/\r\n/g, '\n'),
      exit: r.timedOut ? null : r.status, signal: r.timedOut ? null : r.signal, timedOut: r.timedOut, ms: performance.now() - t0,
    };
  }
  const envArgs = Object.entries(childEnv(o.env)).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  const r = await run('python3', [
    PTY_RUN, '--timeout-ms', String(o.timeoutMs), '--max-bytes', String(o.maxBytes ?? 1 << 20),
    '--stdout', o.stdoutMode, '--cwd', o.dir, ...envArgs, '--', exePath, ...(o.args ?? []),
  ], { input: o.stdin ?? '', timeoutMs: o.timeoutMs + 10_000 });
  if (r.status !== 0) throw new Error(`pty_run.py failed (${r.status ?? r.signal}): ${r.stderr}`);
  const j = JSON.parse(r.stdout) as { stdout_b64: string; stderr_b64: string; exit: number | null; signal: string | null; timedOut: boolean; ms: number };
  return { stdout: decode(j.stdout_b64), stderr: decode(j.stderr_b64).split(o.dir + path.sep).join(''), exit: j.exit, signal: j.signal, timedOut: j.timedOut, ms: j.ms };
}

/** The host's native target for `--target-run` when none is given. */
export function hostTarget(): TargetId {
  if (process.platform === 'darwin') return 'macos-arm64-appleclang';
  if (process.platform === 'win32') return 'windows-x64-msvc';
  return process.arch === 'arm64' ? 'linux-aarch64-gcc' : 'linux-x86_64-gcc13';
}
