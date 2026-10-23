// The daily streak (Rio's head in the header, Rio the streak warrior on the course map and in Settings, spirit beans
// that save a missed day). It starts with the first submitted problem solution or quiz answer and counts local calendar
// days. Clock tests use Playwright's fake clock and a time zone far from UTC, and answer quiz questions only, so no
// program is compiled while the clock is faked.
import { test, expect, type Page } from '@playwright/test';
import { answerQuiz, availableModules, expectAccessible, progressJson } from './lib';

const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);
const mod = availableModules()[0];
// Warm-up questions that are plain multiple choice (no code to run), one for each submission below.
const plain = mod.quiz('retrieval').filter(q => q.type === 'choice' && !q.code && q.answer !== undefined);

const chip = (page: Page) => page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: /^Streak:/ });
const rio = (page: Page) => page.locator('main [data-warrior]').first();
const panel = (page: Page) => page.locator('#streak');
const gallery = (page: Page) => panel(page).getByRole('list', { name: "Rio's forms" });

const BEAT_MS = 400;

/**
 * Pause the beat clips and seek each one, in a single call. A finished CSS animation drops out of
 * `getAnimations()`, so a later call cannot find a beat that an earlier seek already ran past its end.
 */
async function seekBeats(page: Page) {
  return page.evaluate((beatMs: number) => {
    const nameOf = (anim: Animation) => (anim as unknown as { animationName?: string }).animationName ?? '';
    const root = document.querySelector('main [data-transform-sequence]');
    if (!root) return null;
    const steps = [...root.querySelectorAll<HTMLElement>('[data-transform-step]')].map(el => ({
      el,
      n: Number(el.getAttribute('data-transform-step')),
      anim: [...el.getAnimations()].find(a => nameOf(a).includes('stepOn')),
    }));
    if (steps.some(s => !s.anim?.effect)) return { missing: true as const, frames: [], timing: [] };
    const timing = steps.map(s => {
      const t = s.anim!.effect!.getComputedTiming();
      return { n: s.n, delay: t.delay, fill: t.fill };
    });
    const frames = [];
    for (let step = 0; step < steps.length; step++) {
      for (const s of steps) {
        const anim = s.anim!;
        anim.pause();
        // delay is n * beat. 100ms into the beat we want. Earlier beats are past their end
        // (fill none returns them to the clipped style). Later beats stay in their delay.
        anim.currentTime = s.n === step ? s.n * beatMs + 100 : s.n < step ? s.n * beatMs + beatMs + 50 : 0;
      }
      frames.push(steps.map(s => {
        const clip = getComputedStyle(s.el).clipPath;
        return { n: s.n, clip, unclipped: !clip.includes('100%') };
      }));
    }
    return { missing: false as const, frames, timing };
  }, BEAT_MS);
}

/**
 * Crouch offset in CSS pixels. The pose loop only toggles visibility, so the figure box does not move,
 * and seeking those loops would fire `animationend` on the last beat.
 */
async function crouchOffset(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('main [data-transform-sequence]');
    if (!root) return null;
    const beats = [...root.querySelectorAll<HTMLElement>('[data-transform-step]')];
    const box = (beat: Element | undefined) => beat?.querySelector('[data-pose]')?.getBoundingClientRect();
    const stand = box(beats[0]);
    const crouched = box(beats[1]);
    const svg = beats[1]?.querySelector('svg');
    const raw = beats[1]?.querySelector('g[data-crouch]')?.getAttribute('transform') ?? '';
    const n = /^translate\(0 (-?\d+)\)$/.exec(raw)?.[1];
    if (!stand || !crouched || !svg || n === undefined) return { dy: crouched && stand ? crouched.top - stand.top : 0, n: null, width: 0, vb: 0, raw };
    const width = svg.getBoundingClientRect().width;
    const vb = svg.viewBox.baseVal.width;
    return { dy: crouched.top - stand.top, n: Number(n), width, vb, raw };
  });
}

/** Flash fill against the page and the settings panel, in light and dark. Restores the theme attribute. */
async function flashColours(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('main [data-flash]');
    if (!el) return null;
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    const read = (theme: string) => {
      root.setAttribute('data-theme', theme);
      const cs = getComputedStyle(el);
      const panel = el.closest('.setting-body');
      return {
        background: cs.backgroundColor,
        border: cs.borderTopWidth,
        image: cs.backgroundImage,
        shadow: cs.boxShadow,
        page: getComputedStyle(document.body).backgroundColor,
        panel: panel ? getComputedStyle(panel).backgroundColor : '',
      };
    };
    const out = { light: read('light'), dark: read('dark') };
    if (prev === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prev);
    return out;
  });
}

