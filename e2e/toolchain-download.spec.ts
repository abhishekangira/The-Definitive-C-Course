// The first-run compiler download (#29): offline or dropped connections, corrupt downloads, the second visit,
// cache eviction, a slow network and low-memory mode. Every test makes its own browser context, so each has its own
// Cache Storage and starts with no compiler. Nothing here sleeps: tests wait for what the page shows, and "slow" is a
// held response, released by the test.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { availableModules, expectAccessible } from './lib';

const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);
const TOOLCHAIN = /\/toolchain\/clang-[^/]+\//;
const BIG = /\/llvm\.core\.wasm$/; // 75 MB of the 78 MB: the file whose download we interrupt
const toolchainDir = () => {
  const root = join(process.cwd(), 'public/toolchain');
  return join(root, readdirSync(root).find(d => d.startsWith('clang-'))!);
};

interface Session { context: BrowserContext; page: Page; requests: string[] }

async function session(browser: import('@playwright/test').Browser): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  // On the context, not the page: the compiler is fetched from a worker.
  context.on('request', r => { if (TOOLCHAIN.test(r.url())) requests.push(new URL(r.url()).pathname.split('/').pop()!); });
  page.on('pageerror', e => { throw e; });
  return { context, page, requests };
}

const runButton = (page: Page) => page.getByRole('button', { name: 'Run', exact: true });
const progress = (page: Page) => page.getByRole('progressbar', { name: 'Compiler download' });
const toolchainAlert = (page: Page) => page.getByRole('alert').filter({ hasText: /compiler/i });
const retryButton = (page: Page) => toolchainAlert(page).getByRole('button', { name: 'Retry' });

async function expectRunWorks(page: Page) {
  await runButton(page).click();
  // Fail fast: if the compiler could not load, the alert shows within seconds; don't sit out the whole run timeout.
  const exited = page.getByText('Program exited with status 0.');
  await expect(exited.or(toolchainAlert(page)).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(toolchainAlert(page), 'the compiler failed to load').toHaveCount(0);
  await expect(exited).toBeVisible();
  await expect(page.getByRole('log', { name: 'Program output' })).toContainText('Hello from C!');
}

/** Holds every request matching `which` until `release(how)`; requests that arrive after the release are let through. */
function hold(context: BrowserContext, which: RegExp) {
  const waiting: Route[] = [];
  let released = false;
  let resolveFirst!: () => void;
  const first = new Promise<void>(r => (resolveFirst = r));
  void context.route(which, route => {
    if (released) return route.continue();
    waiting.push(route);
    resolveFirst();
  });
  return {
    first,
    async release(how: 'continue' | 'abort') {
      released = true;
      for (const r of waiting.splice(0)) await (how === 'abort' ? r.abort('connectionreset') : r.continue());
    },
  };
}

const MANIFEST_FILES = () => readdirSync(toolchainDir()).filter(f => f !== 'manifest.json').sort();

const cachedFiles = (page: Page) => page.evaluate(async () => {
  const out: string[] = [];
  for (const name of await caches.keys()) if (name.startsWith('tdcc-toolchain-')) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname.split('/').pop()!);
  return out.sort();
});

test('1. a download that drops shows an error with Retry, and Retry works without a reload', async ({ browser }) => {
  const { context, page } = await session(browser);
  const gate = hold(context, BIG);
  await page.goto('#/playground');
  await gate.first; // the big file was requested: the download is under way
  await runButton(page).click();
  await expect(progress(page)).toBeVisible();
  await context.setOffline(true);
  await gate.release('abort');

  const alert = toolchainAlert(page);
  await expect(alert).toBeVisible({ timeout: 60_000 });
  await expect(alert).toContainText(/didn.t finish downloading/);
  await expect(retryButton(page)).toBeVisible();
  await expect(progress(page)).toHaveCount(0); // no endless spinner
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `toolchain error (${scheme})`);
  }

  // A failed download is not a failed compile: nothing may announce "Compilation failed with 0 error(s)".
  await expect(runButton(page)).toHaveAttribute('aria-disabled', 'false'); // the failed run has ended, so its announcement would be in place
  await expect(page.getByRole('status').filter({ hasText: /Compilation failed/ })).toHaveCount(0);

  // Retry by keyboard. The button disappears, so focus must land on the progress box, not on <body>.
  await context.setOffline(false);
  const slow = hold(context, BIG);
  await retryButton(page).focus();
  await page.keyboard.press('Enter');
  await slow.first;
  await expect(page.locator('[data-toolchain="loading"]')).toBeFocused();
  await slow.release('continue');
  await expect(page.locator('[data-toolchain="ready"]')).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(toolchainAlert(page)).toHaveCount(0);
  await expectRunWorks(page);
  await context.close();
});

