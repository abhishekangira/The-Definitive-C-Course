// Checks that a failing test leaves a Playwright trace and a screenshot, also for pages from our own contexts
// (axe needs `browser.newContext()`, and the serial groups make theirs in `beforeAll`). Both fail on purpose, so they
// only run with E2E_DELIBERATE_FAIL=1; the PR for #28 pastes their output. Look at the result with:
//   E2E_DELIBERATE_FAIL=1 npx playwright test failure-artifacts; ls test-results/*/
import { test, expect, type Page } from '@playwright/test';

test.skip(!process.env.E2E_DELIBERATE_FAIL, 'fails on purpose; set E2E_DELIBERATE_FAIL=1 to see the artifacts');

test.describe.serial('context made in beforeAll', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });
  test.afterAll(async () => { await page.context().close(); });
  test('deliberate failure', async () => {
    await page.goto('./');
    await expect(page.getByText('this text is not on the page')).toBeVisible({ timeout: 2000 });
  });
});

test('deliberate failure in a context made inside the test', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('./');
  await expect(page.getByText('this text is not on the page')).toBeVisible({ timeout: 2000 });
});
