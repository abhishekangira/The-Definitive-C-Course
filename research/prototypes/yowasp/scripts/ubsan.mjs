import fs from 'node:fs';
import { compile, runShim } from './lib.mjs';
const files = { 'ub2.c': fs.readFileSync('c/ub2.c', 'utf8'), 'ubsan_rt.c': fs.readFileSync('c/ubsan_rt.c', 'utf8') };
// compile runtime without sanitizer, then the user code with it, and link
let r = await compile(files, ['-O1', '-c', 'ubsan_rt.c', '-o', 'ubsan_rt.o']); if (!r.ok) { console.log(r.diag); process.exit(1); }
r = await compile(r.files, ['-std=c17', '-O0', '-g', '-fsanitize=undefined', '-fno-sanitize=function', 'ub2.c', 'ubsan_rt.o', '-o', 'a.wasm']);
console.log(r.diag); if (!r.ok) process.exit(1);
const out = await runShim(r.files['a.wasm']);
console.log('stdout:\n' + out.stdout + 'stderr:\n' + out.stderr + `exit=${out.exitCode} trap=${out.trap}`);
