import fs from 'node:fs'; import crypto from 'node:crypto'; import { compile } from './lib.mjs';
const c = await compile({ 'p.c': fs.readFileSync('c/printf_formats.c', 'utf8') }, ['-std=c17', '-O1', '-g', '-lc-printscan-long-double', 'p.c', '-o', 'a.wasm']);
console.log(crypto.createHash('sha256').update(c.files['a.wasm']).digest('hex').slice(0, 16), c.files['a.wasm'].length);