async function answerOne(page: Page, n: number) {
  const item = plain[n];
  await page.goto(`#/m/${mod.id}/retrieval`);
  const box = page.locator(`[data-quiz-item="${item.id}"]`);
  await box.scrollIntoViewIfNeeded();
  await box.locator('input[type=radio]').nth(item.answer!).check();
  await box.getByRole('button', { name: 'Submit answer' }).click();
  await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
}

test.describe.serial('streak on a fake clock in Asia/Kolkata', () => {
  let page: Page;
  test.beforeAll(async ({ browser }, testInfo) => {
    expect(plain.length, 'the warm-up has enough plain questions for this spec').toBeGreaterThanOrEqual(5);
    const context = await browser.newContext({ timezoneId: 'Asia/Kolkata', baseURL: testInfo.project.use.baseURL });
    page = await context.newPage();
    page.on('pageerror', e => { throw e; });
    // 20:00 UTC on 9 March is 01:30 on 10 March in Kolkata: the local day is not the UTC day.
    await page.clock.install({ time: new Date('2026-03-09T20:00:00Z') });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('before any submission there is no chip and Rio is a defeated kid', async () => {
    await page.goto('');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await expect(rio(page)).toHaveAttribute('data-form', 'kid');
    await expect(rio(page)).toHaveAttribute('data-mood', 'defeated');
    await expect(rio(page)).toContainText('No streak yet');
    await expect(rio(page).getByRole('img')).toHaveAccessibleName('Rio, your streak warrior, in the Kid form, looks defeated.');
    expect((await progressJson(page)).streak?.days ?? []).toEqual([]);
  });

  test('answering a quiz question starts the streak on the learner\'s local day', async () => {
    await answerOne(page, 0);
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. You have submitted something today.');
    await expect(chip(page)).toHaveAttribute('data-streak', 'active');
    await expect(chip(page).locator('[data-form]')).toHaveAttribute('data-form', 'kid');
    await expect(page.getByRole('status').filter({ hasText: 'Streak started: 1 day.' })).toBeAttached();
    expect((await progressJson(page)).streak.days).toEqual(['2026-03-10']);
    await page.goto('');
    await expect(rio(page)).toHaveAttribute('data-mood', 'ready');
    await expect(rio(page)).toContainText('Next form: Warrior in 2 days.');
  });

  test('a second submission on the same day does not add a day', async () => {
    await answerOne(page, 1);
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. You have submitted something today.');
    expect((await progressJson(page)).streak).toEqual({ days: ['2026-03-10'], longest: 1 });
  });

  test('left open past midnight the chip turns dashed and Rio worried; the next submission makes it 2 days', async () => {
    await page.clock.fastForward('24:00:00');
    await expect(chip(page)).toHaveAttribute('data-streak', 'at-risk');
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. Submit a problem solution or a quiz answer today to keep it going.');
    await page.goto('');
    await expect(rio(page)).toHaveAttribute('data-mood', 'worried');
    await expect(rio(page)).toContainText('If you miss it, a spirit bean will save it.');
    await answerOne(page, 2);
    await expect(chip(page)).toHaveAccessibleName('Streak: 2 days. You have submitted something today.');
    await expect(chip(page)).toHaveAttribute('data-streak', 'active');
    expect((await progressJson(page)).streak).toEqual({ days: ['2026-03-10', '2026-03-11'], longest: 2 });
  });

  test('a missed day uses the spirit bean; the next submission reaches 3 days and Rio transforms once', async () => {
    await page.clock.fastForward('48:00:00'); // 13 March: the 12th was missed
    await expect(chip(page)).toHaveAttribute('data-streak', 'at-risk');
    await page.goto('#/settings');
    await expect(rio(page)).toHaveAttribute('data-mood', 'worried');
    await expect(rio(page)).toContainText('A spirit bean saved your 2-day streak.');
    await expect(panel(page).getByTestId('spirit-beans')).toHaveText('0 of 3 spirit beans · one is saving your streak right now');
    await expect(panel(page).getByRole('list', { name: 'The last 14 days' }).getByRole('listitem').nth(12)).toContainText('2026-03-12: missed, saved by a spirit bean');

    await answerOne(page, 3);
    await expect(chip(page)).toHaveAccessibleName('Streak: 3 days. You have submitted something today.');
    await expect(page.getByRole('status').filter({ hasText: 'Streak: 3 days. Rio reached a new form: Warrior.' })).toBeAttached();
    await expect(chip(page).locator('[data-form]')).toHaveAttribute('data-form', 'warrior');
    await page.goto('#/settings');
    await expect(rio(page)).toHaveAttribute('data-form', 'warrior');
    // The sequence is 2.4s and starts when this page mounts. Pause the beat clips before they can finish.
    await expect(rio(page)).toHaveAttribute('data-transforming', '');
    await page.evaluate(() => {
      const nameOf = (anim: Animation) => (anim as unknown as { animationName?: string }).animationName ?? '';
      for (const el of document.querySelectorAll('main [data-transform-step]')) {
        for (const anim of el.getAnimations()) {
          if (nameOf(anim).includes('stepOn')) anim.pause();
        }
      }
    });
    const beats = rio(page).locator('[data-transform-step]');
    await expect(beats).toHaveCount(6);
    await expect(beats.nth(0)).toHaveAttribute('data-form', 'kid');
    await expect(beats.nth(0)).toHaveAttribute('data-aura', 'none');
    await expect(beats.nth(1)).toHaveAttribute('data-crouch', '');
    await expect(beats.nth(2)).toHaveAttribute('data-aura', 'flicker');
    await expect(beats.nth(3)).toHaveAttribute('data-aura', 'blaze');
    await expect(beats.nth(4)).toHaveAttribute('data-flash', '');
    await expect(beats.nth(5)).toHaveAttribute('data-form', 'warrior');
    await expect(beats.nth(5)).toHaveAttribute('data-aura', 'blaze');
    // Pause and seek. Counting the nodes does not prove one beat is on screen, and a CSS px crouch is not on the grid.
    const crouched = await crouchOffset(page);
    expect(crouched?.n, 'crouch translate').toBe(5);
    expect(crouched!.dy).toBeGreaterThan(1);
    expect(Math.abs(crouched!.dy - crouched!.n! * (crouched!.width / crouched!.vb))).toBeLessThan(0.75);
    const sought = await seekBeats(page);
    expect(sought?.missing, 'every beat has a step animation').toBe(false);
    for (const [step, rows] of sought!.frames.entries()) {
      expect(rows.filter(r => r.unclipped).map(r => r.n), `only beat ${step} is unclipped`).toEqual([step]);
    }
    for (const row of sought!.timing) {
      // calc(0.4s * n) comes back a fraction of a millisecond off an integer.
      expect(Number(row.delay), `beat ${row.n} delay`).toBeCloseTo(row.n * BEAT_MS, 0);
      expect(row.fill, `beat ${row.n} fill`).toBe(row.n === 5 ? 'forwards' : 'none');
    }
    const flash = await flashColours(page);
    for (const theme of ['light', 'dark'] as const) {
      const colours = flash?.[theme];
      expect(colours?.border, theme).toBe('0px');
      expect(colours?.image, theme).toBe('none');
      expect(colours?.shadow, theme).toBe('none');
      expect(colours?.background, theme).not.toBe(colours?.page);
      expect(colours?.background, theme).not.toBe(colours?.panel);
      expect(colours?.background, theme).not.toBe('rgba(0, 0, 0, 0)');
    }
    await page.evaluate(() => {
      const nameOf = (anim: Animation) => (anim as unknown as { animationName?: string }).animationName ?? '';
      for (const el of document.querySelectorAll('main [data-transform-step]')) {
        for (const anim of el.getAnimations()) {
          if (nameOf(anim).includes('stepOn')) anim.finish();
        }
      }
    });
    await expect(rio(page)).not.toHaveAttribute('data-transforming');
    await expect(rio(page).locator('svg')).toHaveCount(1);
    await expect(rio(page).getByText('New form unlocked: Warrior')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Transformation! Rio reached a new form: Warrior.' })).toBeAttached();
    await expect(panel(page).getByTestId('spirit-beans')).toHaveText('0 of 3 spirit beans');
    // Shown once: the next visit shows the Warrior without the news.
    await page.reload();
    await expect(rio(page)).toHaveAttribute('data-form', 'warrior');
    await expect(rio(page).getByText(/New form unlocked/)).toHaveCount(0);
    await expect(gallery(page).locator('[data-gallery-form]')).toHaveCount(6);
    await expect(gallery(page).locator('[data-gallery-form="warrior"]')).toHaveAttribute('data-state', 'current');
    await expect(gallery(page).locator('[data-gallery-form="golden"]')).toHaveAttribute('data-state', 'locked');
  });

  test('two missed days with no bean left end the streak: no chip, a defeated kid, then a new streak of 1', async () => {
    await page.clock.fastForward(72 * 60 * 60 * 1000); // 16 March: the 14th and 15th were missed (a '72:00:00' string is rejected)
    await expect(chip(page)).toHaveCount(0);
    await page.goto('#/settings');
    await expect(panel(page)).toContainText('No streak is running. Your longest was 3 days.');
    await expect(rio(page)).toHaveAttribute('data-form', 'kid');
    await expect(rio(page)).toHaveAttribute('data-mood', 'defeated');
    await expect(rio(page)).toContainText('Your streak ended');
    // The beans of a broken streak are kept; the gallery keeps the Warrior.
    await expect(panel(page).getByTestId('spirit-beans')).toHaveText('0 of 3 spirit beans');
    await expect(gallery(page).locator('[data-gallery-form="warrior"]')).toHaveAttribute('data-state', 'reached');
    await answerOne(page, 4);
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. You have submitted something today.');
    await page.goto('#/settings');
    await expect(panel(page).getByTestId('streak-current')).toHaveText('1 day');
    await expect(panel(page)).toContainText('your longest is 3 days');
    const days = panel(page).getByRole('list', { name: 'The last 14 days' }).getByRole('listitem');
    await expect(days).toHaveCount(14);
    const marks = ['2026-03-10: submitted', '2026-03-11: submitted', '2026-03-12: missed, saved by a spirit bean', '2026-03-13: submitted',
      '2026-03-14: nothing submitted', '2026-03-15: nothing submitted', '2026-03-16: submitted'];
    for (const [i, text] of marks.entries()) await expect(days.nth(7 + i)).toContainText(text);
  });

  test('the settings panel and Rio pass axe in light and dark', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `settings with a streak (${scheme})`);
    }
    await page.goto('');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `course map with Rio (${scheme})`);
    }
  });
});

