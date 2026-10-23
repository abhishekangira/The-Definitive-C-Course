// Yellow and red prediction results on m01 lesson 2, sample int-division (issue #105).
// The yellow test then uses Predict again and an exact prediction, which is green.
// The spec seeds the warm-up and the two cards before int-division so it does not compile them.
// Screenshots are written only when SHOTS is a directory.
import { mkdirSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { availableModules, expectAccessible } from './lib';

const mod = availableModules()[0];
const stem = mod.lessons.find(l => l.stem.startsWith('02'))!.stem;
const CLOSE = 'Almost: the values are right, but the spacing, punctuation or line breaks differ.';
const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);

async function seed(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    const key = 'tdcc:v1:progress';
    if (localStorage.getItem(key)) return;
    const at = '2026-01-01T00:00:00.000Z';
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      seed: '00e2e00e2e00e2e0',
      createdAt: at,
      settings: {},
      cards: { 'm01-l2': [0, 1] },
      lessons: {},
      samples: {},
      exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } },
      projects: {},
      streak: { days: [], longest: 0 },
    }));
  });
}

async function openSample(page: Page) {
  await seed(page);
  await page.goto(`#/m/${mod.id}/${stem}`);
  const box = page.locator('[data-sample="int-division"]');
  await expect(box).toBeVisible();
  return box;
}

/** The program-output panel is the terminal log. Compare boxes must use its monospace font and padding. */
async function expectMonoCompare(box: Locator) {
  const panel = box.locator('[role="log"]');
  const panelFont = await panel.evaluate(el => getComputedStyle(el).fontFamily);
  const panelPad = await panel.evaluate(el => getComputedStyle(el).padding);
  const mono = await box.evaluate(el => {
    const probe = document.createElement('span');
    probe.style.fontFamily = 'var(--font-mono)';
    el.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  });
  expect(panelFont).toBe(mono);
  for (const which of ['predicted', 'actual']) {
    const style = await box.locator(`[data-compare="${which}"]`).evaluate(el => {
      const cs = getComputedStyle(el);
      const line = el.querySelector('[data-line]');
      return { font: cs.fontFamily, pad: cs.padding, display: line ? getComputedStyle(line).display : '' };
    });
    expect(style.font, which).toBe(panelFont);
    // The sans stack is "Geist Variable", Geist, ui-sans-serif. "Geist Mono" does not contain those.
    expect(style.font, which).not.toContain('Geist Variable');
    expect(style.font, which).not.toContain('ui-sans-serif');
    expect(style.pad, which).not.toBe('0px');
    expect(style.pad, which).toBe(panelPad);
    expect(style.display, which).toBe('block');
  }
}

async function shots(page: Page, box: ReturnType<Page['locator']>, name: string) {
  const dir = process.env.SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const [scheme, label] of [['light', 'light'], ['dark', 'dark']] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [width, height] of [[1400, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await box.scrollIntoViewIfNeeded();
      await box.screenshot({ path: `${dir}/${name}-${label}-${width}.png` });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('a close prediction on int-division is yellow, with both boxes and the commas marked', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  const area = box.locator('textarea');
  await area.fill('3, -3, 1\n3.5');
  await area.focus();
  await page.keyboard.press('Tab');
  await expect(box.getByRole('button', { name: 'Lock in my prediction' })).toBeFocused();
  await page.keyboard.press('Enter');
  const run = box.getByRole('button', { name: 'Run', exact: true });
  await run.focus();
  await expect(run).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  // The terminal's exit line is a second role=status inside the sample. The verdict is the yellow one.
  const status = box.getByRole('status').filter({ hasText: 'Almost:' });
  await expect(status).toContainText(CLOSE);
  await expect(status.locator('svg')).toHaveAttribute('data-icon', 'almost');
  await expect(status.getByText('You predicted')).toHaveCount(0);
  await expect(box.getByText('You predicted', { exact: true })).toBeVisible();
  await expect(box.getByText('Actual output', { exact: true })).toBeVisible();
  await expect(box.locator('[data-compare="predicted"] [data-line]')).toHaveCount(2);
  await expect(box.locator('[data-compare="predicted"] [data-diff]')).toHaveText([',', ',']);
  await expect(box.locator('[data-compare="actual"] [data-diff]')).toHaveCount(0);
  await expect(status).toHaveCSS('background-color', 'rgb(253, 241, 220)');
  const underline = await box.locator('[data-diff]').first().evaluate(el => getComputedStyle(el).textDecorationLine);
  expect(underline).toContain('underline');
  await expectMonoCompare(box);
  await expectAccessible(page, 'yellow close box, light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(status).toHaveCSS('background-color', 'rgb(43, 35, 18)');
  await expectAccessible(page, 'yellow close box, dark');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await shots(page, box, 'yellow');

  const again = box.getByRole('button', { name: 'Predict again' });
  await again.focus();
  await expect(again).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box.getByRole('button', { name: 'Lock in my prediction' })).toBeVisible();
  await expect(box.locator('textarea')).toHaveValue('');
  await expect(box.getByRole('status')).toHaveCount(0);
  await box.locator('textarea').fill('3 -3 1\n3.5');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const green = box.getByRole('status').filter({ hasText: 'Your prediction was right.' });
  await expect(green).toBeVisible();
  await expect(green.locator('svg')).toHaveAttribute('data-icon', 'check');
  await expect(box.getByText('You predicted')).toHaveCount(0);
});

test('a wrong prediction on int-division is red, with both boxes, in light and dark', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  await box.locator('textarea').fill('nope');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const status = box.getByRole('status').filter({ hasText: 'Not quite.' });
  await expect(status).toContainText('Not quite.');
  await expect(status.locator('svg')).toHaveAttribute('data-icon', 'cross');
  await expect(box.getByText('You predicted', { exact: true })).toBeVisible();
  await expect(box.getByText('Actual output', { exact: true })).toBeVisible();
  await expect(box.locator('[data-compare="predicted"]')).toContainText('nope');
  await expect(box.locator('[data-compare="actual"] [data-line]')).toHaveCount(2);
  await expectMonoCompare(box);
  await expect(status).toHaveCSS('background-color', 'rgb(253, 236, 235)');
  await expectAccessible(page, 'red prediction box, light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(status).toHaveCSS('background-color', 'rgb(50, 24, 22)');
  await expectAccessible(page, 'red prediction box, dark');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await shots(page, box, 'red');
});
