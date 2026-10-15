// Main-thread facade: one persistent compiler worker + one disposable run worker per execution.
import type { CompilerOut, RunnerOut, RunResult, StdinMode } from './protocol';
import { SAB_DATA_OFFSET, SAB_SIZE } from './protocol';

export type CompileResult = { ok: boolean; exitCode: number; wasm?: Uint8Array; diagnostics: string; ms: number };
export type Diagnostic = { file: string; line: number; col: number; severity: string; message: string };

export function parseDiagnostics(text: string): Diagnostic[] {
  const re = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/gm;
  return [...text.matchAll(re)].map(m => ({ file: m[1], line: +m[2], col: +m[3], severity: m[4], message: m[5] }));
}

export function detectStdinMode(): StdinMode {
  if (typeof (WebAssembly as any).Suspending === 'function' && typeof (WebAssembly as any).promising === 'function') return 'jspi';
  if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function') return 'sab';
  return 'preset';
}

export type RunHandle = {
  done: Promise<RunResult & { wallMs: number }>;
  provideInput(text: string): void;   // queued if the program isn't waiting yet (type-ahead)
  sendEOF(): void;
  kill(): void;
};

export class CRuntime {
  private compiler: Worker;
  private nextId = 1;
  private pending = new Map<number, (r: CompileResult) => void>();
  private spare: Worker | null = null;
  onProgress: (done: number, total: number) => void = () => {};
  onReady: (info: { ms: number; cacheHits: number; networkFetches: number }) => void = () => {};

  constructor() {
    this.compiler = new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module', name: 'clang' });
    this.compiler.onmessage = (e: MessageEvent<CompilerOut>) => {
      const m = e.data;
      if (m.type === 'progress') this.onProgress(m.done, m.total);
      else if (m.type === 'ready') this.onReady(m);
      else if (m.type === 'compiled') { this.pending.get(m.id)?.(m); this.pending.delete(m.id); }
    };
    this.spare = this.newRunWorker();
  }

  /** Start downloading/compiling the toolchain (e.g. on first Run click, or on idle when a lesson has code). */
  prefetch() { this.compiler.postMessage({ type: 'prefetch' }); }

  compile(source: string, extraFlags: string[] = []): Promise<CompileResult> {
    const id = this.nextId++;
    return new Promise(res => { this.pending.set(id, res); this.compiler.postMessage({ type: 'compile', id, source, extraFlags }); });
  }

  private newRunWorker() { return new Worker(new URL('./run.worker.ts', import.meta.url), { type: 'module', name: 'program' }); }

  run(wasm: Uint8Array, o: {
    mode?: StdinMode; presetStdin?: string; args?: string[]; files?: Record<string, string>;
    cpuTimeoutMs?: number; maxOutput?: number;
    onOutput(fd: 1 | 2, text: string): void; onStdinRequest?(): void; onStarted?(info: { instantiateMs: number; mode: StdinMode }): void;
  }): RunHandle {
    const mode = o.mode ?? detectStdinMode();
    const worker = this.spare ?? this.newRunWorker();
    this.spare = this.newRunWorker();                         // pre-spawn the next one (~tens of ms saved)
    const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
    const sab = mode === 'sab' ? new SharedArrayBuffer(SAB_SIZE) : undefined;
    const ctrl = sab ? new Int32Array(sab, 0, 2) : undefined;
    const inputQueue: Array<Uint8Array | null> = [];          // null = EOF
    let waiting = false, finished = false;
    const enc = new TextEncoder();
    const t0 = performance.now();

    // CPU-time watchdog: paused while the program is blocked waiting for the user to type.
    const budget = o.cpuTimeoutMs ?? 5000;
    let used = 0, sliceStart = 0, timer: ReturnType<typeof setTimeout> | undefined;
    let resolveDone!: (r: RunResult & { wallMs: number }) => void;
    const done = new Promise<RunResult & { wallMs: number }>(r => (resolveDone = r));
    const finish = (r: RunResult) => {
      if (finished) return; finished = true; clearTimeout(timer);
      for (const fd of [1, 2] as const) { const tail = decoders[fd].decode(); if (tail) o.onOutput(fd, tail); }
      resolveDone({ ...r, wallMs: performance.now() - t0 });
    };
    const resumeClock = () => { sliceStart = performance.now(); timer = setTimeout(() => { worker.terminate(); finish({ kind: 'timeout', exitCode: null, message: `CPU time limit of ${budget} ms exceeded (infinite loop?)`, ms: budget }); }, budget - used); };
    const pauseClock = () => { clearTimeout(timer); used += performance.now() - sliceStart; };

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
      else if (m.type === 'started') { o.onStarted?.(m); }
      else if (m.type === 'stdin-request') { pauseClock(); waiting = true; o.onStdinRequest?.(); deliver(); }
      else if (m.type === 'exit') { worker.terminate(); finish(m.result); }
    };
    worker.onerror = (e) => { worker.terminate(); finish({ kind: 'trap', exitCode: null, message: e.message || 'worker error', ms: 0 }); };

    const copy = wasm.slice();   // keep caller's copy; transfer ours
    worker.postMessage({ type: 'run', wasm: copy, args: o.args ?? ['main'], files: o.files ?? {}, stdinMode: mode, presetStdin: o.presetStdin, sab, maxOutput: o.maxOutput ?? 1 << 20 }, [copy.buffer]);
    resumeClock();

    return {
      done,
      provideInput: (text) => { inputQueue.push(enc.encode(text)); deliver(); },
      sendEOF: () => { inputQueue.push(null); deliver(); },
      kill: () => { worker.terminate(); finish({ kind: 'killed', exitCode: null, message: 'stopped by user', ms: 0 }); },
    };
  }
}
