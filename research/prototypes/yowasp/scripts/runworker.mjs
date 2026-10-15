// Runs a wasm binary inside a worker thread; main thread kills it after a timeout.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import { compile } from './lib.mjs';
const src = fs.readFileSync(process.argv[2], 'utf8');
const c = await compile({ 'p.c': src }, ['-std=c17', '-O0', 'p.c', '-o', 'p.wasm']);
const workerSrc = `
import { parentPort, workerData } from 'node:worker_threads';
import { WASI, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';
const fds = [new OpenFile(new File([])), new ConsoleStdout(b => parentPort.postMessage({ out: Buffer.from(b).toString() })), new ConsoleStdout(b => parentPort.postMessage({ err: Buffer.from(b).toString() }))];
const wasi = new WASI(['p'], [], fds, { debug: false });
const inst = await WebAssembly.instantiate(await WebAssembly.compile(workerData), { wasi_snapshot_preview1: wasi.wasiImport });
let code; try { code = wasi.start(inst); } catch (e) { parentPort.postMessage({ trap: String(e) }); }
parentPort.postMessage({ exit: code });
`;
fs.writeFileSync(new URL('./_w.mjs', import.meta.url), workerSrc);
const t0 = performance.now();
const w = new Worker(new URL('./_w.mjs', import.meta.url), { workerData: c.files['p.wasm'] });
w.on('message', m => console.log('msg', JSON.stringify(m), `${(performance.now()-t0).toFixed(0)}ms`));
const timer = setTimeout(async () => { await w.terminate(); console.log(`TIMEOUT: terminated worker after ${(performance.now()-t0).toFixed(0)}ms`); }, 2000);
w.on('exit', () => clearTimeout(timer));
