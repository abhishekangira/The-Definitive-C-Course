// Worker side of wasm-run-isolated.ts: runs one program at a time with runWasm (wasm-node.ts).
// A timeout is enforced by the parent terminating this worker.
import { parentPort } from 'node:worker_threads';
import { runWasm } from './wasm-node';

interface Job {
  id: number;
  wasm: Uint8Array;
  opts: { stdin?: string; args?: string[]; files?: Record<string, string>; maxOutput?: number };
}

parentPort!.on('message', async (job: Job) => {
  try {
    const result = await runWasm(job.wasm, job.opts);
    delete result.files; // not needed by the verifier; keeps the message small
    parentPort!.postMessage({ id: job.id, result });
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
});
