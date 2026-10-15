import { runClang } from '@yowasp/clang';
const q = { stdout: null, stderr: null, fetchProgress: () => {} };
await runClang(null, {}, q);
const src = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(void){ char *s = malloc(32); strcpy(s, "x"); printf("%s\\n", s); free(s); return 0; }\n';
for (let i = 1; i <= 150; i++) {
  await runClang(['clang', '-std=c17', '-Wall', '-O1', 'p.c', '-o', 'p.wasm'], { 'p.c': src }, q);
  if (i % 30 === 0) { globalThis.gc?.(); const m = process.memoryUsage(); console.log(`after ${i}: rss=${(m.rss/1048576)|0}MiB heapUsed=${(m.heapUsed/1048576)|0}MiB external=${(m.external/1048576)|0}MiB`); }
}
