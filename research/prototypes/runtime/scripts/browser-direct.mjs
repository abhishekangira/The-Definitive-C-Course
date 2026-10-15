import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); const logs = []; p.on('console', m => logs.push(m.text()));
await p.goto('http://localhost:8711/x/');
await p.waitForFunction(() => window.__result, null, { timeout: 60000 }).catch(() => {});
console.log(await p.evaluate(() => window.__result), logs);
await b.close();
