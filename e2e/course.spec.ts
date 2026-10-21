// Click-through of every available module (PLAN.md §3.5): warm-up, every card of every lesson, the
// problem set, the project and the checkpoint, answered with generated data; then the module must be
// complete. Separate tests cover the hint/solution/variant gates, export/import and accessibility.
import { test, expect, type Page } from '@playwright/test';
import {
  answerQuiz, availableModules, clickThroughModules, completeExercise, completeLesson, completeProgress, courseTitle, exerciseWithVariants, expectAccessible, previewBase, progressJson,
  reachCard, seedPriorModules, setEditor, solutionOf, starterOf, unreleasedModuleIds,
} from './lib';

// E2E_MODULE=m01 limits the run to one module (used by `npm run dod`); default is every available module. A module that
// course.yaml does not release yet (a draft) can be named too: it is then opened through ?preview=<id>.
const modules = clickThroughModules();

for (const mod of modules) {
  test.describe.serial(`${mod.id}: ${mod.meta.title}`, () => {
    let page: Page;
    // While a draft is previewed the app keeps its progress in a document of its own.
    const progress = () => progressJson(page, mod.preview);
    test.beforeAll(async ({ browser }, testInfo) => {
      // AxeBuilder needs a page that came from a browser context, not browser.newPage(). A draft opens through ?preview=<id>
      // on the base URL, which every relative page.goto('#/…') below keeps.
      const context = await browser.newContext(mod.preview ? { baseURL: previewBase(testInfo.project.use.baseURL, mod) } : {});
      await seedPriorModules(context, mod); // modules after the first stay locked until the earlier ones are complete
      page = await context.newPage();
      page.on('pageerror', e => { throw e; });
      page.on('dialog', d => void d.accept());
    });
    test.afterAll(async () => { await page.context().close(); });

    test('course map and module page', async () => {
      await page.goto('');
      await expect(page.getByRole('heading', { level: 1, name: courseTitle() })).toBeVisible();
      await expectAccessible(page, 'course map');
      await page.goto(`#/m/${mod.id}`);
      await expect(page.getByRole('heading', { level: 1, name: mod.meta.title })).toBeVisible();
      await expectAccessible(page, 'module page');
    });

    test('warm-up quiz', async () => {
      await page.goto(`#/m/${mod.id}/retrieval`);
      await answerQuiz(page, mod, 'retrieval');
      await page.getByRole('button', { name: 'Finish warm-up' }).click();
      await expect(page.getByText('Warm-up done: the lessons are open.')).toBeVisible();
    });

    for (const lesson of mod.lessons) {
      test(`lesson: ${lesson.title}`, async () => {
        await completeLesson(page, mod, lesson.stem);
        expect((await progress()).lessons?.[lesson.id], 'lesson marked complete').toBeTruthy();
        if (lesson === mod.lessons[0]) await expectAccessible(page, `lesson ${lesson.stem}`);
      });
    }

    test('problem set', async () => {
      await page.goto(`#/m/${mod.id}`);
      for (const [i, id] of mod.meta.problemSet.entries()) {
        const details = page.locator('details', { has: page.locator(`[data-exercise="${id}"]`) });
        await details.locator(':scope > summary').click();
        await completeExercise(page, mod, details.locator(`[data-exercise="${id}"]`), { viewHint: i === 0 });
      }
    });

    test('project', async () => {
      await page.goto(`#/m/${mod.id}/project`);
      const box = page.locator(`[data-exercise="project/${mod.meta.project}"]`);
      await completeExercise(page, mod, box);
      await expect(page.getByText('Project passed.')).toBeVisible();
      await expectAccessible(page, 'project page');
    });

    test('checkpoint unlocks, passes, and completes the module', async () => {
      await page.goto(`#/m/${mod.id}`);
      await page.getByRole('link', { name: 'Take the checkpoint' }).click();
      await answerQuiz(page, mod, 'checkpoint');
      await page.getByRole('button', { name: 'Submit checkpoint' }).click();
      await expect(page.getByText(/Checkpoint passed/)).toBeVisible();
      await page.goto(`#/m/${mod.id}`);
      await expect(page.getByText('Module complete.')).toBeVisible();
    });

    test('progress survives export and import into a fresh browser', async ({ browser }) => {
      test.skip(mod.preview, 'Settings export and import are off while previewing a draft (e2e/unreleased-modules.spec.ts covers that); the released modules cover the feature');
      await page.goto('#/settings');
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export progress' }).click()]);
      const file = await download.path();
      const fresh = await (await browser.newContext()).newPage();
      await fresh.goto('#/settings');
      await fresh.locator('input[type=file]').setInputFiles(file);
      await fresh.getByRole('button', { name: 'Replace my progress' }).click();
      await expect(fresh.getByText('Replaced your progress with the file.')).toBeVisible();
      const before = await progress();
      const after = await progressJson(fresh); // the fresh browser is an ordinary page, so its document is the real one
      expect(after.lessons).toEqual(before.lessons);
      expect(after.quizzes).toEqual(before.quizzes);
      await expectAccessible(fresh, 'settings');
      await fresh.context().close();
    });
  });
}

