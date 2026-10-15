// Verifier-local extensions of the shared content model (src/content-model/types.ts).
// Extra fields are optional, so generated JSON stays assignable to the shared types.
import type { RunOutcome, SampleResult, TargetId, TargetResult } from '../../src/content-model/types';
import type { SanitizerSummary } from './sanitizer';
import type { PointerMode } from './normalise';

export interface VerifiedTargetResult extends TargetResult {
  /**
   * `stdout=both` only: the same program with stdout on a plain pipe (fully buffered), for lessons
   * about buffering. `run` is always the tty run (what the browser does).
   */
  runPipe?: RunOutcome;
  /** Native ASan+UBSan run, condensed; `file` is the sample file the report points into. */
  sanitizer?: SanitizerSummary;
}

/** What one sample's compile+run work produced; cached in .cache/verify/. */
export interface SampleRuns {
  results: Partial<Record<TargetId, VerifiedTargetResult>>;
  pointerMode: PointerMode;
  /** Non-fatal remarks from running (missing sanitizer runtime, compiler fallback, …). */
  notes: string[];
  /** Hard failures while running (e.g. pty_run crashed); reported as problems. */
  errors: string[];
}

export interface VerifiedSample extends SampleResult {
  results: Partial<Record<TargetId, VerifiedTargetResult>>;
}

/** src/generated/targets/<target>/<module>.json, written by `verify --target-run`. */
export interface TargetsFile {
  module: string;
  target: TargetId;
  generatedBy: string;
  /** Per sample: the sample hash at the time of the run (stale when the code changed) and the result. */
  samples: Record<string, { hash: string; result: VerifiedTargetResult }>;
}

export const NATIVE_TARGETS: TargetId[] = ['linux-x86_64-gcc13', 'linux-x86_64-clang22'];
export const WASM_TARGET: TargetId = 'wasm32-clang22';
export const STORED_TARGETS: TargetId[] = ['macos-arm64-appleclang', 'linux-aarch64-gcc', 'windows-x64-msvc'];

export const TARGET_LABEL: Record<TargetId, string> = {
  'wasm32-clang22': 'browser (wasm32)',
  'linux-x86_64-gcc13': 'gcc 13 (x86-64 Linux)',
  'linux-x86_64-clang22': 'clang 22 (x86-64 Linux)',
  'macos-arm64-appleclang': 'Apple clang (macOS arm64)',
  'linux-aarch64-gcc': 'gcc (aarch64 Linux)',
  'windows-x64-msvc': 'MSVC (Windows x64)',
};
