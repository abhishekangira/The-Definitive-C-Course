const bundle = process.argv[2];
const { runClang } = await import(bundle);
const dec = new TextDecoder();
const hdrs = ['assert.h','complex.h','ctype.h','errno.h','fenv.h','float.h','inttypes.h','iso646.h','limits.h','locale.h','math.h','setjmp.h','signal.h','stdalign.h','stdarg.h','stdatomic.h','stdbool.h','stddef.h','stdint.h','stdio.h','stdlib.h','stdnoreturn.h','string.h','tgmath.h','time.h','uchar.h','wchar.h','wctype.h','unistd.h','fcntl.h','sys/stat.h','sys/types.h','dirent.h','strings.h','wasm_simd128.h'];
const src = hdrs.map(h => `#include <${h}>`).join('\n') + '\nint main(void){ double complex z = 1.0 + 2.0*I; atomic_int a = 0; atomic_fetch_add(&a, 1); printf("%.1f %d %s\\n", cabs(z), atomic_load(&a), strerror(ENOENT)); return 0; }';
let diag = ''; const sink = b => { if (b) diag += dec.decode(b); };
for (const flags of [[], ['-O2'], ['-fsanitize=undefined', '-fsanitize-trap=undefined'], ['-lm']]) {
  try { const out = await runClang(['clang', '-std=c17', '-Wall', '-Wextra', '-pedantic', ...flags, 'main.c', '-o', 'a.wasm'], { 'main.c': src }, { fetchProgress() {}, stdout: sink, stderr: sink });
    console.log(flags.join(' ') || '(default)', 'OK', out['a.wasm'].length, 'bytes'); }
  catch (e) { console.log(flags.join(' '), 'FAIL', e.code); }
}
console.log('diag:', diag || '(none)');
// threads.h is optional in C17 (__STDC_NO_THREADS__)
try { await runClang(['clang', '-std=c17', 't.c', '-o', 't.wasm'], { 't.c': '#include <threads.h>\nint main(void){return 0;}' }, { fetchProgress() {}, stdout: sink, stderr: sink }); console.log('threads.h ok'); } catch { console.log('threads.h: not available (expected for wasm32-wasip1, __STDC_NO_THREADS__)'); }
