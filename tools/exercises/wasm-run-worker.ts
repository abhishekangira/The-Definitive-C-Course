// Runs one wasm32-wasip1 program in a worker thread, so the parent can kill it on timeout
// (WebAssembly cannot be interrupted on the thread that runs it). Bundled with esbuild at first use
// by wasm-backend.ts: tsx loaders do not reach worker threads.
import { parentPort, workerData } from 'node:worker_threads';
import { runWasi } from '../../src/runtime/wasi-run';

interface Job { wasm: Uint8Array; stdin: string; args: string[]; maxOutput: number }

const job = workerData as Job;
const out: Uint8Array[] = [];
const err: Uint8Array[] = [];
let preset: Uint8Array | null = new TextEncoder().encode(job.stdin);

const concat = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
};

const result = await runWasi({
  bytes: job.wasm,
  args: ['main', ...job.args],
  maxOutput: job.maxOutput,
  stdout: b => { out.push(b.slice()); },
  stderr: b => { err.push(b.slice()); },
  stdinSync: () => { const p = preset; preset = null; return p; },
});
delete result.files;
parentPort!.postMessage({ result, stdout: concat(out), stderr: concat(err) });
