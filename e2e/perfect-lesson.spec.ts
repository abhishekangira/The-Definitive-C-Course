// Lesson 1 has one prediction, three "Check your understanding" questions and a CompilerError (a line and a
// what-is-wrong question); all six are scored first-try items. Nested CompilerError fences are predict=none.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { availableModules, expectAccessible } from './lib';
import { nativeFor } from '../src/interactions/platform';
import { lessonChoiceIds, lessonCompilerErrorIds } from '../tools/mdx/remark-course';

const mod = availableModules()[0];
const lesson = mod.lessons.find(l => l.stem === '01-hello-compiled-world')!;
const sample = mod.samples.samples['hello-two-lines'];
const MDX = readFileSync(path.join(mod.base, mod.dir, 'lessons', `${lesson.stem}.mdx`), 'utf8');
/** Each <Choice>'s answer index, in document order. */
const QUIZ_ANSWERS = [...MDX.matchAll(/^<Choice\b[\s\S]*?\banswer=\{(\d+)\}/gm)].map(m => Number(m[1]));
/** Each <Choice>'s qid (a hash of its question, as remark-course assigns it), in document order. */
const QIDS = lessonChoiceIds(MDX);
const quizRight = (at: string) => Object.fromEntries(QUIZ_ANSWERS.map((a, i) => [`${lesson.id}#${QIDS[i]}`, { picked: a, correct: true, at }]));
/** The compiler-error exercise's scored question ids (the line and the what-is-wrong question). */
const REPORT_QIDS = lessonCompilerErrorIds(MDX);
const REPORT_SAMPLE = mod.samples.samples['missing-semicolon'];
/** The line the browser's diagnostic points at, never typed. */
const REPORT_LINE = REPORT_SAMPLE.results['wasm32-clang22']!.compile.diagnostics.find(d => d.severity !== 'note')!.line;
/** The authored answer of the one <CompilerError> in the lesson. */
const REPORT_ANSWER = Number(/<CompilerError\b[\s\S]*?\banswer=\{(\d+)\}/.exec(MDX)![1]);
const reportRight = (at: string) => Object.fromEntries(REPORT_QIDS.map(qid => [`${lesson.id}#${qid}`, { correct: true, at }]));
/** Lesson 2's compiler-error questions, seeded right by the 64-bit focus test. */
const LESSON2 = '02-types-are-layouts';
const REPORT_QIDS2 = lessonCompilerErrorIds(readFileSync(path.join(mod.base, mod.dir, 'lessons', `${LESSON2}.mdx`), 'utf8'));

/** Answers the compiler-error questions right on the first try (a wrong one could never be perfect). */
async function answerReport(page: Page) {
  const box = page.locator('[data-interaction="compiler-error"][data-sample="missing-semicolon"]');
  await box.locator(`label[data-line="${REPORT_LINE}"]`).click();
  await box.locator('[data-question="kind"] input').nth(REPORT_ANSWER).check();
  // The line is scored with the kind on Check; its verdict is hidden until then.
  await box.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(box.locator('[data-line-right="true"]')).toBeVisible();
  await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
  return box;
}
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
    // The compiler-error questions are scored too: answering them right is still not enough while the quiz is open.
    await answerReport(page);
    await page.waitForTimeout(300); await expect(overlay).toBeHidden();
    await answerQuestion(page, 0); await answerQuestion(page, 1);
    await page.waitForTimeout(300); await expect(overlay).toBeHidden();
    const last = await answerQuestion(page, 2);
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-perfect-close]')).toBeFocused();
    await expect(overlay.getByRole('heading', { name: 'Perfect lesson!', exact: true })).toBeVisible();
    // Three kinds (prediction, quiz and compiler-error questions): the neutral wording.
    await expect(overlay.locator('[data-perfect-hint]')).toHaveText('Every question right on the first try. Press Esc or Close to continue.');
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
    await expect(page.locator('[data-prediction-count]')).toHaveText('6 of 6 questions right');
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
    await expect(page.locator('[data-prediction-count]')).toHaveText('6 of 6 questions right');
    await page.goto(`#/m/${mod.id}`); await expect(mark).toHaveCount(1);
  });
}