// Real clock from here on: these tests use today's date, whatever it is, and a fresh browser each.
async function setStreak(page: Page, days: string[], mode: 'Merge with my progress' | 'Replace my progress', longest = days.length) {
  await page.goto('#/settings');
  const doc = await progressJson(page);
  doc.streak = { days, longest };
  await page.locator('input[type=file]').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await page.getByRole('button', { name: mode }).click();
}

/** Local `YYYY-MM-DD` for `n` days before today, computed in the browser the app runs in. */
const daysAgo = (page: Page, n: number) => page.evaluate(k => {
  const d = new Date();
  d.setDate(d.getDate() - k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}, n);
const run = (page: Page, count: number) => Promise.all(Array.from({ length: count }, (_, i) => daysAgo(page, count - 1 - i)));

test('an imported streak is merged, and Rio takes the form of its length', async ({ browser }, testInfo) => {
  const page = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
  page.on('pageerror', e => { throw e; });
  try {
    await page.goto('#/settings');
    await expect(chip(page)).toHaveCount(0);
    // Two days ending yesterday: a streak that today's first submission would keep alive.
    const last3 = await run(page, 3);
    await setStreak(page, last3.slice(0, 2), 'Merge with my progress');
    await expect(page.getByText('Merged: you kept the furthest progress from both.')).toBeVisible();
    await expect(chip(page)).toHaveAttribute('data-streak', 'at-risk');
    await expect(rio(page)).toHaveAttribute('data-mood', 'worried');
    // Merging keeps both histories: days from the file and from this browser are united.
    await setStreak(page, [last3[2]], 'Merge with my progress');
    await expect(chip(page)).toHaveAccessibleName('Streak: 3 days. You have submitted something today.');
    await expect(rio(page)).toHaveAttribute('data-form', 'warrior');
    for (const [length, form, name] of [[7, 'golden', 'Golden Warrior'], [14, 'mane', 'Golden Mane'], [30, 'crimson', 'Crimson Fur'], [50, 'ape', 'Great Ape']] as const) {
      await setStreak(page, await run(page, length), 'Replace my progress');
      await expect(chip(page)).toHaveAccessibleName(`Streak: ${length} days. You have submitted something today.`);
      await expect(rio(page), `${length} days`).toHaveAttribute('data-form', form);
      await expect(rio(page)).toHaveAttribute('data-mood', 'ready');
      await expect(rio(page).getByText(`New form unlocked: ${name}`)).toBeVisible();
      await expect(chip(page).locator('[data-form]')).toHaveAttribute('data-form', form);
    }
    await expect(rio(page)).toContainText("Rio's final form.");
    await expect(gallery(page).locator('[data-state="locked"]')).toHaveCount(0);
    // A shorter streak (from a file whose longest streak was 50 days) sends Rio back without any news; the gallery keeps every form.
    await setStreak(page, await run(page, 2), 'Replace my progress', 50);
    await expect(rio(page)).toHaveAttribute('data-form', 'kid');
    await expect(rio(page).getByText(/New form unlocked/)).toHaveCount(0);
    await expect(gallery(page).locator('[data-gallery-form="ape"]')).toHaveAttribute('data-state', 'reached');
    await setStreak(page, [], 'Replace my progress');
    await expect(chip(page)).toHaveCount(0);
    await expect(rio(page)).toHaveAttribute('data-mood', 'defeated');
  } finally {
    await page.context().close();
  }
});

test('with reduced motion the new form appears without a transformation or any looping motion, and is still announced', async ({ browser }, testInfo) => {
  const page = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL, reducedMotion: 'reduce' })).newPage();
  page.on('pageerror', e => { throw e; });
  try {
    await setStreak(page, await run(page, 30), 'Replace my progress');
    await expect(rio(page)).toHaveAttribute('data-form', 'crimson');
    await expect(rio(page).getByText('New form unlocked: Crimson Fur')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Transformation! Rio reached a new form: Crimson Fur.' })).toBeAttached();
    // No auto-wait: a sequence that mounts and then ends 2.4s later would pass `not.toHaveAttribute`.
    expect(await rio(page).getAttribute('data-transforming')).toBeNull();
    expect(await rio(page).locator('[data-transform-step]').count()).toBe(0);
    await expect(rio(page).locator('svg')).toHaveCount(1);
    const moving = await page.locator('main').evaluate(main => [...main.querySelectorAll('[data-warrior] *, [data-gallery-form] *')]
      .filter(el => getComputedStyle(el).animationName !== 'none').map(el => el.getAttribute('class')));
    expect(moving, 'elements still animating').toEqual([]);
  } finally {
    await page.context().close();
  }
});

