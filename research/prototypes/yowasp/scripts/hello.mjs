import { runClang, runLLVM, Exit, version } from '@yowasp/clang';
import { WASI } from 'node:wasi';
const t0 = performance.now();
await runClang(); // prefetch
const t1 = performance.now();
console.error('prefetch(compile modules+untar)', (t1-t0).toFixed(0), 'ms');
let err = '';
const dec = new TextDecoder();
const opts = { stderr: b => { if (b) err += dec.decode(b); }, stdout: b => { if (b) err += dec.decode(b); } };
const src = '#include <stdio.h>\nint main(void){ printf("hello, world\\n"); return 0; }\n';
const t2 = performance.now();
const out = await runClang(['clang', '-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0', 'hello.c', '-o', 'hello.wasm'], { 'hello.c': src }, opts);
const t3 = performance.now();
console.error('first compile+link', (t3-t2).toFixed(0), 'ms', 'diag:', JSON.stringify(err));
console.error('output files', Object.keys(out), out['hello.wasm'].length, 'bytes');
for (let i = 0; i < 3; i++) {
  const a = performance.now();
  await runClang(['clang', '-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0', 'hello.c', '-o', 'hello.wasm'], { 'hello.c': src }, opts);
  console.error('warm compile+link', (performance.now()-a).toFixed(0), 'ms');
}
const wasi = new WASI({ version: 'preview1', args: ['hello'], env: {}, returnOnExit: true });
const mod = await WebAssembly.compile(out['hello.wasm']);
const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.wasiImport });
const code = wasi.start(inst);
console.error('exit code', code);
console.error('rss MB', (process.memoryUsage().rss/1e6).toFixed(0));
