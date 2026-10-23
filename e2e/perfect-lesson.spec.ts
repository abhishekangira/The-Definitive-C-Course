// Lesson 1 has one actual prediction. Nested CompilerError fences are predict=none (#106 owner clarification).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { availableModules, expectAccessible } from './lib';

const mod = availableModules()[0];
const lesson = mod.lessons.find(l => l.stem === '01-hello-compiled-world')!;
const sample = mod.samples.samples['hello-two-lines'];
async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  mkdirSync(process.env.SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: true });
}

for (const theme of ['light', 'dark'] as const) for (const width of [1400, 390]) {
  test(`perfect reveal, reset and accessible overlay: ${theme}, ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.addInitScript(({ theme }) => {
      localStorage.setItem('tdcc:v1:theme', theme);
      if (localStorage.getItem('tdcc:v1:progress')) return;
      const at = new Date().toISOString();
      localStorage.setItem('tdcc:v1:progress', JSON.stringify({
        version: 1, seed: '00e2e00e2e00e2e0', createdAt: at, settings: { storedOutputMode: true, theme },
        cards: { 'm01-l1': Array.from({ length: 30 }, (_, i) => i) }, lessons: { 'm01-l1': { completedAt: at } },
        samples: {}, exercises: {}, quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 },
      }));
    }, { theme });
    await page.goto(`#/m/${mod.id}/${lesson.stem}`);
    const box = page.locator('[data-sample="hello-two-lines"]');
    await box.locator('textarea').fill(sample.answer.stdout);
    await box.getByRole('button', { name: 'Lock in my prediction' }).click();
    const overlay = page.getByRole('dialog', { name: 'Perfect lesson!', exact: true });
    await expect(overlay).toBeHidden();
    const reveal = box.getByRole('button', { name: 'Reveal the result' });
    await reveal.click();
    await expect(overlay).toBeVisible();
    await page.clock.runFor(1000);
    await expect(overlay.locator('[data-aura="blaze"]')).toBeVisible();
    await expectAccessible(page, `perfect overlay ${theme}`);
    await shot(page, `perfect-overlay-${theme}-${width}`);
    await page.keyboard.press('Escape'); await expect(overlay).toBeHidden(); await expect(reveal).toBeFocused();
    await reveal.click(); await expect(overlay).toBeHidden();
    await expect(page.locator('[data-prediction-count]')).toHaveText('1 of 1 predictions right');
    await page.locator('[data-prediction-count]').scrollIntoViewIfNeeded(); await shot(page, `perfect-count-${theme}-${width}`);
    await page.goto(`#/m/${mod.id}`);
    const mark = page.getByRole('img', { name: 'Perfect lesson', exact: true });
    await expect(mark).toHaveCount(1); await shot(page, `perfect-mark-${theme}-${width}`);
    await page.goto('#/'); await expect(page.locator('[data-perfect-total]')).toContainText('Perfect lessons: 1 of');
    await shot(page, `perfect-course-${theme}-${width}`);
    await page.goto(`#/m/${mod.id}/${lesson.stem}`);
    await box.getByRole('button', { name: 'Predict again', exact: true }).click();
    await expect(page.locator('[data-prediction-count]')).toHaveText('0 of 1 predictions right');
    await page.goto(`#/m/${mod.id}`); await expect(mark).toHaveCount(0);
  });
}

test('reduced motion keeps a still powered-up Rio for four seconds', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.addInitScript(() => {
    const at = new Date().toISOString();
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: {}, lessons: {}, samples: {}, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  });
  await page.goto(`#/m/${mod.id}/${lesson.stem}`);
  const box = page.locator('[data-sample="hello-two-lines"]');
  await box.locator('textarea').fill(sample.answer.stdout); await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Reveal the result' }).click();
  const overlay = page.getByRole('dialog', { name: 'Perfect lesson!', exact: true }); await expect(overlay).toBeVisible();
  await expect(overlay.locator('[data-confetti]')).toHaveCount(0); await expect(overlay.locator('[data-aura="blaze"]')).toBeVisible();
  const animated = await overlay.evaluate(el => [el, ...el.querySelectorAll('*')].filter(n => getComputedStyle(n).animationName !== 'none').map(n => n.tagName));
  expect(animated).toEqual([]);
  await page.clock.runFor(3999); await expect(overlay).toBeVisible();
  await page.clock.runFor(1); await expect(overlay).toBeHidden();
});
