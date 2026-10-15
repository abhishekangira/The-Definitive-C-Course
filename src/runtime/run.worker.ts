/// <reference lib="webworker" />
// One short-lived worker per program run. terminate() kills runaway programs without touching the compiler.
import { runWasi } from './wasi-run';
import type { RunnerIn, RunnerOut, RunRequest } from './protocol';
import { SAB_DATA_OFFSET } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: RunnerOut, t: Transferable[] = []) => self.postMessage(m, t);

// Batch output: the worker's event loop is blocked while C code runs, so flush on size/time inside fd_write.
let queue: Array<[1 | 2, Uint8Array]> = [];
let queued = 0;
let lastFlush = performance.now();
function flush() {
  if (!queue.length) return;
  const chunks = queue;
  queue = []; queued = 0; lastFlush = performance.now();
  post({ type: 'output', chunks }, chunks.map(c => c[1].buffer as ArrayBuffer));
}
const sink = (fd: 1 | 2) => (b: Uint8Array) => {
  const last = queue[queue.length - 1];
  if (last && last[0] === fd && last[1].length < 4096) {
    const m = new Uint8Array(last[1].length + b.length);
    m.set(last[1]); m.set(b, last[1].length);
    last[1] = m;
  } else queue.push([fd, b.slice()]);
  queued += b.length;
  if (queued > 16384 || performance.now() - lastFlush > 33) flush();
};

let jspiResolve: ((d: Uint8Array | null) => void) | null = null;

self.onmessage = async (e: MessageEvent<RunnerIn>) => {
  const msg = e.data;
  if (msg.type === 'stdin') { jspiResolve?.(msg.data); jspiResolve = null; return; }
  const req = msg as RunRequest;
  let stdinSync: ((max: number) => Uint8Array | null) | undefined;
  let stdinAsync: ((max: number) => Promise<Uint8Array | null>) | undefined;
  if (req.stdinMode === 'sab') {
    const ctrl = new Int32Array(req.sab!, 0, 2);
    const data = new Uint8Array(req.sab!, SAB_DATA_OFFSET);
    stdinSync = () => {
      flush();
      Atomics.store(ctrl, 0, 0);
      post({ type: 'stdin-request' });
      Atomics.wait(ctrl, 0, 0); // blocks this worker until the main thread notifies
      if (Atomics.load(ctrl, 0) === 2) return null; // EOF
      return data.slice(0, Atomics.load(ctrl, 1));
    };
  } else if (req.stdinMode === 'jspi') {
    stdinAsync = () => new Promise(res => { flush(); jspiResolve = res; post({ type: 'stdin-request' }); });
  } else {
    let preset: Uint8Array | null = new TextEncoder().encode(req.presetStdin ?? '');
    stdinSync = () => { const p = preset; preset = null; return p; };
  }
  const result = await runWasi({
    bytes: req.wasm, args: req.args, files: req.files, maxOutput: req.maxOutput,
    stdout: sink(1), stderr: sink(2), stdinSync, stdinAsync,
    beforeStdinRead: flush,
    onSleep: on => { flush(); post({ type: 'sleep', on }); },
    onInstantiated: ms => post({ type: 'started', instantiateMs: ms, mode: req.stdinMode }),
  });
  flush();
  post({ type: 'exit', result });
};
