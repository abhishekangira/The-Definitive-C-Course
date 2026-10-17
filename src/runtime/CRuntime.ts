// Main-thread facade: one persistent compiler worker + one disposable run worker per execution.
import toolchain from '../generated/toolchain-version.json';
import type { CompileJob, CompilerOut, RunnerOut, RunResult, StdinMode } from './protocol';
import { SAB_DATA_OFFSET, SAB_SIZE } from './protocol';
import type { Diagnostic } from '../content-model/types';

export interface CompileResult {
  ok: boolean;
  wasm?: Uint8Array;
  diagnostics: Diagnostic[];
  raw: string;
  ms: number;
}

export interface StageResult { ok: boolean; text: string; diagnostics: Diagnostic[]; raw: string; ms: number }

export function detectStdinMode(): StdinMode {
  const W = WebAssembly as unknown as { Suspending?: unknown; promising?: unknown };
  if (typeof W.Suspending === 'function' && typeof W.promising === 'function') return 'jspi';
  if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function') return 'sab';
  return 'preset';
}

export interface RunOptions {
  mode?: StdinMode;
  presetStdin?: string;
  args?: string[];
  files?: Record<string, string>;
  cpuTimeoutMs?: number;
  maxOutput?: number;
  onOutput(fd: 1 | 2, text: string): void;
  onStdinRequest?(): void;
  onStarted?(info: { instantiateMs: number; mode: StdinMode }): void;
}

export interface RunHandle {
  done: Promise<RunResult & { wallMs: number }>;
  /** Queued if the program isn't waiting yet (type-ahead). */
  provideInput(text: string): void;
  sendEOF(): void;
  kill(): void;
}

export type ToolchainState =
  | { status: 'idle' }
  | { status: 'loading'; done: number; total: number }
  | { status: 'ready'; ms: number; fromCache: boolean }
  | { status: 'error'; kind: 'download' | 'corrupt' | 'startup'; message: string };

export class CRuntime {
  private compiler: Worker;
  private nextId = 1;
  private pending = new Map<number, (r: CompileResult) => void>();
  private pendingStage = new Map<number, (r: StageResult) => void>();
  private spare: Worker | null = null;
  private listeners = new Set<(s: ToolchainState) => void>();
  state: ToolchainState = { status: 'idle' };

  constructor() {
    this.compiler = new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module', name: 'clang' });
    const baseUrl = new URL(`toolchain/clang-${toolchain.version}/`, document.baseURI).href;
    this.compiler.postMessage({ type: 'init', baseUrl, version: toolchain.version });
    this.compiler.onmessage = (e: MessageEvent<CompilerOut>) => {
      const m = e.data;
      if (m.type === 'progress') this.setState({ status: 'loading', done: m.done, total: m.total });
      else if (m.type === 'ready') {
        this.setState({ status: 'ready', ms: m.ms, fromCache: m.networkFetches === 0 });
        navigator.storage?.persist?.().catch(() => {});
      } else if (m.type === 'load-error') this.setState({ status: 'error', kind: m.kind, message: m.message });
      else if (m.type === 'compiled') { this.pending.get(m.id)?.(m); this.pending.delete(m.id); }
      else if (m.type === 'staged') { this.pendingStage.get(m.id)?.(m); this.pendingStage.delete(m.id); }
    };
  }

  private setState(s: ToolchainState) { this.state = s; this.listeners.forEach(l => l(s)); }

