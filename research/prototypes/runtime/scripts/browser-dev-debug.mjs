import { chromium } from 'playwright-core';
const [port, userDataDir] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(userDataDir, { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
page.on('worker', w => { logs.push(`[worker created] ${w.url()}`); w.on('console', m => logs.push(`[worker console] ${m.text()}`)); });
page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`http://localhost:${port}/the-definitive-c-course/`);
await page.waitForFunction(() => window.__app, null, { timeout: 20000 }).catch(e => logs.push('no __app'));
const r = await Promise.race([
  page.evaluate(async () => {
    const rt = window.__app.getRuntime();
    const t0 = performance.now();
    await new Promise(res => { rt.onReady = res; rt.prefetch(); });
    const t1 = performance.now();
    const c = await rt.compile('#include <stdio.h>\nint main(void){ puts("dev ok"); }');
    let out = ''; await rt.run(c.wasm, { onOutput: (fd, t) => out += t }).done;
    return { readyMs: Math.round(t1 - t0), compileMs: Math.round(c.ms), out };
  }),
  new Promise(res => setTimeout(() => res('TIMEOUT 60s'), 60000)),
]);
console.log(r); console.log(logs.join('\n'));
await ctx.close();
