const [yow, src, hdr, out, ...extra] = process.argv.slice(2);
const { runClang } = await import(yow);
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const dec = new TextDecoder(); let diag = '';
const files = { [basename(src)]: readFileSync(src, 'utf8') };
const args = ['clang','-std=c17','-Wall','-Wextra','-pedantic', ...extra];
if (hdr !== '-') { files['leakcheck.h'] = readFileSync(hdr, 'utf8'); args.push('-include', 'leakcheck.h'); }
args.push(basename(src), '-o', 'prog.wasm');
try {
  const o = await runClang(args, files, { stdout: b => b && (diag += dec.decode(b)), stderr: b => b && (diag += dec.decode(b)) });
  writeFileSync(out, o['prog.wasm']); process.stdout.write(diag + `[built ${o['prog.wasm'].length} bytes]\n`);
} catch (e) { process.stdout.write(diag + '\nCOMPILE FAILED ' + e + '\n'); process.exit(1); }
