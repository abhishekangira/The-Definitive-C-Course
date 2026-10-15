import { runClang } from '@yowasp/clang';
import { writeFileSync } from 'node:fs';
const src = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
int main(int argc, char **argv) {
  int unused;
  printf("hello from wasm, argc=%d\\n", argc);
  fprintf(stderr, "this goes to stderr\\n");
  char name[64];
  printf("name? "); fflush(stdout);
  if (scanf("%63s", name) == 1) printf("hi %s\\n", name);
  FILE *f = fopen("/tmp/out.txt", "w");
  if (!f) { perror("fopen"); } else { fprintf(f, "written %d\\n", 42); fclose(f); }
  f = fopen("/tmp/out.txt", "r"); char buf[64]={0};
  if (f) { fread(buf,1,63,f); fclose(f); printf("read back: %s", buf); }
  printf("rand=%d time>0=%d\\n", rand() % 100, time(NULL) > 0);
  return 3;
}`;
let t = performance.now();
let diag = '';
const dec = new TextDecoder();
const opts = { stdout: b => b && (diag += dec.decode(b)), stderr: b => b && (diag += dec.decode(b)), fetchProgress: () => {} };
try {
  const out = await runClang(['clang', '--target=wasm32-wasip1', '-std=c17', '-Wall', '-Wextra', '-pedantic', '-O1', 'main.c', '-o', 'main.wasm'], { 'main.c': src }, opts);
  console.log('cold compile ms', (performance.now() - t).toFixed(0), 'keys', Object.keys(out));
  writeFileSync(process.argv[2] || 'main.wasm', out['main.wasm']);
  console.log('wasm size', out['main.wasm'].length);
} catch (e) { console.log('ERR', e.constructor.name, e.code, e.message); }
console.log('DIAG<<', diag, '>>');
t = performance.now(); diag='';
const out2 = await runClang(['clang', '-std=c17', '-Wall', 'main.c', '-o', 'main.wasm'], { 'main.c': src }, opts);
console.log('warm compile ms', (performance.now() - t).toFixed(0));
// error case
t = performance.now(); diag='';
try { await runClang(['clang', '-std=c17', '-Wall', '-fcolor-diagnostics', 'bad.c', '-o', 'bad.wasm'], { 'bad.c': 'int main(void){ int x = \"s\"; return y; }' }, opts); }
catch (e) { console.log('error exit code', e.code, e.constructor.name, Object.keys(e.files||{})); }
console.log('error compile ms', (performance.now() - t).toFixed(0));
console.log('DIAG<<', JSON.stringify(diag), '>>');
