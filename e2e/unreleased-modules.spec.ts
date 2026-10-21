// A module that is on disk but not released (course.yaml `available: false`) stays closed to learners and opens only through
// `?preview=<id>`, behind a banner, with its progress kept out of the real progress document (issue 73, PR 1).
// No shipped module is a draft yet, so this runs the real app (router, layout, gating, progress store) over the two-module
// course in e2e/fixtures/unreleased, through a throwaway Vite server rooted there.
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { expectAccessible, ROOT } from './lib';

const FIXTURE = path.join(ROOT, 'e2e', 'fixtures', 'unreleased');
const TITLE = 'Unreleased modules fixture';
const REAL_KEY = 'tdcc:v1:progress';
const PREVIEW_KEY = 'tdcc:v1:progress-preview';

const at = '2026-01-01T00:00:00.000Z';
/** A learner who finished the released module (checkpoint and project passed), so the draft is next in line. */
const SEED = JSON.stringify({
  version: 1, seed: '00e2e00e2e00e2e0', createdAt: at,
  // Stored output mode keeps the lesson page from downloading the compiler, which this fixture does not serve.
  settings: { storedOutputMode: true },
  quizzes: { 'm01:checkpoint': { score: 1, total: 1, passed: true, at, answers: {} } },
  projects: { p1: { passed: true, at } },
});

let server: ViteDevServer;
let url: string;
let viteCache: string;

