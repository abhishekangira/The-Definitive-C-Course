// Yellow and red prediction results on m01 lesson 2, sample int-division (issue #105).
// The yellow test then uses Predict again and an exact prediction, which is green.
// The spec seeds the warm-up and the two cards before int-division so it does not compile them.
// Screenshots are written only when SHOTS is a directory.
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { availableModules, expectAccessible } from './lib';

const mod = availableModules()[0];
const stem = mod.lessons.find(l => l.stem.startsWith('02'))!.stem;
const CLOSE = 'Almost: the values are right, but the spacing, punctuation or line breaks differ.';
const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);

async function seed(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    const key = 'tdcc:v1:progress';
    if (localStorage.getItem(key)) return;
    const at = '2026-01-01T00:00:00.000Z';
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      seed: '00e2e00e2e00e2e0',
      createdAt: at,
      settings: {},
      cards: { 'm01-l2': [0, 1] },
      lessons: {},
      samples: {},
      exercises: {},
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } },
      projects: {},
      streak: { days: [], longest: 0 },
    }));
  });
}

async function openSample(page: Page) {
  await seed(page);
  await page.goto(`#/m/${mod.id}/${stem}`);
  const box = page.locator('[data-sample="int-division"]');
  await expect(box).toBeVisible();
  return box;
}

/** The program-output panel is the terminal log. Compare boxes must use its monospace font, size, line height and padding. */
async function expectMonoCompare(box: Locator) {
  const panel = box.locator('[role="log"]');
  const panelStyle = await panel.evaluate(el => {
    const cs = getComputedStyle(el);
    return { font: cs.fontFamily, pad: cs.padding, fontSize: cs.fontSize, lineHeight: cs.lineHeight };
  });
  const mono = await box.evaluate(el => {
    const probe = document.createElement('span');
    probe.style.fontFamily = 'var(--font-mono)';
    el.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  });
  expect(panelStyle.font).toBe(mono);
  for (const which of ['predicted', 'actual']) {
    const style = await box.locator(`[data-compare="${which}"]`).evaluate(el => {
      const cs = getComputedStyle(el);
      const line = el.querySelector('[data-line]');
      return { font: cs.fontFamily, pad: cs.padding, fontSize: cs.fontSize, lineHeight: cs.lineHeight, display: line ? getComputedStyle(line).display : '' };
    });
    expect(style.font, which).toBe(panelStyle.font);
    // The sans stack is "Geist Variable", Geist, ui-sans-serif. "Geist Mono" does not contain those.
    expect(style.font, which).not.toContain('Geist Variable');
    expect(style.font, which).not.toContain('ui-sans-serif');
    expect(style.pad, which).not.toBe('0px');
    expect(style.pad, which).toBe(panelStyle.pad);
    expect(style.fontSize, which).toBe(panelStyle.fontSize);
    expect(style.lineHeight, which).toBe(panelStyle.lineHeight);
    expect(style.display, which).toBe('block');
  }
}

/** Check the painted colour, since a missing fill computes as transparent rather than the box colour. */
async function expectTintedDiff(box: Locator) {
  const colours = await box.locator('[data-diff]').first().evaluate(el => ({
    mark: getComputedStyle(el).backgroundColor,
    box: getComputedStyle(el.closest('[data-compare]')!).backgroundColor,
  }));
  expect(colours.mark).not.toBe('rgba(0, 0, 0, 0)');
  expect(colours.mark).not.toBe(colours.box);
}

