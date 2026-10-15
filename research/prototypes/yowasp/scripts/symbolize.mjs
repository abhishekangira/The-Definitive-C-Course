import fs from 'node:fs';
import { compile, llvm } from './lib.mjs';
import { WASI, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';
const c = await compile({ 'crash.c': fs.readFileSync('c/crash.c', 'utf8') }, ['-std=c17', '-O0', '-g', 'crash.c', '-o', 'a.wasm']);
const wasm = c.files['a.wasm'];
const wasi = new WASI(['a'], [], [new OpenFile(new File([])), new ConsoleStdout(b => process.stdout.write(b)), new ConsoleStdout(b => process.stderr.write(b))], { debug: false });
const inst = await WebAssembly.instantiate(await WebAssembly.compile(wasm), { wasi_snapshot_preview1: wasi.wasiImport });
try { wasi.start(inst); } catch (e) {
  console.log('TRAP:', e.message); console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  // V8 frames look like: at divide (wasm://wasm/<hash>:wasm-function[N]:0xOFFSET)
  const offs = [...e.stack.matchAll(/wasm-function\[\d+\]:(0x[0-9a-f]+)/g)].map(m => m[1]);
  // llvm-symbolizer on wasm takes module-relative offsets? try both raw and code-section relative
  const r = await llvm(['symbolizer', '--obj=a.wasm', '--relative-address', ...offs], { 'a.wasm': wasm });
  console.log('symbolizer(raw offsets):\n' + r.out);
  const sizeR = await llvm(['objdump', '-h', 'a.wasm'], { 'a.wasm': wasm });
  console.log(sizeR.out);
}
const variants = { 'abs': o => o, 'minus code VMA 0x1d2': o => o - 0x1d2, 'minus 0x1d2+3': o => o - 0x1d5 };
const offs2 = [0x2b5, 0x277];
for (const [k, f] of Object.entries(variants)) {
  const r = await llvm(['symbolizer', '--obj=a.wasm', ...offs2.map(o => '0x' + f(o).toString(16))], { 'a.wasm': wasm });
  console.log(k, '=>', r.out.replace(/\n+/g, ' | '));
}
const dd = await llvm(['dwarfdump', '--debug-line', 'a.wasm'], { 'a.wasm': wasm });
console.log(dd.out.split('\n').filter(l => /^0x/.test(l)).slice(0, 12).join('\n'));
