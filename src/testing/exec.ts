// The contract between the shared test runner (runner.ts) and the thing that actually compiles and
// runs C: the in-browser toolchain (app), the same toolchain in Node (tools/exercises), or the
// learner's own compiler (check.mjs). Environment-neutral: types plus one pure adapter.
import type { Diagnostic } from '../content-model/types';
import type { LeakEvent, RunResult } from '../runtime/protocol';
import type { MemoryIssue } from './memory';

export interface CompileOptions {
  /** Browser: UBSan guardrail runtime. Native: -fsanitize=undefined where available. */
  guardrail?: boolean;
  /**
   * A memory-checked build. Browser: link leakcheck.c (-Wl,--wrap=…). Native: ASan+UBSan (with
   * LeakSanitizer on Linux), or a plain build that run() wraps in valgrind / macOS `leaks`.
   */
  leakcheck?: boolean;
  extraFlags?: string[];
  /** What the build is for; backends may use it to name outputs or pick flags. */
  purpose?: 'program' | 'unit' | 'memory';
}

export interface CompileOutcome<A = unknown> {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Raw compiler/linker output (shown when no diagnostic could be parsed, e.g. linker errors). */
  raw: string;
  /** Whatever run() needs: wasm bytes, a path to an executable… Present when ok. */
  artifact?: A;
}

export interface ExecRunOptions {
  stdin?: string;
  args?: string[];
  /** Wall-clock (native) or CPU (browser) budget; the run is killed after it. */
  timeoutMs: number;
}

export interface ExecOutcome {
  /** Decoded with decodeBytes() (compare.ts) so invalid bytes survive as \xNN. */
  stdout: string;
  stderr: string;
  /** Exit status, or null when the program did not exit by itself (signal, trap, timeout). */
  exit: number | null;
  /** Native: the terminating signal name, e.g. "SIGSEGV". */
  signal?: string | null;
  /** Browser: the WebAssembly trap message, e.g. "divide by zero". */
  trap?: string | null;
  timedOut?: boolean;
  /** The output cap was hit and the program was stopped. */
  outputLimit?: boolean;
  /** Browser leak checker events (leakcheck builds). */
  leakcheck?: LeakEvent[];
  /** Native memory tools' findings, already parsed (leakcheck builds). */
  memory?: MemoryIssue[];
  /** Which memory tools watched this run, e.g. ["AddressSanitizer", "UBSan", "LeakSanitizer"]. */
  memoryTools?: string[];
  /** False when the run was memory-checked but no leak detector was available. */
  leaksChecked?: boolean;
  /** Set when a memory check was asked for but no tool could watch the run (the check is skipped). */
  memoryUnavailable?: string;
}

export interface MakeOptions {
  /** Files whose change must make `target` out of date (checks the Makefile's prerequisites). */
  expectRebuild?: string[];
  timeoutMs: number;
}

export interface MakeOutcome {
  ok: boolean;
  exit: number | null;
  /** Combined stdout+stderr of make. */
  output: string;
  timedOut?: boolean;
  /** make itself is not installed. */
  missing?: boolean;
  /** Entries of expectRebuild after whose change make still considered the target up to date. */
  notRebuilt?: string[];
}

export interface ExecBackend<A = unknown> {
  /** Shown in reports, e.g. "gcc 13.3.0" or "clang 22 (in your browser)". */
  readonly name: string;
  /**
   * True when a leakcheck build behaves like the plain build for I/O, so the runner builds once
   * with leakcheck and gathers memory issues from the I/O runs themselves (the browser). Otherwise
   * the runner makes a separate memory build and re-runs the I/O tests' inputs on it (native).
   */
  readonly combinedMemoryBuild?: boolean;
  /** One line appended to a passing memory test, e.g. what the leak checker cannot see. */
  readonly memoryNote?: string;
  /** Shown as the first hint when the memory test fails. */
  readonly memoryHint?: string;
  compile(files: Record<string, string>, sources: string[], options: CompileOptions): Promise<CompileOutcome<A>>;
  run(artifact: A, options: ExecRunOptions): Promise<ExecOutcome>;
  /** Native only: runs `make <target>` in the project directory. Without it, make tests are skipped. */
  make?(target: string, options: MakeOptions): Promise<MakeOutcome>;
}

/**
 * Maps a browser/Node WASI run (src/runtime/wasi-run.ts RunResult) plus its decoded output to an
 * ExecOutcome. 'killed' (the learner pressed Stop) is reported like a native SIGKILL.
 */
export function outcomeFromWasi(result: RunResult, stdout: string, stderr: string): ExecOutcome {
  return {
    stdout,
    stderr,
    exit: result.kind === 'exit' ? result.exitCode : null,
    trap: result.kind === 'trap' ? (result.message ?? 'trap') : null,
    signal: result.kind === 'killed' ? 'SIGKILL' : null,
    timedOut: result.kind === 'timeout',
    outputLimit: result.kind === 'output-limit',
    leakcheck: result.leakcheck,
  };
}

export type FileTree = { [name: string]: string | FileTree };

/**
 * Converts "dir/file.c" keys into nested objects. The yowasp/WASI virtual file systems need real
 * directories: a flat key containing "/" is not found by `#include "dir/file.h"`.
 */
export function toFileTree(files: Record<string, string>): FileTree {
  const root: FileTree = {};
  for (const [p, text] of Object.entries(files)) {
    const parts = p.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      const next = dir[part];
      if (typeof next === 'string') throw new Error(`${p}: ${part} is both a file and a directory`);
      dir = (dir[part] = next ?? {}) as FileTree;
    }
    dir[parts[parts.length - 1]] = text;
  }
  return root;
}
