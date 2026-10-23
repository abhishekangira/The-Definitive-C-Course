// Lesson 1 has one actual prediction and three "Check your understanding" questions; all four are scored.
// Nested CompilerError fences are predict=none (#106 owner clarification).
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { availableModules, expectAccessible } from './lib';
import { nativeFor } from '../src/interactions/platform';
import { lessonChoiceIds } from '../tools/mdx/remark-course';

const mod = availableModules()[0];
const lesson = mod.lessons.find(l => l.stem === '01-hello-compiled-world')!;
const sample = mod.samples.samples['hello-two-lines'];
const MDX = readFileSync(path.join(mod.base, mod.dir, 'lessons', `${lesson.stem}.mdx`), 'utf8');
/** Each <Choice>'s answer index, in document order. */
const QUIZ_ANSWERS = [...MDX.matchAll(/^<Choice\b[\s\S]*?\banswer=\{(\d+)\}/gm)].map(m => Number(m[1]));
/** Each <Choice>'s qid (a hash of its question, as remark-course assigns it), in document order. */
const QIDS = lessonChoiceIds(MDX);
const quizRight = (at: string) => Object.fromEntries(QUIZ_ANSWERS.map((a, i) => [`${lesson.id}#${QIDS[i]}`, { picked: a, correct: true, at }]));
async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  mkdirSync(process.env.SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: false });
}
async function answerQuestion(page: Page, q: number) {
  const box = page.locator(`[data-interaction="choice"][data-qid="${QIDS[q]}"]`);
  await box.locator('input[type=radio]').nth(QUIZ_ANSWERS[q]).check();
  await box.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
  return box;
}
const visibleDabFrames = (overlay: Locator) => overlay.locator('[data-dab-frame]').evaluateAll(els => els.filter(e => getComputedStyle(e).opacity !== '0').map(e => e.getAttribute('data-dab-frame')));

test('the lesson has the quiz questions the spec answers', () => { expect(QUIZ_ANSWERS).toHaveLength(3); expect(QIDS).toHaveLength(3); });

for (const theme of ['light', 'dark'] as const) for (const width of [1400, 390]) {
  test(`perfect needs the quiz too; the overlay stays until closed: ${theme}, ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
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
    await box.getByRole('button', { name: 'Reveal the result' }).click();
    await expect(box.getByText('Your prediction was right.', { exact: true })).toBeVisible();
    // The M1 L1 bug: the exact prediction alone used to celebrate before the quiz.
    await page.waitForTimeout(300); await expect(overlay).toBeHidden();
    await answerQuestion(page, 0); await answerQuestion(page, 1);
    await page.waitForTimeout(300); await expect(overlay).toBeHidden();
    const last = await answerQuestion(page, 2);
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-perfect-close]')).toBeFocused();
    await expect(overlay.getByRole('heading', { name: 'Perfect lesson!', exact: true })).toBeVisible();
    await expect(overlay.locator('[data-perfect-hint]')).toHaveText('Every prediction and quiz question right on the first try. Press Esc or Close to continue.');
    await expect(overlay.locator('[data-aura="blaze"]').first()).toBeAttached();
    await expect(overlay.locator('[data-dab]')).toBeVisible();
    // Confetti over the whole viewport, behind the panel, still falling later.
    const layer = overlay.locator('[data-confetti]');
    const rect = await layer.boundingBox();
    expect(rect!.width).toBeGreaterThanOrEqual(width - 1); expect(rect!.height).toBeGreaterThanOrEqual(899);
    await expect.poll(() => layer.locator('i').count()).toBeGreaterThan(4);
    await page.waitForTimeout(1200);
    await shot(page, `perfect-overlay-${theme}-${width}`);
    // No click-anywhere, no any-key, no auto-close.
    // (Enter or Space would activate the focused Close button, which is a deliberate close.)
    await page.keyboard.press('a'); await page.keyboard.press('ArrowDown');
    await page.mouse.click(4, 4);
    await page.waitForTimeout(3000);
    await expect(overlay).toBeVisible();
    expect(await layer.locator('i').count()).toBeGreaterThan(0);
    expect(await layer.locator('i').count()).toBeLessThanOrEqual(40);
    await expectAccessible(page, `perfect overlay ${theme}`);
    await overlay.locator('[data-perfect-close]').click();
    await expect(overlay).toBeHidden();
    await expect(page.locator('[data-confetti]')).toHaveCount(0);
    await expect(last.getByRole('button', { name: 'Check again' })).toBeFocused();
    await expect(page.locator('[data-prediction-count]')).toHaveText('4 of 4 predictions and quiz questions right');
    await page.locator('[data-prediction-count]').scrollIntoViewIfNeeded(); await shot(page, `perfect-count-${theme}-${width}`);
    await page.goto(`#/m/${mod.id}`);
    const mark = page.getByRole('img', { name: 'Perfect lesson', exact: true });
    await expect(mark).toHaveCount(1); await mark.scrollIntoViewIfNeeded(); await shot(page, `perfect-mark-${theme}-${width}`);
    await page.goto('#/'); await expect(page.locator('[data-perfect-total]')).toContainText('Perfect lessons: 1 of');
    await page.locator('[data-perfect-total]').scrollIntoViewIfNeeded();
    await shot(page, `perfect-course-${theme}-${width}`);
    // Predict again keeps the first try: still perfect, and no second celebration.
    await page.goto(`#/m/${mod.id}/${lesson.stem}`);
    await box.getByRole('button', { name: 'Predict again', exact: true }).click();
    await expect(page.locator('[data-prediction-count]')).toHaveText('4 of 4 predictions and quiz questions right');
    await page.goto(`#/m/${mod.id}`); await expect(mark).toHaveCount(1);
  });
}