/** Fresh progress on M1 L1 with stored output (no compiler), every card open and the retrieval quiz done. */
async function seedLesson(page: Page) {
  await page.addInitScript(() => {
    const at = new Date().toISOString();
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: { 'm01-l1': Array.from({ length: 30 }, (_, i) => i) }, lessons: {}, samples: {}, choices: {}, compilerErrors: {}, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  });
  await page.goto(`#/m/${mod.id}/${lesson.stem}`);
}

test('Ctrl+Enter and Cmd+Enter lock in and run in one step; an empty box does nothing', async ({ page }) => {
  test.setTimeout(60_000);
  await seedLesson(page);
  const box = page.locator('[data-sample="hello-two-lines"]');
  const area = box.locator('textarea').first();
  const describedBy = await area.getAttribute('aria-describedby');
  expect(describedBy, 'the hint is described by the textarea').toBeTruthy();
  const hint = page.locator(`[id="${describedBy}"]`);
  await expect(hint).toContainText('Ctrl+Enter');
  await expect(hint).toContainText('Cmd+Enter');
  await expect(hint.locator('kbd')).toHaveCount(4);
  // Empty: the shortcut does nothing (the disabled Lock in button's behaviour).
  await area.press('Control+Enter');
  await expect(box.getByRole('button', { name: 'Lock in my prediction' })).toBeVisible();
  await expect(area).toHaveValue('');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tdcc:v1:progress')!).samples['hello-two-lines'])).toBeUndefined();
  // Plain Enter is still a newline in the box, never a submit.
  await area.fill('first line');
  await area.press('Enter');
  await expect(area).toHaveValue('first line\n');
  await expect(box.getByRole('button', { name: 'Lock in my prediction' })).toBeVisible();
  // Ctrl+Enter locks in and runs (here: reveals the stored output) without a second click.
  await area.fill(sample.answer.stdout);
  await area.press('Control+Enter');
  await expect(box.getByText('Your prediction was right.', { exact: true })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Predict again' })).toBeVisible();
  // The form unmounted under the textarea; focus lands on the reveal button, as it does after clicking Run.
  await expect(box.getByRole('button', { name: 'Reveal the result' })).toBeFocused();
  // Cmd+Enter is the Mac spelling of the same shortcut.
  await box.getByRole('button', { name: 'Predict again' }).click();
  const again = box.locator('textarea').first();
  await again.fill(sample.answer.stdout);
  await again.press('Meta+Enter');
  await expect(box.getByText('Your prediction was right.', { exact: true })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Reveal the result' })).toBeFocused();
  // Even a wrong prediction (no celebration) keeps focus on the button rather than dropping it to <body>.
  await box.getByRole('button', { name: 'Predict again' }).click();
  const wrong = box.locator('textarea').first();
  await wrong.fill('not the output');
  await wrong.press('Control+Enter');
  await expect(box.getByText('Not quite.', { exact: true })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Reveal the result' })).toBeFocused();
});

test('arrow keys through wrong report lines save no first answer; Check saves the line right and the lesson stays perfect', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(({ choices, prediction, at }) => {
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: { 'm01-l1': Array.from({ length: 30 }, (_, i) => i) }, lessons: {},
      samples: { 'hello-two-lines': { prediction, correct: true, verdict: 'exact', first: 'exact', at } },
      choices, compilerErrors: {}, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  }, { choices: quizRight(new Date().toISOString()), prediction: sample.answer.stdout, at: new Date().toISOString() });
  await page.goto(`#/m/${mod.id}/${lesson.stem}`);
  const box = page.locator('[data-interaction="compiler-error"][data-sample="missing-semicolon"]');
  const line = (n: number) => box.getByRole('radio', { name: new RegExp(`^Line ${n}:`) });
  // A keyboard learner picks line 1, then arrows down through wrong lines, past the right one and back.
  await line(1).focus();
  await page.keyboard.press('Space');
  for (let i = 1; i < REPORT_LINE; i++) await page.keyboard.press('ArrowDown');
  await expect(line(REPORT_LINE)).toBeChecked();
  await page.keyboard.press('ArrowDown'); // the next line is wrong
  await page.keyboard.press('ArrowUp');
  await expect(line(REPORT_LINE)).toBeChecked();
  // Arrow keys check a radio, so onChange fires, but nothing is scored or shown until Check.
  await expect(box.locator('[data-line-right]')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tdcc:v1:progress')!).compilerErrors)).toEqual({});
  // Answer "what is wrong" with the keyboard too, then Check.
  const kinds = box.locator('[data-question="kind"] input');
  await kinds.first().focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < REPORT_ANSWER; i++) await page.keyboard.press('ArrowDown');
  await expect(kinds.nth(REPORT_ANSWER)).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(box.getByRole('button', { name: 'Check', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box.locator('[data-line-right="true"]')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tdcc:v1:progress')!).compilerErrors);
  expect(saved[`${lesson.id}#missing-semicolon:line`]).toMatchObject({ correct: true });
  expect(saved[`${lesson.id}#missing-semicolon:kind`]).toMatchObject({ correct: true });
  // The line was the last missing first try: the lesson is still perfect and celebrates.
  await expect(page.getByRole('dialog', { name: 'Perfect lesson!', exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) for (const width of [1400, 390]) {
  test(`the prediction shortcut hint passes axe: ${theme}, ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(() => {
      const at = new Date().toISOString();
      localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
        settings: { storedOutputMode: true }, cards: { 'm01-l1': Array.from({ length: 30 }, (_, i) => i) }, lessons: {}, samples: {}, choices: {}, compilerErrors: {}, exercises: {},
        quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
    });
    await page.goto(`?axe=${theme}-${width}#/m/${mod.id}/${lesson.stem}`);
    const area = page.locator('[data-sample="hello-two-lines"] textarea').first();
    await expect(area).toBeVisible();
    await expect(page.locator(`[id="${await area.getAttribute('aria-describedby')}"]`)).toBeVisible();
    await expectAccessible(page, `prediction shortcut hint ${theme} ${width}px`);
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
  await page.addInitScript(({ choices, compilerErrors }) => {
    const at = new Date().toISOString();
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: {}, lessons: {}, samples: {}, choices, compilerErrors, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  }, { choices: quizRight(new Date().toISOString()), compilerErrors: reportRight(new Date().toISOString()) });
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
  await page.addInitScript(({ choices, compilerErrors }) => {
    const at = new Date().toISOString();
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: {}, cards: {}, lessons: {}, samples: {}, choices, compilerErrors, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  }, { choices: quizRight(new Date().toISOString()), compilerErrors: reportRight(new Date().toISOString()) });
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
  const stem = LESSON2;
  const entries = Object.values(mod.samples.samples).filter(s => s.lesson === stem);
  const target = entries.find(s => s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none')!;
  const at = new Date().toISOString();
  const samples = Object.fromEntries(entries.map(s => [s.id, { prediction: s.answer.stdout, correct: true, verdict: 'exact', at,
    ...(s.id !== target.id && s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none'
      ? { predict64: nativeFor(s, undefined).run?.stdout, predict64Correct: true, predict64Verdict: 'exact' } : {}),
  }]));
  const compilerErrors = Object.fromEntries(REPORT_QIDS2.map(qid => [`m01-l2#${qid}`, { correct: true, at }]));
  await page.addInitScript(({ samples, at, compilerErrors }) => {
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
      settings: { storedOutputMode: true }, cards: { 'm01-l2': Array.from({ length: 30 }, (_, i) => i) }, lessons: {}, samples, compilerErrors, exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } }, projects: {}, streak: { days: [], longest: 0 } }));
  }, { samples, at, compilerErrors });
  await page.goto(`#/m/${mod.id}/${stem}`);
  const box = page.locator(`[data-sample="${target.id}"]`);
  await box.locator('textarea').fill(nativeFor(target, undefined).run!.stdout);
  await box.getByRole('button', { name: 'Check my 64-bit prediction' }).click();
  const overlay = page.getByRole('dialog', { name: 'Perfect lesson!', exact: true }); await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape'); await expect(overlay).toBeHidden();
  await expect(box.getByRole('button', { name: 'Predict the 64-bit output again' })).toBeFocused();
});
