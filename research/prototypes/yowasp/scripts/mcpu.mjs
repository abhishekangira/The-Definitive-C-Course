import fs from 'node:fs'; import { compile, runShim } from './lib.mjs';
for (const cpu of ['mvp', 'lime1', 'generic', 'bleeding-edge']) {
  const c = await compile({ 'p.c': fs.readFileSync('c/printf_formats.c', 'utf8') }, ['-O1', `-mcpu=${cpu}`, '-lc-printscan-long-double', 'p.c', '-o', 'a.wasm']);
  if (!c.ok) { console.log(cpu, 'FAILED', c.diag.slice(0, 300)); continue; }
  fs.writeFileSync(`/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/yowasp/cpu-${cpu}.wasm`, c.files['a.wasm']);
  const r = await runShim(c.files['a.wasm']);
  console.log(cpu, 'ok size', c.files['a.wasm'].length, 'exit', r.exitCode, r.trap);
}
