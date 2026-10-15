const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const persistent = !!process.env.PERSIST;
  const ctx = persistent ? await chromium.launchPersistentContext(__dirname + '/profile', {}) : await (await chromium.launch()).newContext();
  const page = await ctx.newPage();
  page.on('console', m => { if (!m.text().includes('fetched')) console.log('[console]', m.text()); });
  const url = 'http://127.0.0.1:' + (process.env.PORT || 8124) + '/' + (process.env.PAGE || 'index2.html');
  const hello = '#include <stdio.h>\nint main(void){ puts("hi"); return 0; }\n';
  for (let i = 0; i < 2; i++) {
    await page.goto(url); await page.waitForFunction(() => window.compileRun);
    const t = Date.now();
    const r = await page.evaluate(src => window.compileRun(src), hello);
    console.log(`load ${i}: wall ${Date.now() - t}ms`, JSON.stringify(r.T), JSON.stringify(r.stdout));
    if (i === 0) console.log('--- reload ---');
  }
  const est = await page.evaluate(() => navigator.storage.estimate());
  console.log('storage estimate', JSON.stringify(est));
  await ctx.close();
})();