test('a wrong first quiz answer is never perfect, even after Check again', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const at = new Date().toISOString();
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: { 'm01-l1': Array.from({ length: 30 }, (_, i) => i) }, lessons: {}, samples: {}, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  });
  await page.goto(`#/m/${mod.id}/${lesson.stem}`);
  await answerQuestion(page, 0); await answerQuestion(page, 1);
  const q = page.locator(`[data-interaction="choice"][data-qid="${QIDS[2]}"]`);
  await q.locator('input[type=radio]').nth(QUIZ_ANSWERS[2] === 0 ? 1 : 0).check();
  await q.getByRole('button', { name: 'Check', exact: true }).click();
  await q.locator('input[type=radio]').nth(QUIZ_ANSWERS[2]).check();
  await q.getByRole('button', { name: 'Check again', exact: true }).click();
  const box = page.locator('[data-sample="hello-two-lines"]');
  await box.locator('textarea').fill(sample.answer.stdout);
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Reveal the result' }).click();
  await expect(box.getByText('Your prediction was right.', { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: 'Perfect lesson!', exact: true })).toBeHidden();
});

test('reduced motion: no confetti, a still dab hold and a static title, open until Esc', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.addInitScript(({ choices }) => {
    const at = new Date().toISOString();
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: {}, lessons: {}, samples: {}, choices, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  }, { choices: quizRight(new Date().toISOString()) });
  await page.goto(`#/m/${mod.id}/${lesson.stem}`);
  const box = page.locator('[data-sample="hello-two-lines"]');
  await box.locator('textarea').fill(sample.answer.stdout); await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Reveal the result' }).click();
  const overlay = page.getByRole('dialog', { name: 'Perfect lesson!', exact: true }); await expect(overlay).toBeVisible();
  await expect(overlay.locator('[data-confetti]')).toHaveCount(0); await expect(overlay.locator('[data-aura="blaze"]').first()).toBeAttached();
  expect(await visibleDabFrames(overlay)).toEqual(['2']);
  const animated = await overlay.evaluate(el => [el, ...el.querySelectorAll('*')].filter(n => getComputedStyle(n).animationName !== 'none').map(n => n.tagName));
  expect(animated).toEqual([]);
  await page.clock.runFor(60_000); await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape'); await expect(overlay).toBeHidden();
  await expect(box.getByRole('button', { name: 'Reveal the result' })).toBeFocused();
});

test('browser compilation finishes before celebrating, and Run regains focus', async ({ page }) => {
  test.setTimeout(180_000);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/toolchain/**', async route => { await gate; await route.continue().catch(() => {}); });
  await page.addInitScript(({ choices }) => {
    const at = new Date().toISOString();
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: {}, cards: {}, lessons: {}, samples: {}, choices, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  }, { choices: quizRight(new Date().toISOString()) });
  try {
    await page.goto(`#/m/${mod.id}/${lesson.stem}`);
    const box = page.locator('[data-sample="hello-two-lines"]');
    await box.locator('textarea').fill(sample.answer.stdout);
    await box.getByRole('button', { name: 'Lock in my prediction' }).click();
    const run = box.locator('button').filter({ hasText: /^(Run|Run again)$/ });
    await run.click(); await expect(run).toBeDisabled();
    const overlay = page.getByRole('dialog', { name: 'Perfect lesson!', exact: true });
    await expect(overlay).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('tdcc:v1:perfect-seen'))).toBeNull();
    release();
    await expect(overlay).toBeVisible({ timeout: 120_000 });
    await expect(run).toBeEnabled(); await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden(); await expect(run).toBeFocused();
  } finally { release(); }
});


test('the last 64-bit check restores focus to the new retry control', async ({ page }) => {
  test.setTimeout(60_000);
  const stem = '02-types-are-layouts';
  const entries = Object.values(mod.samples.samples).filter(s => s.lesson === stem);
  const target = entries.find(s => s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none')!;
  const at = new Date().toISOString();
  const samples = Object.fromEntries(entries.map(s => [s.id, { prediction: s.answer.stdout, correct: true, verdict: 'exact', at,
    ...(s.id !== target.id && s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none'
      ? { predict64: nativeFor(s, undefined).run?.stdout, predict64Correct: true, predict64Verdict: 'exact' } : {}),
  }]));
  await page.addInitScript(({ samples, at }) => {
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: { 'm01-l2': Array.from({ length: 30 }, (_, i) => i) }, lessons: {}, samples, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  }, { samples, at });
  await page.goto(`#/m/${mod.id}/${stem}`);
  const box = page.locator(`[data-sample="${target.id}"]`);
  await box.locator('textarea').fill(nativeFor(target, undefined).run!.stdout);
  await box.getByRole('button', { name: 'Check my 64-bit prediction' }).click();
  const overlay = page.getByRole('dialog', { name: 'Perfect lesson!', exact: true }); await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape'); await expect(overlay).toBeHidden();
  await expect(box.getByRole('button', { name: 'Predict the 64-bit output again' })).toBeFocused();
});
