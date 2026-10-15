// Run clang/llvm with arbitrary args, print combined output and resulting new files.
import fs from 'node:fs';
import { compile, llvm } from './lib.mjs';
const files = {};
const args = process.argv.slice(2);
for (const a of args) if (/\.(c|h)$/.test(a) && fs.existsSync('c/' + a)) files[a] = fs.readFileSync('c/' + a, 'utf8');
const r = args[0] === 'llvm' ? await llvm(args.slice(1), files) : await compile(files, args);
console.log(r.diag ?? r.out);
console.log('[ok=' + r.ok + '] files:', Object.keys(r.files || {}).filter(k => !(k in files)).join(', '));
if (process.env.SHOW) { const v = r.files[process.env.SHOW]; console.log(typeof v === 'string' ? v : new TextDecoder().decode(v)); }
