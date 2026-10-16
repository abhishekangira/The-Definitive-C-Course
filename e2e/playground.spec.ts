// The Playground (#/playground): a free C editor that needs no warm-up quiz and records no progress.
import { test, expect, type Page } from '@playwright/test';
import { expectAccessible, setEditor } from './lib';

const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);
const DRAFT_KEY = 'tdcc:v1:playground';

const output = (page: Page) => page.getByRole('log', { name: 'Program output' });
const runButton = (page: Page) => page.getByRole('button', { name: 'Run', exact: true });
const editor = (page: Page) => page.locator('main').locator('.cm-content[contenteditable="true"]').first();

async function exited(page: Page, status = 0) {
  await expect(page.getByText(`Program exited with status ${status}.`)).toBeVisible({ timeout: RUN_TIMEOUT });
}

async function runAndWait(page: Page, status = 0) {
  await runButton(page).click();
  await exited(page, status);
}

async function loadExample(page: Page, label: string) {
  await page.getByRole('group', { name: 'Examples' }).getByRole('button', { name: label, exact: true }).click();
}

test.describe.serial('playground', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    // One browser context for the whole group, so the compiler downloads once. AxeBuilder needs a context-made page.
    page = await (await browser.newContext()).newPage();
    page.on('pageerror', e => { throw e; });
    page.on('dialog', d => void d.accept());
  });
  test.afterAll(async () => { await page.context().close(); });

  test('is one click from the course map, needs no warm-up, and runs the starting program', async () => {
    await page.goto('');
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Playground' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
    await expect(page.getByText('Nothing here counts toward your progress')).toBeVisible();
    await runAndWait(page);
    await expect(output(page)).toContainText('Hello from C!');
    await expect(page.locator('[data-diagnostics]')).toHaveCount(0);
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('tdcc:v1:progress') ?? '{}'));
    expect(Object.keys(progress.samples ?? {})).toEqual([]);
  });

  test('every example compiles without a diagnostic and exits normally', async () => {
    for (const label of ['Hello', 'Read input', 'Type sizes', 'Array loop', 'Empty program']) {
      await loadExample(page, label);
      await runAndWait(page);
      await expect(page.locator('[data-diagnostics]'), `${label}: diagnostics`).toHaveCount(0);
    }
  });

  test('typed input reaches the program (input box), and arguments reach main', async () => {
    await loadExample(page, 'Read input');
    await expect(page.getByLabel('Input for the program (stdin)')).toHaveValue('2\n40\n');
    await runAndWait(page);
    await expect(output(page)).toContainText('2 + 40 = 42');

    await setEditor(page, page.locator('main'), '#include <stdio.h>\n\nint main(int argc, char **argv) {\n    printf("%d args, first: %s\\n", argc - 1, argc > 1 ? argv[1] : "none");\n    return 0;\n}\n');
    await page.getByLabel('Command-line arguments').fill('hello world');
    await runAndWait(page);
    await expect(output(page)).toContainText('2 args, first: hello');
    await page.getByLabel('Command-line arguments').fill('');
  });

  test('with no input typed, an interactive browser lets the program wait for typing', async () => {
    await loadExample(page, 'Read input');
    await page.getByLabel('Input for the program (stdin)').fill('');
    await runButton(page).click();
    const line = page.locator('#term-input');
    await expect(line).toBeVisible({ timeout: RUN_TIMEOUT });
    await line.fill('5');
    await line.press('Enter');
    await expect(line).toBeVisible({ timeout: RUN_TIMEOUT });
    await line.fill('6');
    await line.press('Enter');
    await exited(page);
    await expect(output(page)).toContainText('5 + 6 = 11');
  });

  test('a compile error shows the clang message and marks the editor', async () => {
    await setEditor(page, page.locator('main'), 'int main(void) {\n    return missing;\n}\n');
    await runButton(page).click();
    const diagnostics = page.locator('[data-diagnostics]');
    await expect(diagnostics).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(diagnostics).toContainText("use of undeclared identifier 'missing'");
    await expect(page.locator('main .cm-lint-marker-error, main .cm-lintRange-error').first()).toBeVisible();
    await expect(runButton(page)).toBeEnabled();
  });

  test('Ctrl+Enter in the editor runs the program', async () => {
    await loadExample(page, 'Hello');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await exited(page);
    await expect(output(page)).toContainText('Hello from C!');
  });

  test('the UBSan switch stops a program that overflows a signed int', async () => {
    const code = '#include <limits.h>\n#include <stdio.h>\n\nint main(void) {\n    int x = INT_MAX;\n    x = x + 1;\n    printf("%d\\n", x);\n    return 0;\n}\n';
    await setEditor(page, page.locator('main'), code);
    await page.getByLabel('Stop on undefined behavior (UBSan)').check();
    await runAndWait(page, 1);
    await expect(output(page)).toContainText('runtime error: signed integer overflow');
    await page.getByLabel('Stop on undefined behavior (UBSan)').uncheck();
  });

  test('the draft survives a reload', async () => {
    const marker = '// my draft survives';
    await setEditor(page, page.locator('main'), `${marker}\nint main(void) { return 0; }\n`);
    await page.getByLabel('Command-line arguments').fill('keep me');
    await expect.poll(() => page.evaluate(k => localStorage.getItem(k) ?? '', DRAFT_KEY)).toContain('keep me');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
    await expect(editor(page)).toContainText(marker);
    await expect(page.getByLabel('Command-line arguments')).toHaveValue('keep me');
  });

  test('is accessible in light and dark, and Stop is reachable while a program runs', async () => {
    await loadExample(page, 'Hello');
    await runAndWait(page);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `playground (${scheme})`);
    }
    await setEditor(page, page.locator('main'), 'int main(void) {\n    for (;;) { }\n}\n');
    await runButton(page).click();
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeVisible({ timeout: RUN_TIMEOUT });
    await stop.click();
    await expect(page.getByText('Stopped.')).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(runButton(page)).toBeEnabled();
  });
});

test('without JSPI (Safari, Firefox) the input box is how a program gets input, and it still runs', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', e => { throw e; });
  page.on('dialog', d => void d.accept());
  // Take away the feature that lets a program pause for typing, as those browsers do not have it.
  await page.addInitScript(() => {
    const wasm = WebAssembly as unknown as Record<string, unknown>;
    for (const name of ['Suspending', 'promising']) Object.defineProperty(wasm, name, { value: undefined, configurable: true });
  });
  await page.goto('#/playground');
  await expect(page.getByText("This browser can't pause a program to wait for typing")).toBeVisible();
  await loadExample(page, 'Read input');
  await runAndWait(page);
  await expect(output(page)).toContainText('2 + 40 = 42');
  await expect(page.locator('#term-input')).toHaveCount(0);

  // No input typed: the program reads end-of-input, which the course helper reports, instead of hanging.
  await page.getByLabel('Input for the program (stdin)').fill('');
  await runAndWait(page, 1);
  await expect(output(page)).toContainText('(end of input)');
  await page.context().close();
});

test('low-memory mode: Run is disabled, the reason is shown, and the compiler is never downloaded', async ({ page }) => {
  const toolchainRequests: string[] = [];
  page.on('request', r => { if (/toolchain\/clang-/.test(r.url())) toolchainRequests.push(r.url()); });
  await page.goto('#/settings');
  await page.getByLabel(/Low-memory mode/).check();
  await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Playground' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
  await expect(page.getByText(/Low-memory mode is on, so the compiler is never downloaded/)).toBeVisible();
  await expect(runButton(page)).toBeDisabled();
  await page.waitForLoadState('networkidle');
  expect(toolchainRequests).toEqual([]);
});
