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
show('ready', ready);
const depthSrc = (frame) => `#include <stdio.h>
#include <stdlib.h>
static long depth;
int f(long n){ volatile char b[${frame}]; b[0]=1; depth=n; return n==0?0:f(n-1)+b[0]; }
int main(int argc, char**argv){ (void)argc; long n = strtol(argv[1], 0, 10); printf("%d\\n", f(n)); }`;
for (const [frame, flags] of [[1, ['-O1']], [1, ['-O2']], [16, ['-O2']]]) {
  let lo = 1000, hi = 50000000, okDepth = 0, failMsg = '';
  // binary search max depth via argv
  while (hi - lo > lo / 50) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await page.evaluate(async ([src, mid, flags]) => {
      const rt = window.__app.getRuntime();
      const c = window.__cache?.[src + flags] ?? (await rt.compile(src, flags));
      (window.__cache ??= {})[src + flags] = c;
      const h = rt.run(c.wasm, { args: ['main', String(mid)], cpuTimeoutMs: 20000, onOutput() {} });
      const r = await h.done; return { kind: r.kind, message: r.message };
    }, [depthSrc(frame), mid, flags]);
    if (r.kind === 'exit') { okDepth = mid; lo = mid; } else { hi = mid; failMsg = r.message; }
  }
  show(`max recursion depth, ${frame}-byte local array ${flags}`, { okDepth, failsAt: hi, failMsg });
}
await ctx.close();
