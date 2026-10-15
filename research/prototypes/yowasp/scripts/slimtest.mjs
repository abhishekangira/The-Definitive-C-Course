import fs from 'node:fs';
const mod = await import(process.argv[2]);
const { runClang, Exit } = mod;
const q = { stdout: null, stderr: null, fetchProgress: () => {} };
let t = performance.now(); await runClang(null, {}, q); console.log('prefetch', (performance.now() - t).toFixed(0), 'ms', 'rss', (process.memoryUsage().rss / 1048576) | 0, 'MiB');
const progs = ['hello.c', 'printf_formats.c', 'math.c', 'sizeof.c', 'stdin.c', 'malloc.c', 'timeclock.c', 'qsort.c'];
const ts = [];
for (const p of progs) {
  let diag = ''; const sink = b => { if (b) diag += new TextDecoder().decode(b); };
  t = performance.now();
  try { await runClang(['clang', '-std=c17', '-Wall', '-O0', '-lm', '-lc-printscan-long-double', p, '-o', 'a.wasm'], { [p]: fs.readFileSync('c/' + p, 'utf8') }, { ...q, stdout: sink, stderr: sink }); ts.push(performance.now() - t); }
  catch (e) { console.log(p, 'FAILED', diag); }
}
console.log('compiles ms', ts.map(x => x.toFixed(0)).join(' '), 'rss', (process.memoryUsage().rss / 1048576) | 0, 'MiB');
