const { runClang } = await import(process.argv[2]);
const { runWasi } = await import(process.argv[3]);
const dec = new TextDecoder();
const hdrs = ['assert.h','complex.h','ctype.h','errno.h','fenv.h','float.h','inttypes.h','iso646.h','limits.h','locale.h','math.h','setjmp.h','signal.h','stdalign.h','stdarg.h','stdatomic.h','stdbool.h','stddef.h','stdint.h','stdio.h','stdlib.h','stdnoreturn.h','string.h','tgmath.h','time.h','uchar.h','wchar.h','wctype.h','unistd.h','fcntl.h','sys/stat.h','sys/types.h','dirent.h','strings.h','threads.h','wasm_simd128.h'];
const src = hdrs.map(h => `#include <${h}>`).join('\n') + `
static jmp_buf jb;
static void jump(void){ longjmp(jb, 42); }
int main(void){ double complex z = 3.0 + 4.0*I; atomic_int a = 0; atomic_fetch_add(&a, 1);
  int r = setjmp(jb); if (r == 0) jump();
  printf("|z|=%.1f atomic=%d setjmp=%d sqrt2=%.4f %s\\n", cabs(z), atomic_load(&a), r, sqrt(2.0), strerror(ENOENT)); return 0; }`;
const EMU = ['-D_WASI_EMULATED_SIGNAL', '-lwasi-emulated-signal', '-D_WASI_EMULATED_PROCESS_CLOCKS', '-lwasi-emulated-process-clocks', '-mllvm', '-wasm-enable-sjlj', '-lsetjmp'];
for (const flags of [[], ['-O2'], ['-fsanitize=undefined', '-fsanitize-trap=undefined']]) {
  let diag = ''; const sink = b => { if (b) diag += dec.decode(b); };
  try { const out = await runClang(['clang', '-std=c17', '-Wall', '-Wextra', '-pedantic', ...EMU, ...flags, 'main.c', '-o', 'a.wasm'], { 'main.c': src }, { fetchProgress() {}, stdout: sink, stderr: sink });
    let so = ''; const r = await runWasi({ bytes: out['a.wasm'], stdout: b => so += dec.decode(b), stderr: b => so += dec.decode(b) });
    console.log(flags.join(' ') || '(default)', 'compiled', out['a.wasm'].length, 'B; run:', r.kind, r.exitCode, r.message || '', JSON.stringify(so), diag ? 'diag:' + diag : ''); }
  catch (e) { console.log(flags.join(' '), 'FAIL', e.code, e.message, diag); }
}