for (const kind of ['corrupt', 'truncated'] as const) {
  test(`2. a ${kind} download is never kept as complete: the next attempt fetches it again`, async ({ browser }) => {
    const { context, page, requests } = await session(browser);
    const real = readFileSync(join(toolchainDir(), 'llvm.core.wasm'));
    let good = false;
    await context.route(BIG, route => {
      if (good) return route.continue();
      // corrupt: right length, not WebAssembly, a 200 response that a naive cache stores.
      // truncated: the header promises the whole file, the body stops after 1 MB.
      return route.fulfill(kind === 'corrupt'
        ? { status: 200, contentType: 'application/wasm', body: Buffer.alloc(real.length, 1) }
        : { status: 200, headers: { 'content-type': 'application/wasm', 'content-length': String(real.length) }, body: real.subarray(0, 1 << 20) });
    });
    await page.goto('#/playground');
    await runButton(page).click();
    await expect(toolchainAlert(page)).toBeVisible({ timeout: RUN_TIMEOUT });
    expect(await cachedFiles(page), 'the bad file must not stay in the cache').not.toContain('llvm.core.wasm');

    good = true;
    const before = requests.filter(r => r === 'llvm.core.wasm').length;
    await retryButton(page).click();
    await expectRunWorks(page);
    expect(requests.filter(r => r === 'llvm.core.wasm').length, 'the retry fetched the big file again').toBeGreaterThan(before);
    await context.close();
  });
}

test('3. second visit makes no toolchain requests, and Run still works with the toolchain URLs blocked', async ({ browser }) => {
  const { context, page, requests } = await session(browser);
  await page.goto('#/playground');
  await expectRunWorks(page);
  expect(requests, 'the probe sees the first download').toContain('llvm.core.wasm');
  // No polling: once the first Run works the cache is complete (the worker reports ready only after every put settled).
  expect(await cachedFiles(page)).toEqual(MANIFEST_FILES());
  requests.length = 0;

  // The app itself is not an offline app (the page needs the network to load), so "offline" here is: every toolchain URL fails.
  await context.route(TOOLCHAIN, route => route.abort('internetdisconnected'));
  await page.reload();
  await expectRunWorks(page);
  expect(requests, 'no request for any toolchain file, not even a failed one').toEqual([]);
  await context.close();
});

test('4. deleting the cache triggers a fresh download with visible progress, not a broken Run', async ({ browser }) => {
  const { context, page, requests } = await session(browser);
  await page.goto('#/playground');
  await expectRunWorks(page);
  await page.evaluate(async () => { for (const k of await caches.keys()) if (k.startsWith('tdcc-toolchain-')) await caches.delete(k); });
  requests.length = 0;

  const gate = hold(context, BIG); // keeps the new download open long enough to look at it
  await page.reload();
  await gate.first;
  await runButton(page).click();
  await expect(progress(page)).toBeVisible();
  await expect(page.getByText(/Downloading the C compiler/)).toBeVisible();
  await gate.release('continue');
  await expect(page.getByText('Program exited with status 0.')).toBeVisible({ timeout: RUN_TIMEOUT });
  expect(requests).toContain('llvm.core.wasm');
  await context.close();
});

test('5. a slow download shows progress that advances and does not block the page or the keyboard', async ({ browser }) => {
  const { context, page } = await session(browser);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 50, downloadThroughput: 8_000_000, uploadThroughput: 8_000_000 });
  await page.goto('#/playground');
  await runButton(page).click();
  const bar = progress(page);
  await expect(bar).toBeVisible();
  const value = async () => Number(await bar.getAttribute('aria-valuenow'));
  await expect.poll(value, { timeout: 60_000 }).toBeGreaterThan(5);
  const seen = await value();
  await expect.poll(value, { timeout: 60_000 }).toBeGreaterThan(seen); // it keeps moving

  // The page and the keyboard stay usable while it downloads.
  const editor = page.locator('main .cm-content[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type('/*typed during download*/');
  await expect(editor).toContainText('/*typed during download*/');
  await page.getByLabel('Command-line arguments').fill('x');
  await expect(page.getByLabel('Command-line arguments')).toHaveValue('x');
  await expect(page.getByText('Program exited with status 0.')).toBeVisible({ timeout: RUN_TIMEOUT });
  await context.close();
});

test('6. low-memory mode never downloads the compiler, in the playground or on a lesson', async ({ browser }) => {
  const { context, page, requests } = await session(browser);
  // Fake timers, so the lesson's 1.5 s background prefetch timer fires now instead of after a sleep.
  const mod = availableModules()[0];
  const lesson = mod.lessons[0];
  // Low-memory mode on and the warm-up passed, so the lesson page opens (and would prefetch if it were allowed to).
  await page.addInitScript(([quizKey]) => {
    if (localStorage.getItem('tdcc:v1:progress')) return;
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '0123456789abcdef', settings: { storedOutputMode: true }, cards: {}, lessons: {}, samples: {}, exercises: {}, quizzes: { [quizKey]: { passed: true, score: 1, total: 1, at: 'x', answers: {} } }, projects: {} }));
  }, [`${mod.id}:retrieval`]);
  await page.clock.install();
  await page.goto('#/playground');
  await expect(page.getByText(/Low-memory mode is on/)).toBeVisible();
  await page.clock.fastForward(10_000);
  await page.goto(`#/m/${mod.id}/${lesson.stem}`);
  await expect(page.getByRole('heading', { level: 1, name: lesson.title })).toBeVisible();
  await page.clock.fastForward(10_000);
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual([]);
  await context.close();
});

