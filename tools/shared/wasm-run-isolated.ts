// Runs wasm programs (the in-browser toolchain's output) in a Node worker thread, so a runaway
// program can be stopped by a wall-clock timeout. runWasm() in wasm-node.ts is synchronous while
// the program executes (Node has no JSPI by default), so calling it on the main thread would hang
// the verifier on an infinite loop. One worker is reused for every run and replaced after a timeout.
import { Worker } from 'node:worker_threads';
import type { WasmRun } from './wasm-node';

export interface IsolatedRunOptions {
  stdin?: string;
  args?: string[];
  files?: Record<string, string>;
  maxOutput?: number;
  timeoutMs: number;
}

export type IsolatedRunResult = WasmRun;

type Pending = { resolve: (r: IsolatedRunResult) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout };

export class WasmRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private spawn(): Worker {
    const w = new Worker(new URL('./wasm-run.worker.mjs', import.meta.url), {
      workerData: { entry: new URL('./wasm-run.worker-impl.ts', import.meta.url).href },
    });
    w.on('message', (m: { id: number; result?: IsolatedRunResult; error?: string }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.result!);
    });
    w.on('error', err => this.failAll(err));
    w.on('exit', () => { if (this.worker === w) this.worker = null; });
    w.unref();
    return w;
  }

  private failAll(err: unknown): void {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(err); this.pending.delete(id); }
    this.worker = null;
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** Runs are queued: one program at a time, and its timeout starts when it actually starts. */
  run(wasm: Uint8Array, o: IsolatedRunOptions): Promise<IsolatedRunResult> {
    const next = this.queue.then(() => this.runNow(wasm, o));
    this.queue = next.catch(() => {});
    return next;
  }

  private runNow(wasm: Uint8Array, o: IsolatedRunOptions): Promise<IsolatedRunResult> {
    const worker = (this.worker ??= this.spawn());
    const id = ++this.seq;
    return new Promise<IsolatedRunResult>((resolve, reject) => {
      const t0 = performance.now();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // The worker is stuck inside the program: kill it; the next run spawns a fresh one.
        if (this.worker === worker) this.worker = null;
        void worker.terminate();
        resolve({ kind: 'timeout', exitCode: null, message: `timed out after ${o.timeoutMs} ms`, ms: performance.now() - t0, stdout: '', stderr: '' });
      }, o.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, wasm, opts: { stdin: o.stdin, args: o.args, files: o.files, maxOutput: o.maxOutput } });
    });
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
