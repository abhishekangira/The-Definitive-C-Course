// Dev tool: Rio contact sheet (issue #107). The PNGs are never committed (PR rule 11).
//
//   npm run build && npx vite preview --port 4207 --strictPort
//   node tools/rio/contact-sheet.mjs OUT
//
// OUT is the directory to write (default /tmp/rio-shots, outside the repo).
// E2E_PORT is the preview port (default 4207). CHROMIUM_PATH selects the browser;
// otherwise Playwright launches its default Chromium.
import { chromium } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] ?? '/tmp/rio-shots';
const PORT = process.env.E2E_PORT ?? '4207';
const BASE = `http://localhost:${PORT}/`;

const FORMS = [
  ['kid', 1],
  ['warrior', 3],
  ['golden', 7],
  ['mane', 14],
  ['crimson', 30],
  ['ape', 50],
];

async function shoot() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [1400, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 900 },
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();
        page.on('pageerror', e => { throw e; });
        await page.goto(BASE + '#/settings', { waitUntil: 'load' });
        await page.waitForSelector('#streak');
        await apply(page, { days: 50, endOffset: 0, longest: 50, theme, seen: 'ape' });
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
        await page.waitForSelector('[data-gallery-form="ape"]');
        await page.waitForSelector('a[data-streak]');
        const tag = `${theme}-w${width}`;
        await page.screenshot({ path: path.join(OUT, `${tag}-settings.png`), fullPage: true });
        await page.getByRole('navigation', { name: 'Site' }).screenshot({ path: path.join(OUT, `${tag}-header.png`) });
        await context.close();
      }

      const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on('pageerror', e => { throw e; });
      await page.goto(BASE + '#/settings', { waitUntil: 'load' });
      await page.waitForSelector('#streak');
      await apply(page, { days: 50, endOffset: 0, longest: 50, theme, seen: 'ape' });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
      await page.waitForSelector('[data-gallery-form="ape"][data-state="current"]');
      await page.locator('#streak').getByRole('list', { name: "Rio's forms" }).screenshot({ path: path.join(OUT, `${theme}-gallery.png`) });

      for (const [form, days] of FORMS) {
        for (const mood of form === 'kid' ? ['ready', 'worried', 'defeated'] : ['ready', 'worried']) {
          const endOffset = mood === 'worried' ? 1 : 0;
          const streakDays = mood === 'defeated' ? 0 : days;
          await apply(page, { days: streakDays, endOffset, longest: 50, theme, seen: mood === 'defeated' ? 'kid' : form });
          await page.reload({ waitUntil: 'load' });
          await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
          const rio = page.locator('main [data-warrior]').first();
          await rio.waitFor();
          const got = await rio.getAttribute('data-form');
          const gotMood = await rio.getAttribute('data-mood');
          if (got !== (mood === 'defeated' ? 'kid' : form) || gotMood !== mood) {
            throw new Error(`expected ${form}/${mood} but page shows ${got}/${gotMood}`);
          }
          await rio.locator('svg').first().screenshot({ path: path.join(OUT, `${theme}-${form}-${mood}.png`) });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function apply(page, { days, endOffset, longest, theme, seen }) {
  await page.evaluate(({ days, endOffset, longest, theme, seen }) => {
    const fmt = offset => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push(fmt(i + endOffset));
    const key = 'tdcc:v1:progress';
    const doc = JSON.parse(localStorage.getItem(key));
    doc.streak = { days: list, longest };
    localStorage.setItem(key, JSON.stringify(doc));
    localStorage.setItem('tdcc:v1:warrior', seen);
    localStorage.setItem('tdcc:v1:theme', theme);
  }, { days, endOffset, longest, theme, seen });
}

await shoot();
console.log('shots in', OUT);
console.log((await readdir(OUT)).filter(n => n.endsWith('.png')).sort().join('\n'));
