// Module Web Worker: lazily imports the compiler, compiles C, runs the result with browser_wasi_shim.
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } from './shim/index.js';
let clangMod = null;
const dec = new TextDecoder();
self.onmessage = async ({ data }) => {
  const T = {}; const t0 = performance.now();
  try {
    if (!clangMod) {
      clangMod = await import('./clang/bundle.js');
      T.import = performance.now() - t0;
      let last = 0;
      await clangMod.runClang(null, {}, { fetchProgress: ({ doneLength, totalLength }) => { if (doneLength - last > 20e6 || doneLength === totalLength) { last = doneLength; self.postMessage({ progress: [doneLength, totalLength] }); } } });
      T.prefetch = performance.now() - t0 - T.import;
    }
    let diag = '';
    const sink = b => { if (b) diag += dec.decode(b); };
    const t1 = performance.now();
    let files, ok = true;
    try { files = await clangMod.runClang(['clang', ...data.flags, 'main.c', '-o', 'main.wasm'], { 'main.c': data.src }, { stdout: sink, stderr: sink, decodeASCII: false }); }
    catch (e) { if (e instanceof clangMod.Exit) ok = false; else throw e; }
    T.compile = performance.now() - t1;
    if (!ok) return self.postMessage({ ok, diag, T });
    let stdout = '', stderr = '';
    const fds = [new OpenFile(new File(new TextEncoder().encode(data.stdin || ''))),
      new ConsoleStdout(b => { stdout += dec.decode(b); }), new ConsoleStdout(b => { stderr += dec.decode(b); }), new PreopenDirectory('.', new Map())];
    const wasi = new WASI(['main'], [], fds, { debug: false });
    const t2 = performance.now();
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(files['main.wasm']), { wasi_snapshot_preview1: wasi.wasiImport });
    let exitCode = null, trap = null;
    try { exitCode = wasi.start(inst); } catch (e) { trap = String(e); }
    T.run = performance.now() - t2;
    self.postMessage({ ok, diag, stdout, stderr, exitCode, trap, T, wasmSize: files['main.wasm'].length });
  } catch (e) { self.postMessage({ fatal: String(e && e.stack || e) }); }
};
