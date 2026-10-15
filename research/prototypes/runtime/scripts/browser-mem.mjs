// Repeated compile+run: memory (renderer RSS via /proc) and latency stability.
import { chromium } from 'playwright-core';
import { readFileSync, readdirSync } from 'node:fs';
const [port, userDataDir] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(userDataDir, { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(`http://localhost:${port}/the-definitive-c-course/`);
await page.waitForFunction(() => window.__app);
function rendererRssMB() {
  let total = 0;
  for (const pid of readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
    try { const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (!cmd.includes('--type=renderer') || !cmd.includes(userDataDir.split('/').pop())) continue;
      const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/); total += +m[1]; } catch {}
  }
  return Math.round(total / 1024);
}
const allRenderers = () => { let t = 0; for (const pid of readdirSync('/proc').filter(p => /^\d+$/.test(p))) { try { const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (!cmd.includes('--type=renderer')) continue; t += +readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]; } catch {} } return Math.round(t / 1024); };
console.log('renderer RSS before toolchain MB', allRenderers());
await page.evaluate(() => new Promise(res => { const rt = window.__app.getRuntime(); rt.onReady = res; rt.prefetch(); }));
console.log('renderer RSS after toolchain ready MB', allRenderers());
const times = [];
for (let i = 0; i < 40; i++) {
  const r = await page.evaluate(async (i) => {
    const rt = window.__app.getRuntime();
    const t0 = performance.now();
    const c = await rt.compile(`#include <stdio.h>\n#include <stdlib.h>\nint main(void){ int *a = malloc(1000 * sizeof *a); for (int k = 0; k < 1000; k++) a[k] = k * ${i}; printf("%d\\n", a[999]); free(a); }`);
    const t1 = performance.now();
    let out = ''; const h = rt.run(c.wasm, { onOutput: (fd, t) => out += t }); await h.done;
    return [Math.round(t1 - t0), Math.round(performance.now() - t1), out.trim()];
  }, i);
  times.push(r);
  if (i % 10 === 9) console.log(`after ${i + 1} compiles: renderer RSS MB`, allRenderers(), 'last compile/run ms', r);
}
const c = times.map(t => t[0]).sort((a, b) => a - b);
console.log('compile ms: min', c[0], 'median', c[Math.floor(c.length / 2)], 'p90', c[Math.floor(c.length * 0.9)], 'max', c[c.length - 1], '| run round-trip ms median', times.map(t => t[1]).sort((a, b) => a - b)[20]);
await ctx.close();
