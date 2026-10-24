// <CompilerError session="…"> in the real app over the m97 fixture sessions that tools/verify wrote (served by
// e2e/sessions-fixture.ts): report tabs, a wrong answer marked wrong on each grading path, keyboard use, axe, and the
// fix checked by the real browser compiler (UBSan guardrail, leakcheck). The expected line is never typed here: it is
// the `bug:` line of each fixture session.yaml, which tools/verify checks against every Linux report.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SessionsFile } from '../src/content-model/types';
import { answerQuiz, completeLesson, dismissPerfectLesson, expectAccessible, fixtureModule, progressJson, ROOT, setEditor } from './lib';

import { FIXTURE, startSessionsFixture } from './sessions-fixture';

const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);

const m97 = JSON.parse(readFileSync(path.join(ROOT, 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
// The oracle: the `bug: <file>:<line>` key in the fixture session's session.yaml, never a comment in the C file.
const bug = (id: string) => {
  const doc = parseYaml(readFileSync(path.join(ROOT, 'tools/verify/fixtures/content/modules/m97-sessions/sessions', id, 'session.yaml'), 'utf8')) as { bug: string };
  const [file, line] = doc.bug.split(':');
  return { file, line: Number(line) };
};
const seed = (stored: boolean) => JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: '2026-01-01T00:00:00.000Z', settings: { storedOutputMode: stored } });

let fixture: Awaited<ReturnType<typeof startSessionsFixture>>;
test.beforeAll(async () => { fixture = await startSessionsFixture(); });
test.afterAll(async () => { await fixture?.close(); });

/** Opens the reports lesson; `stored` keeps the page from downloading the compiler (every test but the fix one). */
async function openReports(page: Page, stored = true): Promise<void> {
  await page.context().addInitScript(json => { try { if (!localStorage.getItem('tdcc:v1:progress')) localStorage.setItem('tdcc:v1:progress', json); } catch { /* no storage */ } }, seed(stored));
  await page.goto(`${fixture.url}#/m/m97/02-reports`);
  await expect(page.getByRole('heading', { level: 1, name: 'Reading tool reports' })).toBeVisible();
}
const ce = (page: Page, session: string) => page.locator(`[data-interaction="compiler-error"][data-session="${session}"]`);
const stage = (box: Locator, label: string) => box.locator('[data-question="stage"]').getByRole('radio', { name: label, exact: true });
const kind = (box: Locator, i: number) => box.locator('form fieldset').first().getByRole('radio').nth(i);

test.describe('<CompilerError session> over stored native reports', () => {
  test.setTimeout(180_000); // the first page load compiles the app on demand; the fix test downloads the compiler

  test('report tabs by tool, and a wrong line, kind or stage is marked wrong', async ({ page }) => {
    await openReports(page);
    const asan = ce(page, 'asan');
    await expect(asan.getByRole('tab')).toHaveText(['Linux/WSL · gcc 13 · ASan', 'Linux/WSL · clang 22 · ASan']);
    await expect(asan.getByRole('tabpanel')).toContainText('AddressSanitizer: stack-buffer-overflow');
    await expect(asan.locator('[data-pending]')).toHaveText('No stored run for macOS · Apple clang.');
    const right = bug('asan').line;
    await asan.locator(`label[data-line="${right + 1}"]`).click();
    await expect(asan.locator('[data-line-right]')).toHaveAttribute('data-line-right', 'false');
    await asan.locator(`label[data-line="${right}"]`).click();
    await expect(asan.getByText('Yes: its first frame in your code says so.')).toBeVisible();
    await kind(asan, 1).check();
    await stage(asan, 'Run').check();
    await asan.getByRole('button', { name: 'Check' }).click();
    await expect(asan.getByRole('status')).toContainText('Not quite.');
    await kind(asan, 0).check();
    await expect(asan.getByRole('status')).toContainText('Correct.');

    const link = ce(page, 'link-undefined');
    await expect(link.locator('[data-line]')).toHaveCount(0); // a link error has no line to ask about
    await expect(link.getByRole('tab')).toHaveText(['Linux/WSL · gcc 13 · ld', 'Linux/WSL · clang 22 · ld']);
    await kind(link, 0).check();
    await stage(link, 'Compile').check();
    await link.getByRole('button', { name: 'Check' }).click();
    await expect(link.getByRole('status')).toContainText('Not quite: look again at which stage stopped.');
    await stage(link, 'Link').check();
    await expect(link.getByRole('status')).toContainText('Correct.');
  });

  test('is operated with the keyboard: tabs, the report box, the lines, the answers and Check', async ({ page }) => {
    await openReports(page);
    const asan = ce(page, 'asan');
    const [gcc, clang] = [asan.getByRole('tab').nth(0), asan.getByRole('tab').nth(1)];
    await gcc.focus();
    await page.keyboard.press('ArrowRight');
    await expect(clang).toHaveAttribute('aria-selected', 'true');
    await expect(asan.getByRole('tabpanel')).toContainText('main.c:5:39');
    await page.keyboard.press('Tab');
    await expect(asan.getByRole('tabpanel')).toBeFocused();
    await page.keyboard.press('Tab'); // the report's "Wrap lines" toggle
    await expect(asan.getByRole('button', { name: 'Wrap lines' })).toBeFocused();
    await page.keyboard.press('Tab'); // the first line of the source (a radio group: arrows move and select)
    await expect(asan.getByRole('radio', { name: /^Line 1:/ })).toBeFocused();
    for (let i = 1; i < bug('asan').line; i++) await page.keyboard.press('ArrowDown');
    await expect(asan.getByText('Yes: its first frame in your code says so.')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(kind(asan, 0)).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown'); // the stage group: Preprocess → Compile
    await expect(stage(asan, 'Compile')).toBeChecked();
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    await expect(asan.getByRole('button', { name: 'Check' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(asan.getByRole('status')).toBeVisible();
  });

  test('passes axe in light and dark with the answers shown, and fits a phone screen', async ({ page }) => {
    await openReports(page);
    const asan = ce(page, 'asan');
    await asan.locator(`label[data-line="${bug('asan').line + 1}"]`).click();
    await kind(asan, 1).check();
    await stage(asan, 'Link').check();
    await asan.getByRole('button', { name: 'Check' }).click();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectAccessible(page, `the reports lesson with wrong answers (${colorScheme})`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-interaction="compiler-error"]').withRules(['scrollable-region-focusable']).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
  });

  test('the fix is checked by the browser compiler: UBSan guardrail and leakcheck reject the broken program', async ({ page }) => {
    await openReports(page, false);
    // The lesson shows one card at a time: answer the first two (no fix step) to reach the ones with a fix.
    for (const [id, st] of [['asan', 'Run'], ['link-undefined', 'Link']] as const) {
      const box = ce(page, id);
      if (id === 'asan') await box.locator(`label[data-line="${bug(id).line}"]`).click();
      await kind(box, 0).check();
      await stage(box, st).check();
      await box.getByRole('button', { name: 'Check' }).click();
      await expect(box.getByRole('status')).toContainText('Correct.');
      // The first answers are scored now, so a right Check can open the perfect-lesson dialog (modal).
      await dismissPerfectLesson(page);
    }
    for (const [id, file, still, fixed, done] of [
      ['ubsan', 'main.c', 'It still stops with an error', (s: string) => s.replace('big + 1', 'big - 1'), 'and runs with no undefined behaviour'],
      ['valgrind-leak', 'l.c', 'It still leaks', (s: string) => s.replace('return p[0] - 1;', 'int r = p[0] - 1;\n    free(p);\n    return r;'), 'and leaks nothing'],
    ] as const) {
      const box = ce(page, id);
      await box.locator(`label[data-line="${bug(id).line}"]`).click();
      await kind(box, 0).check();
      await stage(box, 'Run').check();
      await box.getByRole('button', { name: 'Check' }).click();
      await dismissPerfectLesson(page);
      const check = box.getByRole('button', { name: 'Compile and check' });
      await check.click(); // the stored program, unchanged
      await expect(box.getByText(still)).toBeVisible({ timeout: RUN_TIMEOUT });
      await setEditor(page, box, fixed(m97.sessions[id].sources[file]));
      await check.click();
      await expect(box.getByText(`Fixed: it compiles cleanly ${done}.`)).toBeVisible({ timeout: RUN_TIMEOUT });
      await box.getByRole('button', { name: 'Continue' }).click();
    }
  });

  test('click-through: every fixture lesson and the checkpoint complete with answers read from generated data', async ({ browser }) => {
    // The same completeLesson as the course click-through (course.spec.ts), so a session CompilerError in real content is
    // answered the same way: the line from the stored report, the fix from the nested fixed fence.
    const mod = fixtureModule(FIXTURE, 'm97');
    const context = await browser.newContext({ baseURL: fixture.url });
    await context.addInitScript(json => { try { if (!localStorage.getItem('tdcc:v1:progress')) localStorage.setItem('tdcc:v1:progress', json); } catch { /* no storage */ } }, seed(false));
    const page = await context.newPage();
    for (const lesson of mod.lessons) {
      await completeLesson(page, mod, lesson.stem);
      expect((await progressJson(page)).lessons?.[lesson.id], `${lesson.stem} marked complete`).toBeTruthy();
    }
    // The checkpoint's sp, session ce and session order items, answered by the same answerQuiz as course.spec.ts:
    // sp from the trace, order from the stored run, ce from the authored answer and stage.
    // A fresh document: the dev server can optimise dependencies late (after the lessons' editor loads), and a hash-only
    // navigation would keep the old module graph (two Reacts: "Cannot read properties of null (reading 'useContext')").
    await page.goto('#/m/m97');
    await page.reload();
    await page.getByRole('link', { name: 'Take the checkpoint' }).click();
    await answerQuiz(page, mod, 'checkpoint');
    await page.getByRole('button', { name: 'Submit checkpoint' }).click();
    await expect(page.getByText(/Checkpoint passed/)).toBeVisible();
    expect((await progressJson(page)).quizzes?.['m97:checkpoint']).toMatchObject({ score: mod.quiz('checkpoint').length, passed: true });
    await context.close();
  });
});
