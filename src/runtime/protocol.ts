// Messages between the main thread and the two workers.
import type { Diagnostic } from '../content-model/types';

export type StdinMode = 'jspi' | 'sab' | 'preset';

export interface CompileJob {
  files: Record<string, string>;
  sources: string[];
  guardrail?: boolean;
  leakcheck?: boolean;
  extraFlags?: string[];
}

export type CompilerIn =
  | { type: 'init'; baseUrl: string; version: string }
  | { type: 'prefetch' }
  | ({ type: 'compile'; id: number } & CompileJob);

export type CompilerOut =
  | { type: 'progress'; done: number; total: number }
  | { type: 'ready'; ms: number; cacheHits: number; networkFetches: number }
  | { type: 'load-error'; message: string }
  | { type: 'compiled'; id: number; ok: boolean; wasm?: Uint8Array; diagnostics: Diagnostic[]; raw: string; ms: number };

export interface RunRequest {
  type: 'run';
  wasm: Uint8Array;
  args: string[];
  files: Record<string, string>;
  stdinMode: StdinMode;
  presetStdin?: string;
  sab?: SharedArrayBuffer; // stdinMode 'sab': Int32[0]=state (0 wait, 1 data, 2 EOF), Int32[1]=len, bytes from offset 8
  maxOutput: number;
}

export type RunnerIn = RunRequest | { type: 'stdin'; data: Uint8Array | null };

export interface LeakEvent {
  type: 'leak' | 'overflow' | 'invalid-free' | 'invalid-realloc';
  bytes: number;
  file: string;
  line: number;
  seq?: number;
}

export interface RunResult {
  kind: 'exit' | 'trap' | 'output-limit' | 'timeout' | 'killed';
  exitCode: number | null;
  message?: string;
  /** Plain-English explanation of a trap, with the native equivalent. */
  hint?: string;
  ms: number;
  files?: Record<string, unknown>;
  leakcheck?: LeakEvent[];
}

export type RunnerOut =
  | { type: 'started'; instantiateMs: number; mode: StdinMode }
  | { type: 'output'; chunks: Array<[1 | 2, Uint8Array]> }
  | { type: 'stdin-request' }
  | { type: 'sleep'; on: boolean }
  | { type: 'exit'; result: RunResult };

export const SAB_DATA_OFFSET = 8;
export const SAB_SIZE = 8 + 64 * 1024;
