// usage: node browser-test.mjs <port> <userDataDir> [label]
import { chromium } from 'playwright-core';
const [port, userDataDir, label = ''] = process.argv.slice(2);
const BASE = `http://localhost:${port}/the-definitive-c-course/`;
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
  args: ['--no-sandbox'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const consoleLines = [];
page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => consoleLines.push(`[pageerror] ${e.message}`));
const tNav = Date.now();
await page.goto(BASE);
await page.waitForFunction(() => window.__app);
console.log(`=== ${label} page loaded in ${Date.now() - tNav} ms`, await page.evaluate(() => ({ coi: crossOriginIsolated, jspi: typeof WebAssembly.Suspending === 'function', sab: typeof SharedArrayBuffer, ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] })));
await fetch(`http://localhost:${port}/__clearlog`);

await page.evaluate(() => {
  window.T = {
    progress: [],
    async ready() {
      const rt = window.__app.getRuntime();
      const t0 = performance.now();
      return new Promise(res => {
        rt.onProgress = (d, t) => T.progress.push([Math.round(performance.now() - t0), d, t]);
        rt.onReady = info => res({ ...info, wallMs: performance.now() - t0 });
        rt.prefetch();
      });
    },
    async compileRun(src, opts = {}) {
      const rt = window.__app.getRuntime();
      const t0 = performance.now();
      const c = await rt.compile(src, opts.flags || []);
      const compile = { ok: c.ok, workerMs: Math.round(c.ms), roundTripMs: Math.round(performance.now() - t0), diagnostics: c.diagnostics, wasmBytes: c.wasm?.length };
      if (!c.ok || opts.compileOnly) return { compile };
      let out = ''; const events = []; const inputs = [...(opts.inputs || [])];
      const tr = performance.now();
      let h;
      h = rt.run(c.wasm, {
        mode: opts.mode, presetStdin: opts.stdin, cpuTimeoutMs: opts.timeout, maxOutput: opts.maxOutput, files: opts.files,
        onOutput: (fd, t) => { out += t; events.push([fd, t.length > 60 ? t.slice(0, 60) + '…' : t]); },
        onStdinRequest: () => { events.push(['STDIN?']); const next = inputs.shift(); if (next !== undefined) setTimeout(() => next === null ? h.sendEOF() : h.provideInput(next), opts.typeDelay ?? 300); },
        onStarted: i => events.push(['started', Math.round(i.instantiateMs * 10) / 10, i.mode]),
      });
      if (opts.killAfter) setTimeout(() => h.kill(), opts.killAfter);
      const r = await h.done; delete r.files;
      return { compile, run: { ...r, ms: Math.round(r.ms), wallMs: Math.round(r.wallMs), runRoundTripMs: Math.round(performance.now() - tr) }, out: out.length > 400 ? out.slice(0, 200) + `…(${out.length} chars)` : out, events: events.slice(0, 12) };
    },
  };
});
const show = (name, r) => console.log(`--- ${name}\n${JSON.stringify(r, null, 1).replace(/\n\s*/g, ' ')}`);

const ready = await page.evaluate(() => T.ready());
const prog = await page.evaluate(() => T.progress);
show('toolchain ready', { ...ready, progressEvents: prog.length, first: prog[0], last: prog[prog.length - 1] });
const netlog = await (await fetch(`http://localhost:${port}/__log`)).json();
show('network requests during load', netlog);

const HELLO = '#include <stdio.h>\nint main(void){ printf("hello, world\\n"); return 0; }';
show('first compile+run (hello)', await page.evaluate(s => T.compileRun(s), HELLO));
show('second compile+run (hello, warm)', await page.evaluate(s => T.compileRun(s), HELLO));
show('third compile (different program, warm)', await page.evaluate(s => T.compileRun(s, { compileOnly: true }), '#include <stdio.h>\n#include <math.h>\n#include <string.h>\nint main(void){ char b[32]; snprintf(b, sizeof b, "%.3f", sqrt(2)); printf("%s %zu\\n", b, strlen(b)); }'));
show('-O2 compile', await page.evaluate(s => T.compileRun(s, { flags: ['-O2'] }), HELLO));
show('compile error + warning', await page.evaluate(s => T.compileRun(s), 'int main(void) {\n  int unused;\n  int x = "str";\n  return y;\n}'));

