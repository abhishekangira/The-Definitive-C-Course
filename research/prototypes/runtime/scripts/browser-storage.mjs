import { chromium } from 'playwright-core';
const ctx = await chromium.launchPersistentContext(process.argv[2], { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('http://localhost:8701/the-definitive-c-course/');
console.log(await page.evaluate(async () => {
  const est = await navigator.storage.estimate();
  const keys = await caches.keys();
  const c = await caches.open(keys[0]); const reqs = await c.keys();
  return { usageMB: (est.usage / 1e6).toFixed(1), quotaMB: (est.quota / 1e6).toFixed(0), cacheBuckets: est.usageDetails, caches: keys, entries: reqs.map(r => r.url.split('/').pop()), persisted: await navigator.storage.persisted() };
}));
await ctx.close();
