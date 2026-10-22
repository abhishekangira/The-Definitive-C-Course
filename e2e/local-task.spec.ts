// Lesson 3.1 (Module 3, a draft opened through ?preview=m03): the LT card's download is the zip the learner runs `make test` in
// (compile_flags.txt and the learner seed included), the LT accepts only codes made with that seed, "my machine" is set from the
// lesson, and the module page has no problem set. axe runs in the light and the dark colour scheme. course.spec.ts completes
// the whole lesson with E2E_MODULE=m03; this spec runs in every e2e run, so LocalTask is covered before M3 is released.
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { COMPILE_FLAGS } from '../src/testing/project-zip';
import { parseLearnerFile } from '../src/testing/token';
import { clickThroughModules, completeChoice, completeLocalTask, expectAccessible, previewBase, progressJson, reachCard, seedPriorModules } from './lib';

const mod = clickThroughModules('m03')[0];
const STEM = '01-install-and-doctor';

async function axeBothSchemes(page: Page, what: string): Promise<void> {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expectAccessible(page, `${what} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: null });
}

test.describe.serial('m03 lesson 3.1: the doctor LT and "my machine"', () => {
  let page: Page;
  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: mod.preview ? previewBase(testInfo.project.use.baseURL, mod) : undefined, acceptDownloads: true });
    await seedPriorModules(context, mod); // Module 3 opens once Modules 1 and 2 are complete
    page = await context.newPage();
    page.on('pageerror', e => { throw e; });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the module page shows the lesson and no problem set', async () => {
    await page.goto(`#/m/${mod.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(mod.meta.title);
    expect(mod.meta.problemSet).toEqual([]);
    const steps = page.getByLabel('Module steps');
    await expect(steps.getByText('Project', { exact: true })).toBeVisible();
    await expect(steps.getByText(mod.lessons[0].title)).toBeVisible();
    await expect(steps.getByText('Problem set', { exact: true })).toHaveCount(0);
    await axeBothSchemes(page, 'm03 module page');
  });

  test('the LT download is the m03-doctor project with compile_flags.txt and this browser\'s seed', async () => {
    const card = await reachCard(page, mod, STEM, '[data-interaction="lt"]');
    const box = card.locator('[data-interaction="lt"]');
    await expect(box).toHaveAttribute('data-exercise', 'm03-doctor');
    await axeBothSchemes(page, 'm03 lesson 3.1, LT card before a token');
    const [download] = await Promise.all([page.waitForEvent('download'), box.getByRole('button', { name: 'Download m03-doctor.zip' }).click()]);
    expect(download.suggestedFilename()).toBe('m03-doctor.zip');
    const files = unzipSync(readFileSync((await download.path())!));
    expect(strFromU8(files['m03-doctor/compile_flags.txt'])).toBe(`${COMPILE_FLAGS.join('\n')}\n`);
    expect(Object.keys(files)).toContain('m03-doctor/hello.c');
    const learner = parseLearnerFile(strFromU8(files['m03-doctor/.learner']));
    expect(learner.exercise).toBe('m03-doctor');
    expect(learner.seed).toBe((await progressJson(page, mod.preview)).seed);
  });

  test('the LT rejects a token made with another seed, then takes two progress codes and the completion token', async () => {
    const box = page.locator('[data-interaction="lt"][data-exercise="m03-doctor"]');
    await completeLocalTask(page, mod, box);
    expect((await progressJson(page, mod.preview)).exercises?.['m03-doctor']?.passed, 'the LT is recorded as passed').toBe(true);
    await axeBothSchemes(page, 'm03 lesson 3.1, LT card after a valid token');
  });

  test('"my machine" is set from the lesson, and the question after it is answered', async () => {
    const picker = page.getByLabel('Your machine:');
    await picker.scrollIntoViewIfNeeded();
    await picker.selectOption('mac-arm');
    await expect.poll(async () => (await progressJson(page, mod.preview)).settings?.platform).toBe('mac-arm');
    const card = page.locator('section[data-card]', { has: picker });
    await axeBothSchemes(page, 'm03 lesson 3.1, "my machine" card');
    await completeChoice(card.locator('[data-interaction="choice"]'));
  });
});
