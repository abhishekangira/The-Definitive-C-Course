// Issue #2: the paths Safari, Firefox and phone learners use, and learners who never touch a mouse.
//   1. No JSPI (the run worker too: launch flag, not an init script) on a 390x844 touch viewport:
//      lesson 5 (get-int-reprompt, scanf-returns, hello-its-me) and the exercise's "Input for Run" box.
//   2. No route scrolls sideways at 390 px.
//   3. Lesson 1 with the keyboard only (Tab, Shift+Tab, Enter, Space; arrows inside a radio group; typed text in fields).
import { test, expect, type Browser, type ElementHandle, type Locator, type Page } from '@playwright/test';
import { answerQuiz, availableModules, completeLesson, progressJson, topLevel, type ModuleInfo } from './lib';
import { normOutput } from '../src/interactions/platform';

const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);
const mod: ModuleInfo = availableModules()[0];
const lessonStem = (n: number) => mod.lessons.find(l => l.stem.startsWith(String(n).padStart(2, '0')))!.stem;

// Each test below sets up what it needs (once per page), so any of them also runs alone with -g.
const done = new WeakMap<Page, Set<string>>();
async function once(page: Page, step: string, run: () => Promise<void>) {
  const steps = done.get(page) ?? done.set(page, new Set()).get(page)!;
  if (steps.has(step)) return;
  await run();
  steps.add(step);
}
const warmUp = (page: Page) => once(page, 'warm-up', () => finishWarmUp(page));
// completePredict compares the browser's output with the output verified in Node, for get-int-reprompt and scanf-returns.
const lesson5 = (page: Page) => once(page, 'lesson5', async () => { await warmUp(page); await completeLesson(page, mod, lessonStem(5)); });

async function finishWarmUp(page: Page) {
  await page.goto(`#/m/${mod.id}/retrieval`);
  await answerQuiz(page, mod, 'retrieval');
  await page.getByRole('button', { name: 'Finish warm-up' }).click();
  await expect(page.getByText('Warm-up done: the lessons are open.')).toBeVisible();
}

async function expectNoSidewaysScroll(page: Page, what: string) {
  // clientWidth, not innerWidth: with isMobile Chromium grows innerWidth to the content width, so scrollWidth <= innerWidth never fails.
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll, `scrollWidth on ${what}`).toBeLessThanOrEqual(width);
}