async function shots(page: Page, box: ReturnType<Page['locator']>, name: string) {
  const dir = process.env.SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const [scheme, label] of [['light', 'light'], ['dark', 'dark']] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [width, height] of [[1400, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await box.scrollIntoViewIfNeeded();
      await box.screenshot({ path: `${dir}/${name}-${label}-${width}.png` });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('a close prediction on int-division is yellow, with both boxes and the commas marked', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  const area = box.locator('textarea');
  await area.fill('3, -3, 1\n3.5');
  await area.focus();
  await page.keyboard.press('Tab');
  await expect(box.getByRole('button', { name: 'Lock in my prediction' })).toBeFocused();
  await page.keyboard.press('Enter');
  const run = box.getByRole('button', { name: 'Run', exact: true });
  await run.focus();
  await expect(run).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  // The terminal's exit line is a second role=status inside the sample. The verdict is the yellow one.
  const status = box.getByRole('status').filter({ hasText: 'Almost:' });
  await expect(status).toContainText(CLOSE);
  await expect(status.locator('svg')).toHaveAttribute('data-icon', 'almost');
  await expect(status.getByText('You predicted')).toHaveCount(0);
  await expect(box.getByText('You predicted', { exact: true })).toBeVisible();
  await expect(box.getByText('Actual output', { exact: true })).toBeVisible();
  await expect(box.locator('[data-compare="predicted"] [data-line]')).toHaveCount(2);
  await expect(box.locator('[data-compare="predicted"] [data-diff]')).toHaveText([',', ',']);
  await expect(box.locator('[data-compare="actual"] [data-diff]')).toHaveCount(0);
  await expect(status).toHaveCSS('background-color', 'rgb(253, 241, 220)');
  const underline = await box.locator('[data-diff]').first().evaluate(el => getComputedStyle(el).textDecorationLine);
  expect(underline).toContain('underline');
  await expectTintedDiff(box);
  await expectMonoCompare(box);
  await expectAccessible(page, 'yellow close box, light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(status).toHaveCSS('background-color', 'rgb(43, 35, 18)');
  await expectTintedDiff(box);
  await expectAccessible(page, 'yellow close box, dark');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await shots(page, box, 'yellow');

  const again = box.getByRole('button', { name: 'Predict again' });
  await again.focus();
  await expect(again).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box.getByRole('button', { name: 'Lock in my prediction' })).toBeVisible();
  await expect(box.locator('textarea')).toHaveValue('');
  await expect(box.getByRole('status')).toHaveCount(0);
  await box.locator('textarea').fill('3 -3 1\n3.5');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const green = box.getByRole('status').filter({ hasText: 'Your prediction was right.' });
  await expect(green).toBeVisible();
  await expect(green.locator('svg')).toHaveAttribute('data-icon', 'check');
  await expect(box.getByText('You predicted')).toHaveCount(0);
});

test('a wrong prediction on int-division is red, with both boxes, in light and dark', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  await box.locator('textarea').fill('nope');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const status = box.getByRole('status').filter({ hasText: 'Not quite.' });
  await expect(status).toContainText('Not quite.');
  await expect(status.locator('svg')).toHaveAttribute('data-icon', 'cross');
  await expect(box.getByText('You predicted', { exact: true })).toBeVisible();
  await expect(box.getByText('Actual output', { exact: true })).toBeVisible();
  await expect(box.locator('[data-compare="predicted"]')).toContainText('nope');
  await expect(box.locator('[data-compare="actual"] [data-line]')).toHaveCount(2);
  await expectMonoCompare(box);
  await expect(status).toHaveCSS('background-color', 'rgb(253, 236, 235)');
  await expectAccessible(page, 'red prediction box, light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(status).toHaveCSS('background-color', 'rgb(50, 24, 22)');
  await expectAccessible(page, 'red prediction box, dark');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await shots(page, box, 'red');
});

/** Selects the whole box, copies it with the keyboard and returns the clipboard text. */
async function copyBox(page: Page, box: Locator): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('(clipboard not written)'));
  await box.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+C');
  return page.evaluate(() => navigator.clipboard.readText());
}

test('copying the predicted box gives the prediction exactly, blank line included', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  await box.locator('textarea').fill('nope\n\nmore');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const text = await copyBox(page, box.locator('[data-compare="predicted"]'));
  expect(text).toBe('nope\n\nmore');
  expect(text).not.toContain('\u200b');
});

test('the empty-line note is shown, a blank row is one line tall, and copying either box gives its text exactly', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  await box.locator('textarea').fill('3 -3 1\n\n3.5\nextra');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const predictedBox = box.locator('[data-compare="predicted"]');
  const actualBox = box.locator('[data-compare="actual"]');
  const note = predictedBox.locator('[data-blank]');
  await expect(note).toHaveAttribute('aria-label', 'empty line');
  expect(await note.evaluate(el => getComputedStyle(el, '::before').content)).toBe('"empty line"');
  await expect(actualBox.locator('[data-blank], [aria-label="empty line"], [role="img"]')).toHaveCount(0);
  // Both actual-side gaps (the blank line and "extra") have no note. Every row is one line tall, so the boxes stay aligned.
  for (const b of [predictedBox, actualBox]) {
    expect(await b.locator('[data-line]').count()).toBe(4);
    const heights = await b.locator('[data-line]').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
    const lineHeight = await b.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
    for (const h of heights) expect(h).toBeCloseTo(lineHeight, 1);
  }
  const predicted = await copyBox(page, predictedBox);
  const actual = await copyBox(page, actualBox);
  expect(predicted).toBe('3 -3 1\n\n3.5\nextra');
  expect(actual).toBe('3 -3 1\n3.5');
  for (const t of [predicted, actual]) {
    expect(t).not.toContain('\u200b');
    expect(t).not.toContain('empty line');
  }
  await expectAccessible(page, 'empty-line note');
});

