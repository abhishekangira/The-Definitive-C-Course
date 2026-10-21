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
    // A faded edge marks the side that hides text.
    const frame = screen.locator('xpath=..');
    await expect(frame).toHaveAttribute('data-hidden-right', 'true');
    await expect(frame).not.toHaveAttribute('data-hidden-left');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => screen.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await expect(frame).toHaveAttribute('data-hidden-left', 'true');
    // Every output box can be reached with Tab and has a name, so axe's scrollable-region-focusable rule passes on them.
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('figure[data-transcript]').withRules(['scrollable-region-focusable']).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
    expect(results.passes.flatMap(v => v.nodes).length).toBeGreaterThan(0);
  });

  test('"Wrap lines" (off by default, by keyboard) wraps long lines with a hanging indent, so the box no longer scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLesson(page);
    const figure = page.locator('figure[data-transcript="link-undefined"]');
    const screen = figure.getByRole('tabpanel', { name: 'Linux/WSL · gcc 13 · ld' });
    const toggle = figure.getByRole('button', { name: 'Wrap lines' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await screen.focus();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.evaluate(el => [getComputedStyle(el).whiteSpace, el.scrollWidth <= el.clientWidth])).toEqual(['pre-wrap', true]);
    await expect(screen.locator('xpath=..')).not.toHaveAttribute('data-hidden-right');
    // The long linker line now takes several rows, and its continuation hangs under its start.
    const line = screen.locator('span', { hasText: "undefined reference to `area'" }).first();
    const [rows, indent, pad] = await line.evaluate(el => {
      const cs = getComputedStyle(el);
      return [Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)), parseFloat(cs.textIndent), parseFloat(cs.paddingLeft)];
    });
    expect(rows).toBeGreaterThan(1);
    expect(pad).toBeGreaterThan(0);
    expect(indent).toBe(-pad);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('figure[data-transcript]').withRules(['scrollable-region-focusable']).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  });

  test('on a desktop the output box runs wider than the text column, up to the lesson column', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await openLesson(page);
    const [box, text, column] = await page.evaluate(() => {
      const figure = document.querySelector('figure[data-transcript="valgrind-leak"]')!;
      const prose = [...figure.closest('section')!.querySelectorAll('p')].find(p => !p.closest('figure'))!; // the text column (--measure)
      return [figure.getBoundingClientRect().width, prose.getBoundingClientRect().width, document.querySelector('article')!.getBoundingClientRect().width];
    });
    expect(box).toBeGreaterThan(text);
    expect(box).toBeLessThanOrEqual(column);
  });

  test('the scrollbar of a sideways-scrolling box is drawn, not an overlay that hides until hovered', async ({ playwright, launchOptions }) => {
    // Headless Chromium hides every scrollbar (--hide-scrollbars); without that flag it draws them as a headed browser does.
    const browser = await playwright.chromium.launch({ ...launchOptions, ignoreDefaultArgs: ['--hide-scrollbars'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await openLesson(page);
    const screen = page.locator('figure[data-transcript="link-undefined"]').getByRole('tabpanel', { name: 'Linux/WSL · gcc 13 · ld' });
    // The horizontal scrollbar takes its own 12px under the text (offsetHeight less clientHeight less the 1px borders).
    expect(await screen.evaluate(el => (el as HTMLElement).offsetHeight - el.clientHeight - 2)).toBe(12);
    await browser.close();
  });
});