test('7. one evicted file while offline keeps the other five, and Retry fetches only what is missing', async ({ browser }) => {
  const { context, page, requests } = await session(browser);
  await page.goto('#/playground');
  await expectRunWorks(page);
  await page.evaluate(async () => {
    for (const k of await caches.keys()) {
      const cache = await caches.open(k);
      for (const r of await cache.keys()) if (r.url.endsWith('/llvm.core2.wasm')) await cache.delete(r);
    }
  });
  const kept = MANIFEST_FILES().filter(f => f !== 'llvm.core2.wasm');
  expect(await cachedFiles(page)).toEqual(kept);

  await context.route(TOOLCHAIN, route => route.abort('internetdisconnected'));
  await page.reload();
  await runButton(page).click();
  await expect(toolchainAlert(page)).toBeVisible({ timeout: RUN_TIMEOUT });
  expect(await cachedFiles(page), 'a failed load must not delete the good files').toEqual(kept);

  await context.unroute(TOOLCHAIN);
  requests.length = 0;
  await retryButton(page).click();
  await expectRunWorks(page);
  expect(requests, 'only the evicted file is downloaded again').toEqual(['llvm.core2.wasm']);
  await context.close();
});

test('8. in the pipeline explorer a failed stage shows the alert, and the same tab works after Retry', async ({ browser }) => {
  const { context, page } = await session(browser);
  const mod = availableModules()[0];
  const lesson = mod.lessons[0];
  await page.addInitScript(([lessonId, quizKey]) => {
    if (localStorage.getItem('tdcc:v1:progress')) return;
    const cards = { [lessonId]: Array.from({ length: 40 }, (_, k) => k) };
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '0123456789abcdef', settings: {}, cards, lessons: {}, samples: {}, exercises: {}, quizzes: { [quizKey]: { passed: true, score: 1, total: 1, at: 'x', answers: {} } }, projects: {} }));
  }, [lesson.id, `${mod.id}:retrieval`]);
  await context.route(TOOLCHAIN, route => route.abort('internetdisconnected'));
  await page.goto(`#/m/${mod.id}/${lesson.stem}`);
  const explorer = page.getByLabel('Pipeline explorer');
  const tab = explorer.getByRole('tab', { name: '2. After the preprocessor' });
  await tab.click();
  await expect(explorer.getByRole('alert')).toContainText(/didn.t finish downloading/, { timeout: RUN_TIMEOUT });

  await context.unroute(TOOLCHAIN);
  await explorer.getByRole('button', { name: 'Retry' }).click();
  await expect(explorer.locator('[data-toolchain="ready"]')).toBeVisible({ timeout: RUN_TIMEOUT });
  await tab.click(); // the failed result is not remembered: this asks the compiler again
  await expect(explorer.getByText(/\d+ lines\./)).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(explorer.getByRole('alert')).toHaveCount(0);
  await context.close();
});

for (const [file, garbage] of [['llvm.core3.wasm', 'same size'], ['llvm.core3.wasm', 'short'], ['bundle.js', 'same size']] as const) {
  test(`9. a ${garbage} corrupt ${file} already in the cache is evicted, and Retry heals it`, async ({ browser }) => {
    const { context, page } = await session(browser);
    await page.goto('#/playground');
    await expectRunWorks(page);
    await page.evaluate(async ([name, kind]) => {
      for (const k of await caches.keys()) {
        const cache = await caches.open(k);
        for (const r of await cache.keys()) {
          if (!r.url.endsWith('/' + name)) continue;
          const old = (await cache.match(r))!;
          const size = (await old.clone().arrayBuffer()).byteLength;
          // Same headers as the real entry (a wasm file keeps its MIME type); only the bytes are garbage.
          await cache.put(r, new Response(new Uint8Array(kind === 'short' ? 100 : size).fill(7), { headers: old.headers }));
        }
      }
    }, [file, garbage]);

    // Hold the compiler worker's script until Run is pressed, so the failed load is the one this Run waits for. (Pressed after
    // the page's own background load had failed, Run would simply start a fresh load, which heals silently.)
    const worker = hold(context, /\/compiler\.worker-[^/]*\.js$/);
    await page.reload();
    await worker.first;
    await runButton(page).click();
    await worker.release('continue');
    await expect(toolchainAlert(page)).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(toolchainAlert(page)).toContainText(/damaged/);
    await expect(toolchainAlert(page)).not.toContainText(/internet connection/);

    await retryButton(page).click();
    await expectRunWorks(page);
    expect(await cachedFiles(page)).toEqual(MANIFEST_FILES());
    // And it stays healed: a reload runs again.
    await page.reload();
    await expectRunWorks(page);
    await context.close();
  });
}