test('a selection that crosses a box edge, or Ctrl+A, still copies the blank line and no gap rows', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  await box.locator('textarea').fill('3 -3 1\n\n3.5\nextra');
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const copy = async (how: 'label' | 'forward' | 'backward' | 'all') => {
    await page.evaluate(() => navigator.clipboard.writeText('(clipboard not written)'));
    if (how === 'all') {
      await box.locator('[data-compare="predicted"]').click();
      await page.keyboard.press('ControlOrMeta+A');
    } else {
      await page.evaluate(how => {
        const p = document.querySelector('[data-compare="predicted"]')!;
        const a = document.querySelector('[data-compare="actual"]')!;
        const label = document.getElementById(p.getAttribute('aria-labelledby')!)!;
        const sel = getSelection()!;
        if (how === 'label') sel.setBaseAndExtent(label.firstChild!, 0, p, p.childNodes.length);
        if (how === 'forward') sel.setBaseAndExtent(p.firstChild!, 0, a, a.childNodes.length);
        if (how === 'backward') sel.setBaseAndExtent(a, a.childNodes.length, p.firstChild!, 0);
      }, how);
    }
    const before = await page.evaluate(() => { const s = getSelection()!; return [s.anchorNode?.nodeName, s.anchorOffset, s.focusNode?.nodeName, s.focusOffset, s.toString()]; });
    await page.keyboard.press('ControlOrMeta+C');
    // The handler reads other ranges through the selection; the learner's selection (direction too) is put back.
    expect(await page.evaluate(() => { const s = getSelection()!; return [s.anchorNode?.nodeName, s.anchorOffset, s.focusNode?.nodeName, s.focusOffset, s.toString()]; })).toEqual(before);
    return page.evaluate(() => navigator.clipboard.readText());
  };
  expect(await copy('label')).toBe('You predicted\n3 -3 1\n\n3.5\nextra');
  expect(await copy('forward')).toBe('3 -3 1\n\n3.5\nextra\nActual output\n3 -3 1\n3.5');
  expect(await copy('backward')).toBe('3 -3 1\n\n3.5\nextra\nActual output\n3 -3 1\n3.5');
  const all = await copy('all');
  const block = '\nYou predicted\n3 -3 1\n\n3.5\nextra\nActual output\n3 -3 1\n3.5\n';
  expect(all).toContain(block);
  // The page text after the boxes (the explanation) is still copied, on the next line.
  expect(all.slice(all.indexOf(block) + block.length)).toMatch(/^\S/);
  expect(all).not.toContain('\u200b');
  expect(all).not.toContain('empty line');
});

test('a long predicted line scrolls inside the box and is keyboard-focusable', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  const box = await openSample(page);
  await box.locator('textarea').fill(`${'x'.repeat(200)}\n`);
  await box.getByRole('button', { name: 'Lock in my prediction' }).click();
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText(/^(Program exited with status|Program crashed|Stopped)/).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const predicted = box.locator('[data-compare="predicted"]');
  const actual = box.locator('[data-compare="actual"]');
  expect(await predicted.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(predicted).toHaveAttribute('tabindex', '0');
  await expect(predicted).toHaveRole('region');
  await expect(predicted).toHaveAccessibleName('You predicted');
  await expect(actual).toHaveAccessibleName('Actual output');
  await predicted.focus();
  await expect(predicted).toBeFocused();
  expect(await predicted.evaluate(el => el.scrollLeft)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => predicted.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-sample="int-division"]').withRules(['scrollable-region-focusable']).analyze();
  expect(results.violations.map(v => v.id)).toEqual([]);
  expect(results.passes.flatMap(v => v.nodes).length).toBeGreaterThan(0);
  await expectAccessible(page, 'long predicted line');
});
