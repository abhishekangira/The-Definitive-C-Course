import fs from 'node:fs'; import { compile } from './lib.mjs';
const src = fs.readFileSync('c/big.c', 'utf8');
for (const O of ['-O0', '-O0', '-O0', '-O1', '-O2', '-O2', '-O2']) { const c = await compile({ 'b.c': src }, ['-std=c17', O, 'b.c', '-o', 'b.wasm']); console.log(O, c.ok, c.ms.toFixed(0) + 'ms'); }
