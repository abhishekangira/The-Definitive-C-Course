import fs from 'node:fs'; import { compile, runShim } from './lib.mjs';
const c = await compile({ 'm.c': fs.readFileSync('c/malloc.c', 'utf8') }, ['-O0', 'm.c', '-o', 'a.wasm']);
fs.writeFileSync('/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/yowasp/user.wasm', c.files['a.wasm']);
const src = '#include <stdio.h>\n#include <stdlib.h>\nint g; int main(void){ int l; char *h = malloc(10); printf("%p %p %p %p\\n", (void*)&l, (void*)&g, (void*)h, (void*)main); return 0; }';
const d = await compile({ 'p.c': src }, ['-O0', 'p.c', '-o', 'p.wasm']);
for (let i = 0; i < 3; i++) console.log('run', i, (await runShim(d.files['p.wasm'])).stdout.trim());