test.beforeAll(async () => {
  viteCache = mkdtempSync(path.join(os.tmpdir(), 'tdcc-e2e-vite-'));
  // The Drive panel exists only in a build that has a client id; Vite reads the variable while it starts, so it is put back right after.
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  process.env.VITE_GOOGLE_CLIENT_ID = 'e2e.apps.googleusercontent.com';
  server = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    root: FIXTURE,
    publicDir: false,
    cacheDir: viteCache,
    logLevel: 'error',
    // The app's content globs are relative to the Vite root, so they read the fixture's content/. src/content-runtime imports
    // course.yaml by a relative path instead, so that one import is pointed at the fixture's file.
    resolve: { alias: [{ find: /^(\.\.\/)+content\/course\.yaml$/, replacement: path.join(FIXTURE, 'content', 'course.yaml') }] },
    server: { port: 0, host: '127.0.0.1', hmr: false, fs: { strict: false } },
  }).finally(() => {
    if (clientId === undefined) delete process.env.VITE_GOOGLE_CLIENT_ID; else process.env.VITE_GOOGLE_CLIENT_ID = clientId;
  });
  await server.listen();
  url = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/`;
});
test.afterAll(async () => { await server?.close(); if (viteCache) rmSync(viteCache, { recursive: true, force: true }); });

/** Writes the learner's progress before the first page script runs, only when none exists yet (so a reload keeps the test's own). */
async function seed(context: BrowserContext, doc = SEED): Promise<void> {
  await context.addInitScript(([key, json]) => {
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, json); } catch { /* an opaque frame has no storage */ }
  }, [REAL_KEY, doc] as const);
}

const mapTitle = (page: Page) => page.getByRole('heading', { level: 1, name: TITLE });
const draftRow = (page: Page) => page.getByRole('listitem').filter({ hasText: 'Draft module' });
const banner = (page: Page) => page.getByRole('note').filter({ hasText: /^Preview:/ });
const stored = (page: Page, key: string) => page.evaluate(k => localStorage.getItem(k), key);

test.describe('an unreleased module that is on disk', () => {
  test.setTimeout(120_000); // the first page load compiles the app on demand
  test.beforeEach(async ({ context }) => { await seed(context); });

  test('stays closed: no link on the map, nothing "up next", and every route leads back to the map', async ({ page }) => {
    await page.goto(url);
    await expect(mapTitle(page)).toBeVisible();
    await expect(draftRow(page).getByText('Coming soon')).toBeVisible();
    await expect(draftRow(page).getByRole('link')).toHaveCount(0);
    await expect(page.getByText('Everything built so far is done')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    for (const route of ['m/m02', 'm/m02/01-draft', 'm/m02/retrieval', 'm/m02/project', 'm/m02/checkpoint']) {
      await page.goto(`${url}#/${route}`);
      // The map's heading is already on screen from the page before, so wait for the redirect itself.
      await expect(page, route).toHaveURL(/#\/$/);
      await expect(mapTitle(page), route).toBeVisible();
    }
  });

  test('opens with ?preview=<id>, behind a banner that survives navigation and a reload', async ({ page }) => {
    await page.goto(`${url}?preview=m02`);
    await expect(banner(page)).toHaveText(/Preview: Module 2 is not released yet\. Progress made here is kept apart from your real progress\./);
    await expect(draftRow(page).getByText('Start here')).toBeVisible();
    await expect(page.getByText('Draft lesson')).toBeVisible(); // "up next" now offers it

    await draftRow(page).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Draft module' })).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await page.getByRole('link', { name: /Draft lesson/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Draft lesson' })).toBeVisible();
    await expect(page.getByText('Lesson complete.')).toBeVisible();

    // Reload on the module page, not on the lesson: opening the one-card lesson completes it again by itself, which would
    // hide whether the preview document was read back. The module page only shows what the stored progress says.
    await page.getByRole('link', { name: 'Module 2', exact: true }).first().click();
    await expect(page.getByText('1/1', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('1/1', { exact: true })).toBeVisible();
    await expect(banner(page)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('preview')).toBe('m02');
  });

  test('keeps everything done in the preview out of the real progress document', async ({ page }) => {
    await page.goto(`${url}?preview=m02#/m/m02/01-draft`);
    await expect(page.getByText('Lesson complete.')).toBeVisible();
    expect(await stored(page, REAL_KEY)).toBe(SEED);
    const preview = JSON.parse((await stored(page, PREVIEW_KEY))!) as { lessons: Record<string, unknown>; projects: Record<string, unknown> };
    expect(Object.keys(preview.lessons)).toEqual(['m02-l1']);
    expect(Object.keys(preview.projects)).toEqual(['p1']); // it started from the real progress
    // Back on the ordinary page the draft is closed and the real document has no trace of it.
    await page.goto(url);
    await expect(draftRow(page).getByText('Coming soon')).toBeVisible();
    expect(await stored(page, REAL_KEY)).toBe(SEED);
  });

  test('export, import and reset are off while previewing, and on again on the ordinary page', async ({ page }) => {
    const controls = (p: Page) => [p.getByRole('button', { name: 'Export progress' }), p.getByRole('button', { name: 'Import from file' }), p.getByRole('button', { name: 'Reset all progress' })];
    await page.goto(`${url}?preview=m02#/settings`);
    for (const c of controls(page)) await expect(c).toBeDisabled();
    await expect(page.getByText(/Export, import and reset are off while you preview an unreleased module/)).toBeVisible();
    // Google Drive sync is off too (it would upload the draft's progress): a note, and no button that would do nothing.
    await expect(page.getByText(/Google Drive sync is off while you preview an unreleased module/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toHaveCount(0);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectAccessible(page, `settings page while previewing (${colorScheme} scheme)`);
    }
    await page.goto(`${url}#/settings`); // no query: a different document, so the page reloads without the preview
    for (const c of controls(page)) await expect(c).toBeEnabled();
    await expect(page.getByText(/Export, import and reset are off/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible(); // the panel is there, so the note above is not an empty check
  });

  test('the "export a backup" reminder is not shown while previewing, because export is off', async ({ page }) => {
    await page.goto(`${url}?preview=m02#/m/m02/01-draft`);
    await expect(page.getByText('Lesson complete.')).toBeVisible(); // there is progress now, and no export yet, so the ordinary page would remind
    await page.goto(`${url}?preview=m02#/`);
    await expect(mapTitle(page)).toBeVisible();
    await expect(page.getByText('Your progress lives only in this browser.')).toHaveCount(0);
  });

  test('"Leave the preview" returns to the ordinary course, where the draft is closed again', async ({ page }) => {
    await page.goto(`${url}?preview=m02`);
    const leave = page.getByRole('link', { name: 'Leave the preview' });
    await leave.focus();
    await page.keyboard.press('Enter');
    await expect(mapTitle(page)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(draftRow(page).getByText('Coming soon')).toBeVisible();
  });

  for (const [id, why] of [['m01', 'a released module'], ['m09', 'an id the course does not have']] as const) {
    test(`ignores ?preview=${id} (${why})`, async ({ page }) => {
      await page.goto(`${url}?preview=${id}`);
      await expect(mapTitle(page)).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
      await expect(draftRow(page).getByText('Coming soon')).toBeVisible();
    });
  }

  test('the banner is accessible in light and dark', async ({ page }) => {
    await page.goto(`${url}?preview=m02`);
    await expect(banner(page)).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectAccessible(page, `course map with the preview banner (${colorScheme} scheme)`);
    }
  });
});

// Always checks that the banner fits; with E2E_SHOTS=<dir> it also writes the pictures a pull request carries (never committed).
test('the banner fits a desktop and a phone screen (E2E_SHOTS=<dir> saves screenshots)', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const [name, width, height] of [['desktop', 1400, 900], ['phone', 390, 844]] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${url}?preview=m02`);
    await expect(banner(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `no horizontal scroll at ${width}px`).toBe(true);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `preview-banner-${name}.png`) });
    await context.close();
  }
});

test('the preview does not skip the lock: a learner who has not finished the module before it is sent back', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(); // a new learner: nothing seeded
  const page = await context.newPage();
  await page.goto(`${url}?preview=m02#/m/m02`);
  await expect(page.getByText('This module unlocks when you complete the previous one')).toBeVisible();
  await context.close();
});
