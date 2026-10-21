// QuizRunner's sp, session ce and session order items in the real app, on the m97 fixture checkpoint
// (e2e/fixtures/sessions): a wrong answer marked wrong on each grading path, keyboard use, axe in light and dark, and a
// phone-width layout. Answers come from generated data only: the add-frames gdb trace and tools/verify's m97 sessions.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SessionsFile, TraceFile } from '../src/content-model/types';
import { spSteps } from '../src/interactions/quiz-answers';
import { arrangeOrder, expectAccessible, fixtureModule, ROOT } from './lib';
import { FIXTURE, startSessionsFixture } from './sessions-fixture';

const m97 = JSON.parse(readFileSync(path.join(ROOT, 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
const trace = JSON.parse(readFileSync(path.join(ROOT, 'src/generated/traces/add-frames.json'), 'utf8')) as TraceFile;
const mod = fixtureModule(FIXTURE, 'm97');
const item = (id: string) => mod.quiz('checkpoint').find(i => i.id === id)!;
const MAKE = m97.sessions.make.runs['linux-gcc']!.map(s => s.cmd);

let fixture: Awaited<ReturnType<typeof startSessionsFixture>>;
test.beforeAll(async () => { fixture = await startSessionsFixture(); });
test.afterAll(async () => { await fixture?.close(); });

/** Opens the checkpoint with every fixture lesson complete (what unlocks it). */
async function openCheckpoint(page: Page): Promise<void> {
  const lessons = Object.fromEntries(mod.lessons.map(l => [l.id, { completedAt: '2026-01-01T00:00:00.000Z' }]));
  const json = JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: '2026-01-01T00:00:00.000Z', settings: { storedOutputMode: true }, lessons });
  await page.context().addInitScript(j => { try { if (!localStorage.getItem('tdcc:v1:progress')) localStorage.setItem('tdcc:v1:progress', j); } catch { /* no storage */ } }, json);
  await page.goto(`${fixture.url}#/m/m97/checkpoint`);
  await expect(page.getByRole('heading', { level: 1, name: 'Checkpoint' })).toBeVisible();
  await expect(page.locator('[data-quiz-item="q-sp-step-into"] ol[aria-label^="Program"]')).toBeVisible();
}
const box = (page: Page, id: string) => page.locator(`[data-quiz-item="${id}"]`);
const submit = (b: Locator) => b.getByRole('button', { name: 'Submit answer' }).click();
const kind = (b: Locator, i: number) => b.locator('form fieldset').first().getByRole('radio').nth(i);
const stage = (b: Locator, label: string) => b.locator('[data-question="stage"]').getByRole('radio', { name: label, exact: true });

test.describe('QuizRunner sp and session-backed items', () => {
  test.setTimeout(120_000); // the first page load compiles the app on demand

  test('a wrong answer is marked wrong on each grading path: sp line, ce kind, ce stage, order', async ({ page }) => {
    await openCheckpoint(page);
    const sp = box(page, 'q-sp-step-into');
    const at = spSteps(trace, item('q-sp-step-into').line!)!;
    const over = trace.source.split('\n').findIndex(l => l.includes('printf')) + 1; // where `next` would stop
    expect(over).not.toBe(at.next.line);
    await sp.getByRole('button', { name: new RegExp(`^Line ${over}: `) }).click();
    await submit(sp);
    await expect(sp.getByText('Not quite.', { exact: true })).toBeVisible();
    await expect(sp.locator('li[class*="wrong"]')).toContainText('printf');
    await expect(sp.getByText(`After step: line ${at.next.line} is about to run.`, { exact: false })).toBeVisible();

    const link = box(page, 'q-ce-link');
    await kind(link, 1).check();
    await stage(link, 'Link').check();
    await submit(link);
    await expect(link.getByText('Not quite.', { exact: true })).toBeVisible();

    const asan = box(page, 'q-ce-asan');
    await kind(asan, 0).check();
    await stage(asan, 'Compile').check();
    await submit(asan);
    await expect(asan.getByText('Not quite.', { exact: true })).toBeVisible();
    await expect(asan.locator('[data-stage-right="false"]')).toContainText('The stage that failed: Run.');

    const order = box(page, 'q-order-make');
    await expect(order.getByRole('tabpanel')).toHaveCount(0); // the stored run would give the order away
    await arrangeOrder(order, [MAKE[1], MAKE[0], ...MAKE.slice(2)]);
    await submit(order);
    await expect(order.getByText('Not quite.', { exact: true })).toBeVisible();
    await expect(order.locator('[data-place-right="false"]')).toHaveCount(2);
    await expect(order.getByRole('tabpanel')).toContainText('make -f spaces.mk');
    await page.screenshot({ path: test.info().outputPath('wrong-answers.png'), fullPage: true });
  });

  test('is answered with the keyboard alone, and the right answers are marked right', async ({ page }) => {
    await openCheckpoint(page);
    const sp = box(page, 'q-sp-step-into');
    const at = spSteps(trace, item('q-sp-step-into').line!)!;
    await sp.getByRole('button', { name: /^Line 1: / }).focus();
    for (let n = 1; n < at.next.line; n++) await page.keyboard.press('Tab');
    await expect(sp.getByRole('button', { name: new RegExp(`^Line ${at.next.line}: `) })).toBeFocused();
    await page.keyboard.press('Enter');
    // Every line is a button (as in the Stepper's "which line runs next?"); Submit comes after the last one.
    const lines = trace.source.replace(/\n$/, '').split('\n').length;
    for (let n = at.next.line; n <= lines; n++) await page.keyboard.press('Tab');
    await expect(sp.getByRole('button', { name: 'Submit answer' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sp.getByText('Correct.', { exact: true })).toBeVisible();

    // ce: the report's tabs are arrow keys; the radios take Space; the stage group is next in Tab order.
    const link = box(page, 'q-ce-link');
    await link.getByRole('tab').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(link.getByRole('tab').nth(1)).toBeFocused();
    await kind(link, 0).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(stage(link, 'Preprocess')).toBeFocused();
    for (let n = 0; n < 3; n++) await page.keyboard.press('ArrowDown');
    await expect(stage(link, 'Link')).toBeChecked();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(link.getByText('Correct.', { exact: true })).toBeVisible();

    // order: Move up buttons with Enter (arrangeOrder uses only the keyboard). Moving a row to the top disables its
    // Move up button; focus goes to its Move down button instead of the page.
    const order = box(page, 'q-order-make');
    const second = (await order.locator('ol > li > span:first-child').allTextContents())[1];
    await order.getByRole('button', { name: `Move up: ${second}`, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(order.getByRole('button', { name: `Move down: ${second}`, exact: true })).toBeFocused();
    await arrangeOrder(order, MAKE);
    await order.getByRole('button', { name: 'Submit answer' }).focus();
    await page.keyboard.press('Enter');
    await expect(order.getByText('Correct.', { exact: true })).toBeVisible();
    await expect(order.locator('[data-place-right="true"]')).toHaveCount(MAKE.length);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`passes axe in ${theme} before and after answering, and fits a phone screen`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await openCheckpoint(page);
      await expectAccessible(page, `checkpoint (${theme})`);
      for (const id of ['q-sp-step-into', 'q-ce-link', 'q-ce-asan']) {
        const b = box(page, id);
        if (id === 'q-sp-step-into') await b.getByRole('button', { name: /^Line 9: / }).click();
        else { await kind(b, 1).check(); await stage(b, 'Run').check(); }
        await submit(b);
      }
      await arrangeOrder(box(page, 'q-order-make'), MAKE);
      await submit(box(page, 'q-order-make'));
      await expect(box(page, 'q-order-make').getByText('Correct.', { exact: true })).toBeVisible();
      await expectAccessible(page, `checkpoint answered (${theme})`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no sideways page scroll at 390 px').toBeLessThanOrEqual(0);
    });
  }
});