test('the gallery is still without reduced motion: only aura and pose frame 0 show, and nothing loops', async ({ browser }, testInfo) => {
  const page = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
  page.on('pageerror', e => { throw e; });
  try {
    // 30 days: golden, mane and crimson are reached, so their gallery tiles draw the four-frame aura.
    await setStreak(page, await run(page, 30), 'Replace my progress');
    await expect(gallery(page).locator('[data-gallery-form="crimson"]')).toHaveAttribute('data-state', 'current');
    const frames = await gallery(page).evaluate(list => {
      const vis = (sel: string) => [...list.querySelectorAll(sel)].map(el => getComputedStyle(el).visibility);
      return {
        first: vis('[data-aura-frame="0"], [data-frame="0"]'),
        later: vis('[data-aura-frame]:not([data-aura-frame="0"]), [data-frame]:not([data-frame="0"])'),
        moving: [...list.querySelectorAll('*')].filter(el => getComputedStyle(el).animationName !== 'none').map(el => el.getAttribute('class')),
      };
    });
    // Three aura tiles with frames 1-3 each, at least.
    expect(frames.later.length).toBeGreaterThanOrEqual(9);
    expect(frames.later.every(v => v === 'hidden'), 'aura/pose frames 1-3 hidden under .still').toBe(true);
    expect(frames.first.every(v => v === 'visible')).toBe(true);
    expect(frames.moving, '.still children still animating').toEqual([]);
  } finally {
    await page.context().close();
  }
});

