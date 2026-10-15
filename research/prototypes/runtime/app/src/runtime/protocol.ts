// Messages between the main thread and the two workers.
export type StdinMode = 'jspi' | 'sab' | 'preset';

export type CompileRequest = { type: 'compile'; id: number; source: string; extraFlags?: string[] };
export type PrefetchRequest = { type: 'prefetch' };
export type CompilerOut =
  | { type: 'progress'; done: number; total: number }
  | { type: 'ready'; ms: number; cacheHits: number; networkFetches: number }
  | { type: 'compiled'; id: number; ok: boolean; exitCode: number; wasm?: Uint8Array; diagnostics: string; ms: number };

export type RunRequest = {
  type: 'run';
  wasm: Uint8Array;
  args: string[];
  files: Record<string, string>;
  stdinMode: StdinMode;
  presetStdin?: string;
  sab?: SharedArrayBuffer;      // stdinMode === 'sab': Int32[0]=state(0 wait,1 data,2 EOF) Int32[1]=len, bytes from offset 8
  maxOutput: number;
};
export type RunnerIn = RunRequest | { type: 'stdin'; data: Uint8Array | null }; // 'stdin' only used by JSPI mode
export type RunResult = {
  kind: 'exit' | 'trap' | 'output-limit' | 'timeout' | 'killed';
  exitCode: number | null;
  message?: string;
  hint?: string;
  ms: number;
  files?: Record<string, unknown>;
};
export type RunnerOut =
  | { type: 'started'; instantiateMs: number; mode: StdinMode }
  | { type: 'output'; chunks: Array<[1 | 2, Uint8Array]> }
  | { type: 'stdin-request' }
  | { type: 'exit'; result: RunResult };

export const SAB_DATA_OFFSET = 8;
export const SAB_SIZE = 8 + 64 * 1024;
