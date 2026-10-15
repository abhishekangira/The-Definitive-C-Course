// Minimal: compile C17 from a string with @yowasp/clang and run it with @bjorn3/browser_wasi_shim.
// npm i @yowasp/clang@22.0.0-git20542-10 @bjorn3/browser_wasi_shim@0.4.2   (Node >= 18; same code works in a module Web Worker)
import { runClang, Exit } from '@yowasp/clang';
import { WASI, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';

const FLAGS = ['-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0', '-g',
  '-lm', '-lc-printscan-long-double',                  // printf("%Lf") otherwise aborts at runtime
  '-Wl,-z,stack-size=1048576', '-Wl,--max-memory=268435456']; // 1 MiB stack (default 64 KiB), cap heap at 256 MiB

export async function compileAndRun(source, stdin = '') {
  const dec = new TextDecoder();
  let diagnostics = '';
  const sink = (b) => { if (b) diagnostics += dec.decode(b, { stream: true }); };
  await runClang(null, {}, { fetchProgress: () => {} });   // prefetch once (also silences the default progress logger)
  let files;
  try {
    files = await runClang(['clang', ...FLAGS, 'main.c', '-o', 'main.wasm'], { 'main.c': source },
                           { stdout: sink, stderr: sink, decodeASCII: false });
  } catch (e) {
    if (e instanceof Exit) return { compiled: false, diagnostics };
    throw e;
  }
  let stdout = '', stderr = '';
  const wasi = new WASI(['main'], [], [
    new OpenFile(new File(new TextEncoder().encode(stdin))),            // fd 0
    new ConsoleStdout((b) => { stdout += dec.decode(b, { stream: true }); }), // fd 1 (reports as a tty -> line buffered)
    new ConsoleStdout((b) => { stderr += dec.decode(b, { stream: true }); }), // fd 2
  ], { debug: false });                                                   // omit options => debug logging is ON
  const { instance } = await WebAssembly.instantiate(files['main.wasm'], { wasi_snapshot_preview1: wasi.wasiImport });
  let exitCode = null, trap = null;
  try { exitCode = wasi.start(instance); } catch (e) { trap = e.message; }  // RuntimeError: unreachable / divide by zero / ...
  return { compiled: true, diagnostics, stdout, stderr, exitCode, trap };
}

const r = await compileAndRun(`#include <stdio.h>
int main(void) {
    char name[64]; int n;
    if (scanf("%63s %d", name, &n) != 2) return 1;
    for (int i = 0; i < n; i++) printf("hello, %s! sizeof(void*)=%zu\\n", name, sizeof(void *));
    return 7;
}`, 'Ada 2\n');
console.log(r);