  subscribe(l: (s: ToolchainState) => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  /** Start downloading/compiling the toolchain (first Run, or idle prefetch on a lesson with code). */
  prefetch() {
    if (this.state.status === 'idle' || this.state.status === 'error') this.setState({ status: 'loading', done: 0, total: toolchain.totalSize });
    this.compiler.postMessage({ type: 'prefetch' });
  }

  compile(job: CompileJob): Promise<CompileResult> {
    this.prefetch();
    const id = this.nextId++;
    return new Promise(res => { this.pending.set(id, res); this.compiler.postMessage({ type: 'compile', id, ...job }); });
  }

  /** One pipeline stage (-E preprocessed text or -S WebAssembly assembly) for the Pipeline Explorer. */
  stage(files: Record<string, string>, stage: 'E' | 'S', opt?: '-O0' | '-O1' | '-O2'): Promise<StageResult> {
    this.prefetch();
    const id = this.nextId++;
    return new Promise(res => { this.pendingStage.set(id, res); this.compiler.postMessage({ type: 'stage', id, files, stage, opt }); });
  }

  private newRunWorker() { return new Worker(new URL('./run.worker.ts', import.meta.url), { type: 'module', name: 'program' }); }

  run(wasm: Uint8Array, o: RunOptions): RunHandle {
    const mode = o.mode ?? detectStdinMode();
    const worker = this.spare ?? this.newRunWorker();
    this.spare = this.newRunWorker(); // pre-spawn the next one
    const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
    const sab = mode === 'sab' ? new SharedArrayBuffer(SAB_SIZE) : undefined;
    const ctrl = sab ? new Int32Array(sab, 0, 2) : undefined;
    const inputQueue: Array<Uint8Array | null> = []; // null = EOF
    let waiting = false;
    let finished = false;
    const enc = new TextEncoder();
    const t0 = performance.now();

    // CPU-time watchdog: paused while the program waits for input or sleeps.
    const budget = o.cpuTimeoutMs ?? 5000;
    let used = 0;
    let sliceStart = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let resolveDone!: (r: RunResult & { wallMs: number }) => void;
    const done = new Promise<RunResult & { wallMs: number }>(r => (resolveDone = r));
    const finish = (r: RunResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const fd of [1, 2] as const) { const tail = decoders[fd].decode(); if (tail) o.onOutput(fd, tail); }
      resolveDone({ ...r, wallMs: performance.now() - t0 });
    };
    const resumeClock = () => {
      if (running || finished) return;
      running = true;
      sliceStart = performance.now();
      timer = setTimeout(() => {
        worker.terminate();
        finish({ kind: 'timeout', exitCode: null, message: `CPU time limit of ${budget / 1000} s exceeded (infinite loop?)`, ms: budget });
      }, Math.max(0, budget - used));
    };
    const pauseClock = () => {
      if (!running) return;
      running = false;
      clearTimeout(timer);
      used += performance.now() - sliceStart;
    };

    const deliver = () => {
      if (!waiting || !inputQueue.length) return;
      const item = inputQueue.shift()!;
      waiting = false;
      if (mode === 'sab') {
        if (item === null) Atomics.store(ctrl!, 0, 2);
        else {
          const max = SAB_SIZE - SAB_DATA_OFFSET;
          const part = item.subarray(0, max);
          if (item.length > max) inputQueue.unshift(item.subarray(max));
          new Uint8Array(sab!, SAB_DATA_OFFSET).set(part);
          Atomics.store(ctrl!, 1, part.length);
          Atomics.store(ctrl!, 0, 1);
        }
        Atomics.notify(ctrl!, 0);
      } else worker.postMessage({ type: 'stdin', data: item });
      resumeClock();
    };

    worker.onmessage = (e: MessageEvent<RunnerOut>) => {
      const m = e.data;
      if (m.type === 'output') for (const [fd, bytes] of m.chunks) o.onOutput(fd, decoders[fd].decode(bytes, { stream: true }));
      else if (m.type === 'started') o.onStarted?.(m);
      else if (m.type === 'stdin-request') { pauseClock(); waiting = true; o.onStdinRequest?.(); deliver(); }
      else if (m.type === 'sleep') { if (m.on) pauseClock(); else resumeClock(); }
      else if (m.type === 'exit') { worker.terminate(); finish(m.result); }
    };
    worker.onerror = e => { worker.terminate(); finish({ kind: 'trap', exitCode: null, message: e.message || 'worker error', ms: 0 }); };

    const copy = wasm.slice(); // keep the caller's copy; transfer ours
    worker.postMessage(
      { type: 'run', wasm: copy, args: o.args ?? ['main'], files: o.files ?? {}, stdinMode: mode, presetStdin: o.presetStdin, sab, maxOutput: o.maxOutput ?? 1 << 20 },
      [copy.buffer],
    );
    resumeClock();

    return {
      done,
      provideInput: text => { inputQueue.push(enc.encode(text)); deliver(); },
      sendEOF: () => { inputQueue.push(null); deliver(); },
      kill: () => { worker.terminate(); finish({ kind: 'killed', exitCode: null, message: 'Stopped.', ms: 0 }); },
    };
  }
}

let shared: CRuntime | null = null;
/** One runtime per page; created lazily on first use. */
export function getRuntime(): CRuntime {
  return (shared ??= new CRuntime());
}