test('a problem check counts for the streak even when it fails', async ({ browser }, testInfo) => {
  const page = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
  page.on('pageerror', e => { throw e; });
  try {
    await page.goto(`#/m/${mod.id}/retrieval`);
    await answerQuiz(page, mod, 'retrieval');
    await page.getByRole('button', { name: 'Finish warm-up' }).click();
    await expect(page.getByText('Warm-up done: the lessons are open.')).toBeVisible();
    // Start from an empty streak with the warm-up kept, so only the exercise check can start one.
    await page.goto('#/settings');
    const doc = await progressJson(page);
    doc.streak = { days: [], longest: 0 };
    await page.locator('input[type=file]').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    await page.getByRole('button', { name: 'Replace my progress' }).click();
    await expect(chip(page)).toHaveCount(0);

    await page.goto(`#/m/${mod.id}`);
    const id = mod.meta.problemSet[0];
    const details = page.locator('details', { has: page.locator(`[data-exercise="${id}"]`) });
    await details.locator(':scope > summary').click();
    // The starter is unchanged, so every check fails: a failed attempt still counts as a submission.
    await details.getByRole('button', { name: 'Check my code' }).click();
    await expect(chip(page)).toHaveAttribute('data-streak', 'active', { timeout: RUN_TIMEOUT });
    expect((await progressJson(page)).exercises[id].passed).not.toBe(true);
    expect((await progressJson(page)).streak.days).toEqual(await run(page, 1));
  } finally {
    await page.context().close();
  }
});
