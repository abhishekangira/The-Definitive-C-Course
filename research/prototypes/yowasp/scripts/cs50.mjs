import fs from 'node:fs';
import { compile, runShim } from './lib.mjs';
const files = { 'cs50.c': fs.readFileSync('cs50dl/cs50.c', 'utf8'), include: { 'cs50.h': fs.readFileSync('cs50dl/cs50.h', 'utf8') }, 'hello.c': fs.readFileSync('c/cs50test.c', 'utf8') };
let r = await compile(files, ['-std=c17', '-O1', '-Iinclude', '-c', 'cs50.c', '-o', 'cs50.o']); console.log('libcs50 compile', r.ok, r.diag);
r = await compile(r.files, ['-std=c17', '-Wall', '-Wextra', '-O0', '-Iinclude', 'hello.c', 'cs50.o', '-o', 'hello.wasm']); console.log('link', r.ok, r.diag);
const out = await runShim(r.files['hello.wasm'], { stdin: 'David\nabc\n42\n' });
console.log(JSON.stringify(out.stdout), out.exitCode, out.trap);
