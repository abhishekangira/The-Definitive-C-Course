
import { parentPort, workerData } from 'node:worker_threads';
import { WASI, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';
const fds = [new OpenFile(new File([])), new ConsoleStdout(b => parentPort.postMessage({ out: Buffer.from(b).toString() })), new ConsoleStdout(b => parentPort.postMessage({ err: Buffer.from(b).toString() }))];
const wasi = new WASI(['p'], [], fds, { debug: false });
const inst = await WebAssembly.instantiate(await WebAssembly.compile(workerData), { wasi_snapshot_preview1: wasi.wasiImport });
let code; try { code = wasi.start(inst); } catch (e) { parentPort.postMessage({ trap: String(e) }); }
parentPort.postMessage({ exit: code });