test.describe.serial('no JSPI on a phone (390x844)', () => {
  let browser: Browser;
  let page: Page;
  test.beforeAll(async ({ playwright }, testInfo) => {
    // A Chromium that really lacks JSPI, in the page and in the run worker (an init script would only hide it from the page).
    const base = testInfo.project.use.launchOptions ?? {};
    browser = await playwright.chromium.launch({ ...base, args: [...(base.args ?? []), '--js-flags=--no-experimental-wasm-jspi'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: testInfo.project.use.baseURL });
    page = await context.newPage();
    page.on('pageerror', e => { throw e; });
    page.on('dialog', d => void d.accept());
  });
  test.afterAll(async () => { await browser.close(); });

  test('this browser has no JSPI and Settings says input is pre-filled only', async () => {
    await page.goto('#/settings');
    await expect(page.getByText('pre-filled input only')).toBeVisible();
    expect(await page.evaluate(() => typeof (WebAssembly as unknown as Record<string, unknown>).Suspending)).toBe('undefined');
  });

  test('warm-up, then lesson 5 runs its samples and exercise on preset input', async () => {
    await lesson5(page);
    for (const id of ['get-int-reprompt', 'scanf-returns']) await expect(page.locator(`[data-sample="${id}"]`)).toBeVisible();
    await expect(page.locator('#term-input')).toHaveCount(0);
  });

  test('hello-its-me: the "Input for Run" box feeds the program, and empty input ends it instead of waiting', async () => {
    await lesson5(page);
    await page.goto(`#/m/${mod.id}/${lessonStem(5)}`);
    const box = page.locator('[data-exercise="hello-its-me"]');
    await box.scrollIntoViewIfNeeded();
    const run = box.getByRole('button', { name: 'Run', exact: true });
    const log = box.getByRole('log');
    await box.getByText('Input for Run').click();
    // Regression: the box used to say "Leave empty to type input interactively" in every browser.
    await expect(box.getByText('Leave empty to type input interactively'), 'without JSPI the box must not promise interactive input').toHaveCount(0);
    await expect(box.getByText('This browser cannot pause a program to wait for typing')).toBeVisible();
    await box.getByLabel('Standard input for Run').fill('Linus\n');
    await run.click();
    await expect(box.getByText('Program exited with status 0.')).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(log).toContainText("What's your name? hello, Linus");

    await box.getByLabel('Standard input for Run').fill('');
    await run.click();
    await expect(box.getByText(/^Program exited with status [1-9]/)).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(log).toContainText('(end of input)');
    await expect(box.locator('#term-input')).toHaveCount(0);
  });

  test('every route fits a 390 px screen without sideways scrolling', async () => {
    await lesson5(page);
    const routes: Array<[string, string]> = [
      ['', 'course map'], [`#/m/${mod.id}`, 'module page'], [`#/m/${mod.id}/retrieval`, 'warm-up'],
      ...mod.lessons.map(l => [`#/m/${mod.id}/${l.stem}`, `lesson ${l.stem}`] as [string, string]),
      [`#/m/${mod.id}/project`, 'project'], [`#/m/${mod.id}/checkpoint`, 'checkpoint'],
      ['#/playground', 'playground'], ['#/settings', 'settings'], ['#/about', 'about'], ['#/no-such-page', 'not found'],
    ];
    for (const [route, what] of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }).first(), what).toBeVisible();
      await expect(page.locator('[data-loading="true"]'), `${what} finished loading`).toHaveCount(0);
      await expectNoSidewaysScroll(page, what);
    }
    // Lesson 5 again with every card open (the exercise and its terminal are the widest things on it).
    await page.goto(`#/m/${mod.id}/${lessonStem(5)}`);
    await expect(page.locator('[data-exercise="hello-its-me"]')).toBeVisible();
    await expectNoSidewaysScroll(page, 'lesson 5 with every card open');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Keyboard only. Navigation uses Tab, Shift+Tab, Enter and Space; the browser's own radio-group arrows move inside
// a group (Tab visits a group once), and text fields and the editor are typed into. Nothing here calls click().

test.describe.serial('lesson 1 with the keyboard only', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    page.on('pageerror', e => { throw e; });
    page.on('dialog', d => void d.accept());
  });
  test.afterAll(async () => { await page.context().close(); });

  const key = (k: string) => page.keyboard.press(k);
  const inEditor = () => page.evaluate(() => Boolean(document.activeElement?.closest('.cm-content')));
  /** A focused element must show it: an outline or box-shadow on itself, its label, or (editor) the frame around CodeMirror (.editor:focus-within). */
  const hasFocusIndicator = (el: ElementHandle) => el.evaluate(node => {
    const e = node as Element;
    // Computed colours come as rgb()/rgba() or, for color-mix(), as color(srgb r g b / a).
    const COLOR = /(?:rgba?|color)\([^)]*\)/;
    const alpha = (color: string) => {
      const m = COLOR.exec(color);
      if (!m) return 0;
      const inner = m[0].slice(m[0].indexOf('(') + 1, -1);
      if (inner.includes('/')) return Number(inner.split('/')[1]);
      const parts = inner.split(/[ ,]+/).filter(Boolean);
      return m[0].startsWith('rgba') && parts.length > 3 ? Number(parts[3]) : 1;
    };
    // Visible: a real outline (style, width, non-transparent colour) or a ring shadow (offset 0, spread >= 2px, not transparent).
    // A decorative drop shadow (blur, no spread) does not count.
    const shown = (n: Element | null) => {
      if (!n) return false;
      const c = getComputedStyle(n);
      if (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0 && alpha(c.outlineColor) >= 0.2) return true;
      return c.boxShadow.split(/,(?![^(]*\))/).some(layer => {
        const lengths = (layer.replace(COLOR, '').match(/-?[\d.]+px/g) ?? []).map(parseFloat);
        const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
        return x === 0 && y === 0 && blur === 0 && spread >= 2 && alpha(layer) >= 0.2;
      });
    };
    // A visually hidden control (1px, clipped) is not where the learner looks: its label must show the focus.
    const r = e.getBoundingClientRect();
    const hidden = r.width < 4 || r.height < 4;
    return (!hidden && shown(e)) || shown(e.closest('label')) || shown(e.closest('.cm-editor')?.parentElement ?? null);
  });
  /** One Tab press; inside the editor Tab indents, so leave it first (Esc, then Tab: see CodeEditorImpl.tsx). */
  async function tab(back = false) {
    if (await inEditor()) await key('Escape');
    await key(back ? 'Shift+Tab' : 'Tab');
  }
  /** Tab (or Shift+Tab) until `target` has focus; fails if a focus order never reaches it. */
  async function focusByTab(target: Locator, what: string, back = false) {
    const el = await target.elementHandle({ timeout: 10_000 });
    if (!el) throw new Error(`${what}: not in the page`);
    for (let presses = 0; presses < 150; presses++) {
      if (await el.evaluate(e => e === document.activeElement)) {
        expect(await hasFocusIndicator(el), `${what}: focus must be visible (a visible outline or ring shadow on it or its label)`).toBe(true);
        return;
      }
      await tab(back);
    }
    throw new Error(`${what}: not reached in 150 Tab presses`);
  }
  async function press(target: Locator, what: string, k: 'Enter' | 'Space') {
    await focusByTab(target, what);
    await key(k);
  }

  /** Pick the first radio, submit, read which one the page marks correct, move there with arrows and submit again. */
  async function answerChoiceByKeyboard(scope: Locator, submit: Locator, what: string) {
    const radios = scope.locator('input[type=radio]');
    await focusByTab(radios.first(), `${what}: first option`);
    await key('Space');
    await press(submit, `${what}: Check`, 'Enter');
    const labels = scope.locator('label[data-correct]');
    const correct = (await labels.evaluateAll(ls => ls.map(l => l.getAttribute('data-correct')))).indexOf('true');
    expect(correct, `${what}: the page marks one option correct`).toBeGreaterThanOrEqual(0);
    await focusByTab(radios.first(), `${what}: checked option`, true);
    for (let i = 0; i < correct; i++) await key('ArrowDown');
    await expect(radios.nth(correct)).toBeChecked();
    await press(submit, `${what}: Check again`, 'Enter');
  }

  test('every card of lesson 1 can be completed with Tab, Shift+Tab, Enter and Space', async () => {
    await warmUp(page); // with the mouse: the warm-up is not under test
    await page.goto(`#/m/${mod.id}/${lessonStem(1)}`);
    const first = page.locator('section[data-card="0"]');
    await expect(first).toBeVisible();
    const total = Number(/of (\d+)$/.exec((await first.getAttribute('aria-label'))!)![1]);
    for (let i = 0; i < total; i++) {
      const card = page.locator(`section[data-card="${i}"]`);
      await expect(card, `card ${i + 1} of ${total}`).toBeVisible();
      if (i < total - 1) await expect(topLevel(card).first()).toBeVisible();
      await expect(card.locator('[data-loading="true"]')).toHaveCount(0);
      for (const box of await topLevel(card).all()) {
        const kind = await box.getAttribute('data-interaction');
        if (kind === 'predict') {
          const id = (await box.getAttribute('data-sample'))!;
          await focusByTab(box.locator('textarea').first(), `${id}: prediction box`);
          await page.keyboard.insertText(normOutput(mod.samples.samples[id].answer.stdout));
          await press(box.getByRole('button', { name: 'Lock in my prediction' }), `${id}: lock in`, 'Enter');
          await press(box.getByRole('button', { name: 'Run', exact: true }), `${id}: Run`, 'Space');
          await expect(box.getByText('Your prediction was right.', { exact: true })).toBeVisible({ timeout: RUN_TIMEOUT });
        } else if (kind === 'choice') {
          await answerChoiceByKeyboard(box, box.getByRole('button', { name: /^(Check|Check again)$/ }), `card ${i + 1} choice`);
          await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
        } else if (kind === 'compiler-error') {
          const id = (await box.getAttribute('data-sample'))!;
          const diag = mod.samples.samples[id].results['wasm32-clang22']!.compile.diagnostics.find(d => d.severity !== 'note')!;
          const lines = box.locator('input[type=radio][aria-label^="Line "]');
          await focusByTab(lines.first(), `${id}: line list`);
          for (let n = 1; n < diag.line; n++) await key('ArrowDown');
          await expect(box.getByText('Yes: the file:line:col prefix says so.', { exact: true })).toBeVisible();
          const questionOptions = box.locator('form input[type=radio]');
          await answerChoiceByKeyboard(box.locator('form'), box.getByRole('button', { name: /^Check$/ }), `${id}: question`);
          await expect(questionOptions.first()).toBeAttached();
          // Fix the program in the editor, leave it with Esc then Tab, compile, continue.
          const fixed = mod.samples.samples[`${id}-fixed`].code;
          await focusByTab(box.locator('.cm-content[contenteditable="true"]').first(), `${id}: editor`);
          await key('ControlOrMeta+a');
          await page.keyboard.insertText(fixed);
          await press(box.getByRole('button', { name: 'Compile and check' }), `${id}: Compile and check`, 'Enter');
          await expect(box.getByText(/^\s*Fixed: it compiles cleanly/)).toBeVisible({ timeout: RUN_TIMEOUT });
          await press(box.getByRole('button', { name: 'Continue' }), `${id}: Continue`, 'Space');
        } else throw new Error(`no keyboard handler for interaction "${kind}"`);
      }
    }
    expect((await progressJson(page)).lessons?.[mod.lessons[0].id], 'lesson 1 complete').toBeTruthy();
  });

  test('the code editor never traps focus: Tab indents, Esc then Tab and Shift+Tab leave (pins the documented contract, whoever implements it)', async () => {
    // End to end: CodeMirror's keymap and the wrapper's Escape handler (CodeEditorImpl.tsx) both leave focus out, so removing
    // only one of them does not fail this test; it fails if focus can get trapped.
    await page.goto('#/playground');
    await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
    const editor = page.locator('main .cm-content[contenteditable="true"]').first();
    await focusByTab(editor, 'playground editor');
    await key('ControlOrMeta+Home');
    await key('Tab');
    expect(await inEditor(), 'Tab alone stays in the editor (it indents)').toBe(true);
    await key('Escape');
    await key('Tab');
    expect(await inEditor(), 'Esc then Tab leaves the editor').toBe(false);
    expect(await page.evaluate(() => document.activeElement?.tagName), 'focus lands on something real, not <body>').not.toBe('BODY');
    await focusByTab(editor, 'editor again', true);
    await key('Shift+Tab');
    expect(await inEditor(), 'Shift+Tab leaves the editor').toBe(false);
  });
});