const INTERACTIVE = '#include <stdio.h>\nint main(void){ char name[32]; int age; printf("Name: "); if(scanf("%31s", name)!=1) return 1; printf("Age: "); if(scanf("%d",&age)!=1) return 2; printf("Hi %s, %d\\n", name, age+10); int c, n=0; while((c=getchar())!=EOF) n++; printf("then %d chars until EOF\\n", n); return 0; }';
const modes = await page.evaluate(() => [typeof WebAssembly.Suspending === 'function' && 'jspi', crossOriginIsolated && 'sab'].filter(Boolean));
for (const mode of modes) show(`interactive stdin mode=${mode}`, await page.evaluate(([s, mode]) => T.compileRun(s, { mode, inputs: ['Ada\n', '36\n', 'xyz\n', null] }), [INTERACTIVE, mode]));
show('preset stdin', await page.evaluate(s => T.compileRun(s, { mode: 'preset', stdin: 'Grace 40\nabc' }), INTERACTIVE));
show('infinite loop, 2s CPU budget', await page.evaluate(s => T.compileRun(s, { timeout: 2000 }), 'int main(void){ volatile unsigned long i = 0; for(;;) i++; }'));
show('compile right after kill (compiler worker survived?)', await page.evaluate(s => T.compileRun(s), HELLO));
show('infinite loop while waiting on stdin is not charged', await page.evaluate(s => T.compileRun(s, { mode: undefined, timeout: 1000, inputs: ['5\n'], typeDelay: 1500 }), '#include <stdio.h>\nint main(void){ int n; printf("n? "); scanf("%d",&n); printf("n=%d\\n", n); }'));
show('user Stop button (kill after 500ms)', await page.evaluate(s => T.compileRun(s, { killAfter: 500, timeout: 10000 }), '#include <stdio.h>\nint main(void){ for(long i=0;;i++) if(i%100000000==0) printf("tick %ld\\n", i/100000000); }'));
show('output flood (1 MiB cap)', await page.evaluate(s => T.compileRun(s), '#include <stdio.h>\nint main(void){ for(long i=0;;i++) printf("line %ld\\n", i); }'));
show('streaming: output arrives incrementally', await page.evaluate(s => T.compileRun(s, { timeout: 4000 }), '#include <stdio.h>\n#include <time.h>\nint main(void){ for(int k=0;k<3;k++){ clock_t c=clock(); while((double)(clock()-c)/CLOCKS_PER_SEC < 0.3); printf("step %d\\n", k); } }'));
show('trap: divide by zero', await page.evaluate(s => T.compileRun(s), '#include <stdio.h>\nint main(int argc, char**argv){ (void)argv; printf("before\\n"); return 10/(argc-1); }'));
show('trap: assert', await page.evaluate(s => T.compileRun(s), '#include <assert.h>\nint main(void){ int x=1; assert(x==2); }'));
show('trap: stack overflow (8 MiB stack, stack-first)', await page.evaluate(s => T.compileRun(s), '#include <stdio.h>\nint f(int n){ volatile char b[512]; b[0]=(char)n; return f(n+1)+b[0]; }\nint main(void){ printf("%d\\n", f(0)); }'));
show('recursion depth 10000 w/ 512B frames fits in 8 MiB', await page.evaluate(s => T.compileRun(s), '#include <stdio.h>\nint f(int n){ volatile char b[512]; b[0]=1; return n==0?0:f(n-1)+b[0]; }\nint main(void){ printf("%d\\n", f(10000)); }'));
show('malloc until NULL (256 MiB cap)', await page.evaluate(s => T.compileRun(s), '#include <stdio.h>\n#include <stdlib.h>\nint main(void){ size_t n=0; while(malloc(1<<20)) n++; printf("%zu MiB\\n", n); }'));
show('file I/O on in-memory FS', await page.evaluate(s => T.compileRun(s, { files: { 'scores.txt': 'alice 90\nbob 85\n' } }), '#include <stdio.h>\nint main(void){ FILE*in=fopen("scores.txt","r"); if(!in){perror("scores.txt");return 1;} char n[16]; int s, tot=0; while(fscanf(in,"%15s %d",n,&s)==2) tot+=s; fclose(in); FILE*o=fopen("/tmp/out.txt","w"); fprintf(o,"total %d\\n",tot); fclose(o); o=fopen("/tmp/out.txt","r"); char line[64]; fgets(line,sizeof line,o); fclose(o); printf("%s", line); if(!fopen("nope.txt","r")) perror("nope.txt"); }'));
show('clock()/time()/rand', await page.evaluate(s => T.compileRun(s), '#include <stdio.h>\n#include <stdlib.h>\n#include <time.h>\nint main(void){ srand((unsigned)time(NULL)); printf("%d %d %d\\n", time(NULL) > 1700000000, rand() >= 0, clock() >= 0); }'));

console.log('console:', consoleLines.slice(0, 20));
await page.screenshot({ path: `${userDataDir}-screenshot.png` }).catch(() => {});
await ctx.close();
