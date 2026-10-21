// <Transcript> in the real app: a lesson (MDX pipeline, lesson page, session loading through sessionsFor) over the m97
// fixture sessions that tools/verify wrote (tools/verify/fixtures/generated/sessions). No shipped module has a session
// yet, so this runs a throwaway Vite server rooted in e2e/fixtures/sessions, like unreleased-modules.spec.ts.
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { expectAccessible, ROOT } from './lib';

const FIXTURE = path.join(ROOT, 'e2e', 'fixtures', 'sessions');
// Stored output mode keeps the lesson page from downloading the compiler, which this fixture does not serve.
const SEED = JSON.stringify({ version: 1, seed: '00e2e00e2e00e2e0', createdAt: '2026-01-01T00:00:00.000Z', settings: { storedOutputMode: true } });

let server: ViteDevServer;
let url: string;
let viteCache: string;

test.beforeAll(async () => {
  viteCache = mkdtempSync(path.join(os.tmpdir(), 'tdcc-e2e-vite-'));
  server = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    root: FIXTURE,
    publicDir: false,
    cacheDir: viteCache,
    logLevel: 'error',
    resolve: { alias: [{ find: /^(\.\.\/)+content\/course\.yaml$/, replacement: path.join(FIXTURE, 'content', 'course.yaml') }] },
    server: { port: 0, host: '127.0.0.1', hmr: false, fs: { strict: false } },
  });
  await server.listen();
  url = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/`;
});
test.afterAll(async () => { await server?.close(); if (viteCache) rmSync(viteCache, { recursive: true, force: true }); });

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
