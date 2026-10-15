import { runClang, runLLVM, Exit } from '@yowasp/clang';
import { WASI as ShimWASI, File, OpenFile, ConsoleStdout, PreopenDirectory, WASIProcExit } from '@bjorn3/browser_wasi_shim';

const dec = new TextDecoder();
let prefetched = false;
export async function ensure() { if (!prefetched) { await runClang(null, {}, { fetchProgress: () => {} }); prefetched = true; } }

// Compile C sources (object of filename->string) with clang argv (without "clang").
export async function compile(files, args, { tool = 'clang' } = {}) {
  await ensure();
  let diag = '';
  const sink = b => { if (b) diag += dec.decode(b, { stream: true }); };
  const t = performance.now();
  try {
    const out = await runClang([tool, ...args], files, { stdout: sink, stderr: sink, decodeASCII: false });
    return { ok: true, diag, files: out, ms: performance.now() - t };
  } catch (e) {
    if (e instanceof Exit) return { ok: false, code: e.code, diag, files: e.files, ms: performance.now() - t };
    throw e;
  }
}

export async function llvm(args, files) {
  await ensure();
  let out = '';
  const sink = b => { if (b) out += dec.decode(b, { stream: true }); };
  try {
    const f = await runLLVM(args, files, { stdout: sink, stderr: sink, decodeASCII: true });
    return { ok: true, out, files: f };
  } catch (e) { if (e instanceof Exit) return { ok: false, out, files: e.files }; throw e; }
}

// Run a wasm32-wasip1 binary with @bjorn3/browser_wasi_shim (what we'd use in the browser).
export async function runShim(wasmBytes, { stdin = '', args = ['prog'] } = {}) {
  let stdout = '', stderr = '';
  const fds = [
    new OpenFile(new File(new TextEncoder().encode(stdin))),
    new ConsoleStdout(b => { stdout += dec.decode(b, { stream: true }); }),
    new ConsoleStdout(b => { stderr += dec.decode(b, { stream: true }); }),
    new PreopenDirectory('.', new Map()),
  ];
  const wasi = new ShimWASI(args, [], fds, { debug: false });
  const mod = await WebAssembly.compile(wasmBytes);
  const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.wasiImport });
  let exitCode, trap = null;
  const t = performance.now();
  try { exitCode = wasi.start(inst); }
  catch (e) { trap = `${e.constructor.name}: ${e.message}`; }
  return { stdout, stderr, exitCode, trap, ms: performance.now() - t, memPages: inst.exports.memory.buffer.byteLength / 65536 };
}
