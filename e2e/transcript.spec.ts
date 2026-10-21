// <Transcript> in the real app: a lesson (MDX pipeline, lesson page, session loading through sessionsFor) over the m97
// fixture sessions that tools/verify wrote, served by e2e/sessions-fixture.ts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './lib';
import { startSessionsFixture } from './sessions-fixture';

// Stored output mode keeps the lesson page from downloading the compiler, which these tests don't need.
const SEED = JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: '2026-01-01T00:00:00.000Z', settings: { storedOutputMode: true } });

let fixture: Awaited<ReturnType<typeof startSessionsFixture>>;
let url: string;
test.beforeAll(async () => { fixture = await startSessionsFixture(); url = fixture.url; });
test.afterAll(async () => { await fixture?.close(); });

async function openLesson(page: Page): Promise<void> {
  await page.context().addInitScript(json => { try { if (!localStorage.getItem('tdcc:v1:progress')) localStorage.setItem('tdcc:v1:progress', json); } catch { /* no storage */ } }, SEED);
  await page.goto(`${url}#/m/m97/01-transcripts`);
  await expect(page.getByRole('heading', { level: 1, name: 'Stored terminal output' })).toBeVisible();
  await expect(page.locator('figure[data-transcript]')).toHaveCount(4);
}

test.describe('<Transcript> over stored native sessions', () => {
  test.setTimeout(120_000); // the first page load compiles the app on demand

  test('shows the stored output with placeholders marked, and says no stored run only for a platform that has steps', async ({ page }) => {
    await openLesson(page);
    const link = page.locator('figure[data-transcript="link-undefined"]');
    await expect(link.getByRole('tab')).toHaveText(['Linux/WSL · gcc 13 · ld', 'Linux/WSL · clang 22 · ld']);
    await expect(link.getByRole('tabpanel')).toContainText("undefined reference to `area'");
    await expect(link.getByText('No stored run for macOS · Apple clang.')).toBeVisible();
    await expect(link.locator('[data-placeholder="dir"]').first()).toHaveText('<dir>');
    const lldb = page.locator('figure[data-transcript="lldb"]');
    // lldb has macOS steps but only clang steps on Linux: macOS is pending, the gcc build is not missing.
    await expect(lldb.locator('[data-pending]')).toHaveText('No stored run for macOS · Apple clang.');
    await expect(lldb.locator('[data-by-design]')).toHaveText('On Linux/WSL, lldb runs on the clang 22 build only.');
    // gdb is gcc only with no macOS group: one platform, so a plain label instead of a tab bar, and nothing missing.
    const gdb = page.locator('figure[data-transcript="gdb"]');
    await expect(gdb.getByRole('tab')).toHaveCount(0);
    await expect(gdb.getByRole('region', { name: 'Linux/WSL · gcc 13 · gdb: terminal output' })).toBeVisible();
    await expect(gdb.locator('[data-pending]')).toHaveCount(0);
    await expect(gdb).not.toContainText('No stored run');
    await expect(gdb.locator('figcaption')).toHaveText('Terminal output, recorded by running these commands');
    await expect(lldb.locator('[data-placeholder="addr"]').first()).toHaveText('<addr1>');
    await expect(lldb.getByRole('definition').first()).toContainText('the same number is the same address');
  });

  test('is operated with the keyboard: Tab reaches the selected platform, arrows switch, Tab reaches the output', async ({ page }) => {
    await openLesson(page);
    const link = page.locator('figure[data-transcript="link-undefined"]');
    const [gcc, clang] = [link.getByRole('tab').nth(0), link.getByRole('tab').nth(1)];
    await gcc.focus();
    await page.keyboard.press('ArrowRight');
    await expect(clang).toBeFocused();
    await expect(clang).toHaveAttribute('aria-selected', 'true');
    await expect(link.getByRole('tabpanel')).toContainText('clang-22: error: linker command failed');
    await page.keyboard.press('Tab');
    await expect(link.getByRole('tabpanel')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(clang).toBeFocused(); // the roving tab stop stays on the selected tab
    await page.keyboard.press('Home');
    await expect(gcc).toHaveAttribute('aria-selected', 'true');
  });

  test('passes axe in light and dark, and fits a phone screen', async ({ page }) => {
    await openLesson(page);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectAccessible(page, `the transcripts lesson (${colorScheme})`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // The output scrolls inside its own box; the page itself must not scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('long lines keep their columns and scroll sideways, by keyboard too, on a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLesson(page);
    const screen = page.locator('figure[data-transcript="link-undefined"]').getByRole('tabpanel', { name: 'Linux/WSL · gcc 13 · ld' });
    expect(await screen.evaluate(el => [getComputedStyle(el).whiteSpace, el.scrollWidth > el.clientWidth])).toEqual(['pre', true]);
    await screen.focus();
    await expect(screen).toBeFocused();
    expect(await screen.evaluate(el => el.scrollLeft)).toBe(0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => screen.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    // Every output box can be reached with Tab and has a name, so axe's scrollable-region-focusable rule passes on them.
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('figure[data-transcript]').withRules(['scrollable-region-focusable']).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
    expect(results.passes.flatMap(v => v.nodes).length).toBeGreaterThan(0);
  });
});
