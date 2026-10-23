// Dev tool: Rio contact sheet for issue #107 (every form and mood, every pose frame, light and dark page).
// The PNGs are never committed (PR rule 11).
//
//   npm run build && npx vite preview --port 4207 --strictPort
//   node tools/rio/contact-sheet.mjs OUT
//
// OUT is the directory to write (default /tmp/rio-shots/contact, outside the repo). It gets
// contact-light.png and contact-dark.png (one row per form and mood, one column per pose frame, plus
// frame 1 with the eyes shut), the frames they are made of, the Settings gallery, and the header and
// chip at 1400 and 390 px. E2E_PORT is the preview port (default 4207). CHROMIUM_PATH selects the
// browser; otherwise Playwright launches its default Chromium.
//
// The page is armed through localStorage, like an imported progress file: a streak of the form's days
// ending today is "ready", the same streak ending yesterday is "worried" (at risk), and no streak with
// longest 50 is the defeated kid. `tdcc:v1:warrior` is set to the form shown, so no transformation plays.
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] ?? '/tmp/rio-shots/contact';
const PORT = process.env.E2E_PORT ?? '4207';
const BASE = `http://localhost:${PORT}/`;

const FORMS = [['kid', 1], ['warrior', 3], ['golden', 7], ['mane', 14], ['crimson', 30], ['ape', 50]];
const moodsFor = form => (form === 'kid' ? ['ready', 'worried', 'defeated'] : ['ready', 'worried']);

async function arm(page, { days, endOffset, theme, seen }) {
  await page.evaluate(({ days, endOffset, theme, seen }) => {
    const fmt = offset => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push(fmt(i + endOffset));
    const doc = JSON.parse(localStorage.getItem('tdcc:v1:progress'));
    doc.streak = { days: list, longest: 50 };
    localStorage.setItem('tdcc:v1:progress', JSON.stringify(doc));
    localStorage.setItem('tdcc:v1:warrior', seen);
    localStorage.setItem('tdcc:v1:theme', theme);
  }, { days, endOffset, theme, seen });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
}

// Freeze one pose frame (and aura frame 0). Animations beat ordinary inline styles, hence !important.
async function showFrame(svg, index, eyesShut) {
  await svg.evaluate((el, { index, eyesShut }) => {
    const freeze = (n, prop, value) => n.style.setProperty(prop, value, 'important');
    el.querySelectorAll('*').forEach(n => freeze(n, 'animation', 'none'));
    el.querySelectorAll('[data-aura-frame]').forEach(n => freeze(n, 'visibility', n.getAttribute('data-aura-frame') === '0' ? 'visible' : 'hidden'));
    el.querySelectorAll('[data-frame]').forEach(n => freeze(n, 'visibility', n.getAttribute('data-frame') === String(index) ? 'visible' : 'hidden'));
    el.querySelectorAll('[data-blink]').forEach(n => {
      const on = eyesShut && n.closest('[data-frame]')?.getAttribute('data-frame') === String(index);
      freeze(n, 'opacity', on ? '1' : '0');
    });
  }, { index, eyesShut });
}

async function sheet(browser, theme, rows) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const bg = theme === 'dark' ? '#14161c' : '#ffffff';
  const fg = theme === 'dark' ? '#e8e8ee' : '#1a1a1a';
  const cells = await Promise.all(rows.map(async r => ({
    label: r.label,
    imgs: await Promise.all(r.files.map(async f => ({ name: path.basename(f, '.png').split('-').pop(), src: `data:image/png;base64,${(await readFile(f)).toString('base64')}` }))),
  })));
  await page.setContent(`<body style="margin:0;padding:16px;background:${bg};color:${fg};font:14px system-ui">
    <h1 style="font-size:18px;margin:0 0 12px">Rio, every form and mood (${theme} page). Columns: pose frames, then frame 1 with the eyes shut.</h1>
    <table style="border-collapse:collapse">${cells.map(c => `<tr><th style="text-align:left;padding:4px 12px 4px 0">${c.label}</th>${c.imgs
      .map(i => `<td style="padding:4px;text-align:center"><img src="${i.src}" style="width:120px;image-rendering:pixelated"><br>${i.name}</td>`).join('')}</tr>`).join('')}</table></body>`);
  await page.screenshot({ path: path.join(OUT, `contact-${theme}.png`), fullPage: true });
  await page.close();
}

async function shoot() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const written = [];
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [1400, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 2 });
        const page = await context.newPage();
        page.on('pageerror', e => { throw e; });
        await page.goto(BASE + '#/settings', { waitUntil: 'load' });
        await page.waitForSelector('#streak');
        await arm(page, { days: 50, endOffset: 0, theme, seen: 'ape' });
        await page.waitForSelector('a[data-streak]');
        await page.getByRole('navigation', { name: 'Site' }).screenshot({ path: path.join(OUT, `${theme}-w${width}-header.png`) });
        await page.locator('a[data-streak]').screenshot({ path: path.join(OUT, `${theme}-w${width}-chip.png`) });
        await context.close();
      }

      const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on('pageerror', e => { throw e; });
      await page.goto(BASE + '#/settings', { waitUntil: 'load' });
      await page.waitForSelector('#streak');
      await arm(page, { days: 50, endOffset: 0, theme, seen: 'ape' });
      await page.waitForSelector('[data-gallery-form="ape"][data-state="current"]');
      await page.locator('#streak').getByRole('list', { name: "Rio's forms" }).screenshot({ path: path.join(OUT, `${theme}-gallery.png`) });

      const rows = [];
      for (const [form, days] of FORMS) {
        for (const mood of moodsFor(form)) {
          await arm(page, { days: mood === 'defeated' ? 0 : days, endOffset: mood === 'worried' ? 1 : 0, theme, seen: form });
          const rio = page.locator('main [data-warrior]').first();
          await rio.waitFor();
          const [got, gotMood] = [await rio.getAttribute('data-form'), await rio.getAttribute('data-mood')];
          if (got !== form || gotMood !== mood) throw new Error(`expected ${form}/${mood} but the page shows ${got}/${gotMood}`);
          const svg = rio.locator('svg').first();
          const n = await svg.locator('[data-frame]').count();
          const files = [];
          for (let i = 0; i < n; i++) {
            await showFrame(svg, i, false);
            files.push(path.join(OUT, `${theme}-${form}-${mood}-f${i}.png`));
            await svg.screenshot({ path: files.at(-1) });
          }
          if (await svg.locator('[data-blink]').count()) {
            await showFrame(svg, Math.min(1, n - 1), true);
            files.push(path.join(OUT, `${theme}-${form}-${mood}-blink.png`));
            await svg.screenshot({ path: files.at(-1) });
          }
          rows.push({ label: `${form} · ${mood}`, files });
          written.push(...files);
        }
      }
      await context.close();
      await sheet(browser, theme, rows);
    }
  } finally {
    await browser.close();
  }
  console.log(`contact sheets: ${path.join(OUT, 'contact-light.png')} and ${path.join(OUT, 'contact-dark.png')} (${written.length} frames)`);
}

await shoot();
