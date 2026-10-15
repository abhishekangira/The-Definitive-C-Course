import { WASI } from 'node:wasi'; import { readFileSync } from 'node:fs';
const wasi = new WASI({ version: 'preview1', args: ['prog'], returnOnExit: true });
const inst = await WebAssembly.instantiate(await WebAssembly.compile(readFileSync(process.argv[2])), { wasi_snapshot_preview1: wasi.wasiImport });
let code; try { code = wasi.start(inst); } catch (e) { console.error('TRAP:', e.message); code = 'trap'; }
console.error('[exit', code + ']');
