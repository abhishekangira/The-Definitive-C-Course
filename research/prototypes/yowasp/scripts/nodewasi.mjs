import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { WASI } from 'node:wasi';
import { compile } from './lib.mjs';
for (const name of ['ret300.c', 'abort.c', 'stdin.c', 'exitcode.c']) {
  const c = await compile({ [name]: fs.readFileSync('c/' + name, 'utf8') }, ['-O0', name, '-o', 'a.wasm']);
  // node:wasi needs real fds: write stdin to a temp file and open it
  const tmp = path.join(os.tmpdir(), 'stdin-' + process.pid); fs.writeFileSync(tmp, '3 4\nBob\nline two\nrest');
  const outF = tmp + '.out'; const fdIn = fs.openSync(tmp, 'r'); const fdOut = fs.openSync(outF, 'w');
  const wasi = new WASI({ version: 'preview1', args: ['a'], env: {}, stdin: fdIn, stdout: fdOut, stderr: fdOut, returnOnExit: true });
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(c.files['a.wasm']), wasi.getImportObject());
  let res; try { res = 'exit=' + wasi.start(inst); } catch (e) { res = 'trap=' + e.message; }
  fs.closeSync(fdOut); fs.closeSync(fdIn);
  console.log(name, res, JSON.stringify(fs.readFileSync(outF, 'utf8')));
}