test('hint tiers, solution gate and variants', async ({ page }) => {
  const mod = modules[0];
  test.skip(mod.preview, 'a draft opens through the preview; this checks the app, not the module, and runs on the released ones');
  await seedPriorModules(page.context(), mod);
  page.on('dialog', d => void d.accept());
  await page.goto(`#/m/${mod.id}/retrieval`);
  await answerQuiz(page, mod, 'retrieval');
  await page.getByRole('button', { name: 'Finish warm-up' }).click();

  const id = exerciseWithVariants(mod);
  await page.goto(`#/m/${mod.id}`);
  const details = page.locator('details', { has: page.locator(`[data-exercise="${id}"]`) });
  await details.locator(':scope > summary').click();
  const box = details.locator(`[data-exercise="${id}"]`);

  const showSolution = box.getByRole('button', { name: 'Show the solution' });
  await expect(showSolution).toBeDisabled();
  await box.getByRole('button', { name: 'Stuck? Show a hint' }).click();
  await box.getByRole('button', { name: 'Show hint 2 (concept)' }).click();
  await box.getByRole('button', { name: 'Show hint 3 (partial code)' }).click();
  await expect(box.getByText('Hint 3 · Partial code')).toBeVisible();
  await expect(box.getByText('Make a real attempt first: change the code and run the tests.')).toBeVisible();

  // Two genuine, failing attempts unlock the solution.
  for (const n of [1, 2]) {
    await setEditor(page, box, `${starterOf(mod, id)}\n// attempt ${n}\n`);
    await box.getByRole('button', { name: 'Check my code' }).click();
    await expect(box.getByText(/^\d+ of \d+ checks passed\.$/)).toBeVisible({ timeout: 180_000 });
  }
  await expect(showSolution).toBeEnabled();
  await showSolution.click();
  await expect(box.getByText('Reference solution')).toBeVisible();
  await box.getByRole('button', { name: 'Start the variant' }).click();

  // The variant: two hint tiers at most, never a solution.
  const variant = page.locator(`[data-exercise^="${id}/variants/"]`);
  await expect(variant).toBeVisible();
  await variant.getByRole('button', { name: 'Stuck? Show a hint' }).click();
  await variant.getByRole('button', { name: 'Show hint 2 (concept)' }).click();
  await expect(variant.getByRole('button', { name: /Show hint 3/ })).toHaveCount(0);
  await expect(variant.getByText('Variants are solved without a solution, so the skill counts as yours.')).toBeVisible();
  await expect(page.getByText(/To finish the module, solve the variant for/)).toBeVisible();
  await completeExercise(page, mod, variant);
  await expect(page.getByText(/To finish the module, solve the variant for/)).toHaveCount(0);
  const p = await progressJson(page);
  expect(p.exercises[id].mastered).toBe(true);
  expect(solutionOf(mod, id)).toBeTruthy();
});

test('low-memory mode shows stored output without downloading the compiler', async ({ page }) => {
  const mod = modules[0];
  test.skip(mod.preview, 'a draft opens through the preview; this checks the app, not the module, and runs on the released ones');
  const toolchainRequests: string[] = [];
  await seedPriorModules(page.context(), mod);
  page.on('request', r => { if (/toolchain\/clang-/.test(r.url())) toolchainRequests.push(r.url()); });
  await page.goto('#/settings');
  await page.getByLabel(/Low-memory mode/).check();
  await page.goto(`#/m/${mod.id}/retrieval`);
  await answerQuiz(page, mod, 'retrieval');
  await page.getByRole('button', { name: 'Finish warm-up' }).click();
  // The first prediction of the module's first lesson (Module 2's comes after two drills, which need no compiler).
  const card = await reachCard(page, mod, mod.lessons[0].stem, '[data-interaction="predict"]');
  const box = card.locator('[data-interaction="predict"]').first();
  const id = (await box.getAttribute('data-sample'))!;
  await box.locator('textarea').first().fill('anything');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Reveal the result' }).click();
  await expect(box.getByText(/stored output: low-memory mode is on/)).toBeVisible();
  await expect(box.locator('pre').filter({ hasText: mod.samples.samples[id].answer.stdout.split('\n')[0] })).toBeVisible();
  // A fixed sleep proved nothing; wait for the network to settle after the stored output shows, then count compiler requests.
  await page.waitForLoadState('networkidle');
  expect(toolchainRequests).toEqual([]);
});

// A module course.yaml does not release stays closed on the real build, even for a learner who finished every released one.
// No shipped module is a draft yet, so today this holds because none is on disk; the day one is, this is the test that
// guards the deployed app. e2e/unreleased-modules.spec.ts runs the same rules over a draft that does exist.
test('an unreleased module is not offered or openable, even after every released module is complete', async ({ page }) => {
  await page.addInitScript(([key, json]) => {
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, json); } catch { /* an opaque frame has no storage */ }
  }, ['tdcc:v1:progress', JSON.stringify(completeProgress(availableModules()))] as const);
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1, name: courseTitle() })).toBeVisible();
  await expect(page.getByText('Everything built so far is done')).toBeVisible();
  for (const id of unreleasedModuleIds()) {
    await expect(page.locator(`a[href$="#/m/${id}"]`), `${id} has no link on the map`).toHaveCount(0);
    await page.goto(`#/m/${id}`);
    await expect(page, `${id} sends the learner back`).toHaveURL(/#\/$/);
    await expect(page.getByRole('heading', { level: 1, name: courseTitle() })).toBeVisible();
  }
});
