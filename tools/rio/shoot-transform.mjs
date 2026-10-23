// Dev tool: frame grabs of Rio's transformation (issue #107). The PNGs are never committed (PR rule 11).
//
//   npm run build && npx vite preview --port 4207 --strictPort
//   node tools/rio/shoot-transform.mjs OUT
//
// OUT is the directory to write (default /tmp/rio-shots/transform, outside the repo).
// E2E_PORT is the preview port (default 4207). CHROMIUM_PATH selects the browser;
// otherwise Playwright launches its default Chromium.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] ?? '/tmp/rio-shots/transform';
const PORT = process.env.E2E_PORT ?? '4207';
const BASE = `http://localhost:${PORT}/`;

async function arm(page, theme) {
  await page.goto(BASE + '#/settings', { waitUntil: 'load' });
  await page.waitForSelector('#streak');
  await page.evaluate(theme => {
    const fmt = offset => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const doc = JSON.parse(localStorage.getItem('tdcc:v1:progress'));
    doc.streak = { days: [fmt(2), fmt(1), fmt(0)], longest: 3 };
    localStorage.setItem('tdcc:v1:progress', JSON.stringify(doc));
    localStorage.setItem('tdcc:v1:warrior', 'kid');
    localStorage.setItem('tdcc:v1:theme', theme);
  }, theme);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
  await page.waitForSelector('[data-transforming]');
}

// Pauses the beat animations and seeks one of them. The crouch is a drawn pose
// (crouchSprite), marked data-crouch on the figure; nothing is translated.
function seek(step) {
  const steps = [...document.querySelectorAll('[data-transform-step]')];
  for (const el of steps) {
    const anim = el.getAnimations().find(a => (a.animationName || '').includes('stepOn'));
    const n = Number(el.getAttribute('data-transform-step'));
    if (!anim) continue;
    anim.pause();
    // delay is n * 400ms. 100ms into the beat we want. Earlier beats are past their
    // end (fill-mode none returns them to the clipped style). Later beats stay in
    // their delay. currentTime 0 is already inside beat 0, so it cannot mean "hidden".
    anim.currentTime = n === step ? n * 400 + 100 : n < step ? n * 400 + 450 : 0;
  }
  return steps.map(el => {
    const s = getComputedStyle(el);
    const g = el.querySelector('g[data-crouch]');
    return {
      step: el.getAttribute('data-transform-step'),
      clip: s.clipPath,
      crouch: Boolean(g),
      flash: el.hasAttribute('data-flash'),
      form: el.getAttribute('data-form'),
      aura: el.getAttribute('data-aura'),
      background: s.backgroundColor,
      border: s.borderTopWidth,
    };
  });
}

async function shoot() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const log = [];
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on('pageerror', e => { throw e; });
      await arm(page, theme);
      const rio = page.locator('main [data-warrior]').first();
      for (let step = 0; step < 6; step++) {
        const info = await page.evaluate(seek, step);
        log.push({ theme, step, info });
        await rio.screenshot({ path: path.join(OUT, `${theme}-beat${step}.png`) });
      }
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', e => { throw e; });
    await arm(page, 'light');
    const t0 = Date.now();
    await page.waitForFunction(() => !document.querySelector('[data-transforming]'), { timeout: 5000 });
    const left = Date.now() - t0;
    const svgs = await page.locator('main [data-warrior] svg').count();
    const news = await page.locator('main [data-warrior]').getByText('New form unlocked: Warrior').count();
    log.push({ playedOutMs: left, svgs, news });
    await page.locator('main [data-warrior]').first().screenshot({ path: path.join(OUT, 'light-after.png') });
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(log, null, 2));
}

await shoot();
