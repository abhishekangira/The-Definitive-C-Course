import fs from 'node:fs';
import { compile, llvm } from './lib.mjs';
const c = await compile({ 'asm.c': fs.readFileSync('c/asm.c', 'utf8') }, ['-O1', '-g', '-c', 'asm.c', '-o', 'asm.o']);
const r = await llvm(['objdump', '-d', '--no-show-raw-insn', '-l', 'asm.o'], c.files);
console.log(r.out.split('\n').slice(0, 30).join('\n'));
