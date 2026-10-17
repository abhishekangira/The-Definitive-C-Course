// The daily streak (a flame in the header, a panel and the pet Ember in Settings): it starts with the first submitted
// problem solution or quiz answer and counts local calendar days. Clock tests use Playwright's fake clock and a
// time zone far from UTC, and answer quiz questions only, so no program is compiled while the clock is faked.
import { test, expect, type Page } from '@playwright/test';
import { answerQuiz, availableModules, expectAccessible, progressJson } from './lib';

const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);
const mod = availableModules()[0];
// Warm-up questions that are plain multiple choice (no code to run), one for each submission below.
const plain = mod.quiz('retrieval').filter(q => q.type === 'choice' && !q.code && q.answer !== undefined);

const chip = (page: Page) => page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: /^Streak:/ });
const pet = (page: Page) => page.locator('main [data-pet]').first();

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
    expect(plain.length, 'the warm-up has enough plain questions for this spec').toBeGreaterThanOrEqual(4);
    const context = await browser.newContext({ timezoneId: 'Asia/Kolkata', baseURL: testInfo.project.use.baseURL });
    page = await context.newPage();
    page.on('pageerror', e => { throw e; });
    // 20:00 UTC on 9 March is 01:30 on 10 March in Kolkata: the local day is not the UTC day.
    await page.clock.install({ time: new Date('2026-03-09T20:00:00Z') });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('before any submission there is no flame and Ember is sad', async () => {
    await page.goto('');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await expect(pet(page)).toHaveAttribute('data-mood', 'sad');
    await expect(pet(page)).toContainText('No streak yet');
    expect((await progressJson(page)).streak?.days ?? []).toEqual([]);
  });

  test('answering a quiz question starts the streak on the learner\'s local day', async () => {
    await answerOne(page, 0);
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. You have submitted something today.');
    await expect(chip(page)).toHaveAttribute('data-streak', 'active');
    await expect(page.getByRole('status').filter({ hasText: 'Streak started: 1 day.' })).toBeAttached();
    expect((await progressJson(page)).streak.days).toEqual(['2026-03-10']);
    await page.goto('');
    await expect(pet(page)).toHaveAttribute('data-mood', 'content');
  });

  test('a second submission on the same day does not add a day', async () => {
    await answerOne(page, 1);
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. You have submitted something today.');
    expect((await progressJson(page)).streak).toEqual({ days: ['2026-03-10'], longest: 1 });
  });

  test('left open past midnight the flame turns dashed and Ember worried; the next submission makes it 2 days', async () => {
    await page.clock.fastForward('24:00:00');
    await expect(chip(page)).toHaveAttribute('data-streak', 'at-risk');
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. Submit a problem solution or a quiz answer today to keep it going.');
    await page.goto('');
    await expect(pet(page)).toHaveAttribute('data-mood', 'worried');
    await answerOne(page, 2);
    await expect(chip(page)).toHaveAccessibleName('Streak: 2 days. You have submitted something today.');
    await expect(chip(page)).toHaveAttribute('data-streak', 'active');
    expect((await progressJson(page)).streak).toEqual({ days: ['2026-03-10', '2026-03-11'], longest: 2 });
  });

  test('a missed day ends the streak: no flame, a sad Ember, then a new streak of 1 that keeps the longest', async () => {
    await page.clock.fastForward('48:00:00');
    await expect(chip(page)).toHaveCount(0);
    await page.goto('#/settings');
    const panel = page.locator('#streak');
    await expect(panel).toContainText('No streak is running. Your longest was 2 days.');
    await expect(pet(page)).toHaveAttribute('data-mood', 'sad');
    await expect(pet(page)).toContainText('Your streak ended');
    await answerOne(page, 3);
    await expect(chip(page)).toHaveAccessibleName('Streak: 1 day. You have submitted something today.');
    await page.goto('#/settings');
    await expect(panel.getByTestId('streak-current')).toHaveText('1 day');
    await expect(panel).toContainText('your longest is 2 days');
    const days = panel.getByRole('list', { name: 'The last 14 days' }).getByRole('listitem');
    await expect(days).toHaveCount(14);
    await expect(days.nth(13)).toContainText('2026-03-13: submitted');
    await expect(days.nth(12)).toContainText('2026-03-12: nothing submitted');
    await expect(days.nth(11)).toContainText('2026-03-11: submitted');
    await expect(days.nth(10)).toContainText('2026-03-10: submitted');
  });

  test('the settings panel and the pet pass axe in light and dark', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `settings with a streak (${scheme})`);
    }
    await page.goto('');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `course map with the pet (${scheme})`);
    }
  });
});

// Real clock from here on: these tests use today's date, whatever it is, and a fresh browser each.
async function setStreak(page: Page, days: string[], mode: 'Merge with my progress' | 'Replace my progress') {
  await page.goto('#/settings');
  const doc = await progressJson(page);
  doc.streak = { days, longest: days.length };
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

test('an imported streak is merged, and Ember is happier the longer it is', async ({ browser }, testInfo) => {
  const page = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
  try {
    await page.goto('#/settings');
    await expect(chip(page)).toHaveCount(0);
    // Two days ending yesterday: a streak that today's first submission would keep alive.
    const last3 = await run(page, 3);
    await setStreak(page, last3.slice(0, 2), 'Merge with my progress');
    await expect(page.getByText('Merged: you kept the furthest progress from both.')).toBeVisible();
    await expect(chip(page)).toHaveAttribute('data-streak', 'at-risk');
    await expect(pet(page)).toHaveAttribute('data-mood', 'worried');
    // Merging keeps both histories: days from the file and from this browser are united.
    await setStreak(page, [last3[2]], 'Merge with my progress');
    await expect(chip(page)).toHaveAccessibleName('Streak: 3 days. You have submitted something today.');
    await expect(pet(page)).toHaveAttribute('data-mood', 'happy');
    for (const [length, mood] of [[7, 'joyful'], [30, 'ecstatic'], [2, 'content']] as const) {
      await setStreak(page, await run(page, length), 'Replace my progress');
      await expect(chip(page)).toHaveAccessibleName(`Streak: ${length} days. You have submitted something today.`);
      await expect(pet(page), `${length} days`).toHaveAttribute('data-mood', mood);
    }
    await setStreak(page, [], 'Replace my progress');
    await expect(chip(page)).toHaveCount(0);
    await expect(pet(page)).toHaveAttribute('data-mood', 'sad');
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
