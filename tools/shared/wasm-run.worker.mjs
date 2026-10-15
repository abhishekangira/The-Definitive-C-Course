// Worker bootstrap for wasm-run-isolated.ts: worker threads do not inherit tsx's loader hooks
// reliably, so register tsx here and then load the TypeScript implementation.
import { register } from 'tsx/esm/api';
import { workerData } from 'node:worker_threads';

register();
await import(workerData.entry);
