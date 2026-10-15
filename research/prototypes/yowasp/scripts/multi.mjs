import fs from 'node:fs';
import { compile, runShim } from './lib.mjs';
const rd = p => fs.readFileSync('c/multi/' + p, 'utf8');
const tree = {
  'main.c': rd('main.c'), 'vec.h': rd('vec.h'), 'vec.c': rd('vec.c'),
  util: { 'strutil.h': rd('util/strutil.h'), 'strutil.c': rd('util/strutil.c') },
};
const flags = ['-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0'];
// A) one driver invocation: compile all + link
let r = await compile(tree, [...flags, 'main.c', 'vec.c', 'util/strutil.c', '-o', 'prog.wasm']);
console.log('A) one-shot:', r.ok, r.ms.toFixed(0) + 'ms', r.diag);
console.log((await runShim(r.files['prog.wasm'])).stdout);
// B) separate compilation (like make): -c each, then link .o files; outputs persist in the returned tree
let files = tree;
for (const src of ['main.c', 'vec.c', 'util/strutil.c']) {
  r = await compile(files, [...flags, '-c', src, '-o', src.replace(/\.c$/, '.o')]);
  if (!r.ok) { console.log(r.diag); process.exit(1); }
  files = r.files;
}
console.log('B) objects in tree:', Object.keys(files), Object.keys(files.util));
r = await compile(files, ['main.o', 'vec.o', 'util/strutil.o', '-o', 'prog.wasm']);
console.log('B) link:', r.ok, r.ms.toFixed(0) + 'ms');
console.log((await runShim(r.files['prog.wasm'])).stdout);
// C) static library with llvm-ar
import { llvm } from './lib.mjs';
const ar = await llvm(['ar', 'rcs', 'libvec.a', 'vec.o', 'util/strutil.o'], files);
console.log('C) ar ok:', ar.ok, ar.out);
r = await compile(ar.files, ['main.o', '-L.', '-lvec', '-o', 'prog2.wasm']);
console.log('C) link with -lvec:', r.ok, r.diag);
console.log((await runShim(r.files['prog2.wasm'])).stdout);
// D) error in second file reports correct path
const bad = structuredClone(tree); bad.util['strutil.c'] = bad.util['strutil.c'].replace('toupper', 'to_upper');
r = await compile(bad, [...flags, 'main.c', 'vec.c', 'util/strutil.c', '-o', 'prog.wasm']);
console.log('D)', r.ok, '\n' + r.diag);
