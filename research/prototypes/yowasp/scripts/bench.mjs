import fs from 'node:fs';
import { runClang, runLLVM, Exit } from '@yowasp/clang';
const mem = () => `rss=${(process.memoryUsage().rss/1048576).toFixed(0)}MiB ab=${(process.memoryUsage().arrayBuffers/1048576).toFixed(0)}MiB`;
const quiet = { stdout: null, stderr: null, fetchProgress: () => {} };
console.log('start', mem());
let t = performance.now();
await runClang(null, {}, quiet);
console.log(`prefetch (read files, WebAssembly.compile 75MB, untar 29MB): ${(performance.now()-t).toFixed(0)}ms`, mem());
const progs = {
  hello: fs.readFileSync('c/hello.c', 'utf8'),
  printf: fs.readFileSync('c/printf_formats.c', 'utf8'),
  malloc: fs.readFileSync('c/malloc.c', 'utf8'),
  sizeof: fs.readFileSync('c/sizeof.c', 'utf8'),
};
const base = ['-std=c17', '-Wall', '-Wextra', '-pedantic'];
async function time(label, args, files, n = 5) {
  const ts = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); try { await runClang(args, files, quiet); } catch (e) { if (!(e instanceof Exit)) throw e; } ts.push(performance.now() - a); }
  console.log(label.padEnd(40), ts.map(x => x.toFixed(0)).join(' '), 'ms  median', ts.sort((a,b)=>a-b)[n>>1].toFixed(0), mem());
}
await time('hello first+4 (-O0 compile+link)', ['clang', ...base, '-O0', 'p.c', '-o', 'p.wasm'], { 'p.c': progs.hello });
for (const [k, v] of Object.entries(progs)) for (const O of ['-O0', '-O1', '-O2']) await time(`${k} ${O} compile+link`, ['clang', ...base, O, 'p.c', '-o', 'p.wasm'], { 'p.c': v });
await time('hello -fsyntax-only', ['clang', ...base, '-fsyntax-only', 'p.c'], { 'p.c': progs.hello });
await time('hello -c only', ['clang', ...base, '-O0', '-c', 'p.c', '-o', 'p.o'], { 'p.c': progs.hello });
await time('clang -### only (driver)', ['clang', '-###', ...base, 'p.c', '-o', 'p.wasm'], { 'p.c': progs.hello });
await time('runLLVM nm --version (bare instantiate)', ['nm', '--version'], {}, 5);
// sync API timing
t = performance.now();
for (let i = 0; i < 5; i++) runClang(['clang', ...base, '-O0', 'p.c', '-o', 'p.wasm'], { 'p.c': progs.hello }, { ...quiet, synchronously: true });
console.log('sync API x5 avg', ((performance.now()-t)/5).toFixed(0), 'ms');
console.log('end', mem());
