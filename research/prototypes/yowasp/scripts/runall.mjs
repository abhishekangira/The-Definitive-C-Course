import fs from 'node:fs';
import path from 'node:path';
import { compile, runShim } from './lib.mjs';
const dir = process.argv[2];
const extra = (process.env.EXTRA || '').split(' ').filter(Boolean);
const names = process.argv.slice(3);
const stdins = { 'stdin.c': '3 4\nAlice\nthe whole line here\nxyz\n12345' };
for (const name of names) {
  const src = fs.readFileSync(path.join(dir, name), 'utf8');
  const args = ['-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0', ...extra, name, '-o', 'a.wasm'];
  const c = await compile({ [name]: src }, args);
  console.log(`===== ${name} (yowasp clang ${args.join(' ')}) compile ${c.ok ? 'OK' : 'FAILED code=' + c.code} ${c.ms.toFixed(0)}ms`);
  if (c.diag) console.log('--- diagnostics ---\n' + c.diag.trimEnd());
  if (!c.ok) continue;
  const r = await runShim(c.files['a.wasm'], { stdin: stdins[name] || '' });
  console.log(`--- run: exit=${r.exitCode} trap=${r.trap} ${r.ms.toFixed(0)}ms memPages=${r.memPages} wasmSize=${c.files['a.wasm'].length}`);
  if (r.stdout) console.log('stdout:\n' + r.stdout.trimEnd());
  if (r.stderr) console.log('stderr:\n' + r.stderr.trimEnd());
}
