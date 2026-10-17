// Module 2's new views, driven where a learner meets them: the wheel (2.3), the float editor (2.5), the byte viewer
// (2.2 and 2.7) and the YouTube clip (2.6). Each is checked for behaviour, for keyboard use, and with axe in the
// light and the dark colour scheme (course.spec.ts runs axe only in the default scheme and on one lesson per module).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { answerQuiz, availableModules, completeLesson, expectAccessible, seedPriorModules, topLevel } from './lib';

const only = process.env.E2E_MODULE;
const mod = availableModules().find(m => m.id === 'm02');
test.skip(!mod || Boolean(only && only !== 'm02'), 'Module 2 is not part of this run');

const stem = (n: number) => mod!.lessons[n - 1].stem;

async function bothSchemes(page: Page, what: string) {
  try {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectAccessible(page, `${what} (${colorScheme} scheme)`);
    }
  } finally {
    await page.emulateMedia({ colorScheme: null });
  }
}

const done = new Set<number>();
/** Completes the lesson once (every card, as a learner would), then returns the card that holds `selector`. */
async function cardWith(page: Page, lesson: number, selector: string): Promise<Locator> {
  if (!done.has(lesson)) { await completeLesson(page, mod!, stem(lesson)); done.add(lesson); }
  await page.goto(`#/m/${mod!.id}/${stem(lesson)}`);
  const card = page.locator('section[data-card]').filter({ has: page.locator(selector) }).first();
  await expect(card, `lesson ${lesson} has a card with ${selector}`).toBeVisible();
  await card.locator(selector).first().scrollIntoViewIfNeeded();
  return card;
}

test.describe.serial('Module 2 views', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await seedPriorModules(context, mod!);
    page = await context.newPage();
    page.on('pageerror', e => { throw e; });
    page.on('dialog', d => void d.accept());
    await page.goto(`#/m/${mod!.id}/retrieval`);
    await answerQuiz(page, mod!, 'retrieval');
    await page.getByRole('button', { name: 'Finish warm-up' }).click();
    await expect(page.getByText('Warm-up done: the lessons are open.')).toBeVisible();
  });
  test.afterAll(async () => { await page.context().close(); });

  test('2.3 wheel: three presses of Add 1 from 253 reach 0, Subtract 1 goes back, and the keyboard works', async () => {
    const card = await cardWith(page, 3, '[data-view="wheel"]');
    const wheel = card.locator('[data-view="wheel"]');
    const unsigned = wheel.locator('[data-read="unsigned"]');
    const signed = wheel.locator('[data-read="signed"]');
    await expect(unsigned).toHaveText('253');
    await expect(signed).toHaveText('-3');
    const add = wheel.getByRole('button', { name: 'Add 1', exact: true });
    await add.click();
    await expect(unsigned).toHaveText('254');
    await add.click();
    await expect(unsigned).toHaveText('255');
    await expect(signed).toHaveText('-1');
    await add.click();
    await expect(unsigned).toHaveText('0');
    await expect(signed).toHaveText('0');
    await wheel.getByRole('button', { name: 'Subtract 1', exact: true }).click();
    await expect(unsigned).toHaveText('255');
    // The text alternative of the ring says where the marker is.
    await expect(wheel.getByRole('img')).toHaveAttribute('aria-label', /marker is at 255 as an unsigned number, -1 as a signed number/);
    // Keyboard only: focus Subtract 1, Tab to Add 1, press Space (255 + 1 wraps to 0), then Enter (to 1).
    await wheel.getByRole('button', { name: 'Subtract 1', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await page.keyboard.press('Space');
    await expect(unsigned).toHaveText('0');
    await page.keyboard.press('Enter');
    await expect(unsigned).toHaveText('1');
    await bothSchemes(page, 'lesson 2.3 wheel');
  });

  for (const [lesson, title] of [[3, 'An 8-bit counter, two readings'], [5, 'Inside a float']] as const) {
    test(`2.${lesson} animation card "${title}" shows its player, ends with an interaction, and passes axe in both schemes`, async () => {
      const card = await cardWith(page, lesson, `figure[aria-label="Animation: ${title}"]`);
      await expect(card.locator(`figure[aria-label="Animation: ${title}"]`)).toBeVisible();
      await expect(topLevel(card).first()).toBeVisible();
      await bothSchemes(page, `lesson 2.${lesson} animation`);
    });
  }

  test('2.5 float editor: 1.0 is 0x3F800000, the sign bit flips the sign, and the keyboard works', async () => {
    const card = await cardWith(page, 5, '[data-view="float"]');
    const editor = card.locator('[data-view="float"]');
    await expect(editor.locator('[data-read="value"]')).toHaveText('1');
    await expect(editor.locator('[data-read="hex"]')).toHaveText('0x3F800000');
    await editor.getByRole('button', { name: 'sign bit 0: 0' }).click();
    await expect(editor.locator('[data-read="value"]')).toHaveText('-1');
    await expect(editor.locator('[data-read="hex"]')).toHaveText('0xBF800000');
    // Keyboard only: the same bit button, Space flips it back.
    await editor.getByRole('button', { name: 'sign bit 0: 1' }).focus();
    await page.keyboard.press('Space');
    await expect(editor.locator('[data-read="hex"]')).toHaveText('0x3F800000');
    await editor.getByRole('button', { name: 'sign bit 0: 0' }).press('Enter');
    await expect(editor.locator('[data-read="hex"]')).toHaveText('0xBF800000');
    // Typing a number updates the fields.
    await editor.getByLabel('Type a number:').fill('0.1');
    await expect(editor.locator('[data-read="hex"]')).toHaveText('0x3DCCCCCD');
    await bothSchemes(page, 'lesson 2.5 float editor');
  });

  test('2.2 byte viewer: 1000000 is 40 42 0F 00 in little-endian order and reversed in big-endian', async () => {
    const card = await cardWith(page, 2, '[data-view="bytes"]');
    const viewer = card.locator('[data-view="bytes"]');
    const bytes = () => viewer.locator('ol li').evaluateAll(els => els.map(e => e.getAttribute('data-byte')));
    await expect.poll(bytes).toEqual(['40', '42', '0F', '00']);
    await viewer.getByRole('button', { name: 'Big-endian' }).click();
    await expect.poll(bytes).toEqual(['00', '0F', '42', '40']);
    await expect(viewer.getByRole('button', { name: 'Big-endian' })).toHaveAttribute('aria-pressed', 'true');
    // Keyboard only: focus the other button, press Space.
    await viewer.getByRole('button', { name: 'Little-endian' }).focus();
    await page.keyboard.press('Space');
    await expect.poll(bytes).toEqual(['40', '42', '0F', '00']);
    await bothSchemes(page, 'lesson 2.2 byte viewer');
  });

  test('2.7 byte viewer: the euro sign takes three UTF-8 bytes', async () => {
    const card = await cardWith(page, 7, '[data-view="utf8"]');
    const viewer = card.locator('[data-view="utf8"]');
    await expect(viewer.locator('[data-read="count"]')).toHaveText('3');
    await expect(viewer.locator('ol li').evaluateAll(els => els.map(e => e.getAttribute('data-byte')))).resolves.toEqual(['E2', '82', 'AC']);
    await viewer.getByLabel(/Type one character/).fill('A');
    await expect(viewer.locator('[data-read="count"]')).toHaveText('1');
    await bothSchemes(page, 'lesson 2.7 UTF-8 viewer');
  });

  test('2.6 YouTube clip: facade, accessibility in both schemes, and the embed address (YouTube is blocked)', async () => {
    const blocked: string[] = [];
    await page.context().route(/youtube(-nocookie)?\.com|ytimg\.com|googlevideo\.com/, route => { blocked.push(route.request().url()); return route.abort(); });
    const card = await cardWith(page, 6, 'figure button');
    const facade = card.getByRole('button', { name: /Watch a .*-minute clip/ });
    await expect(facade).toBeVisible();
    await bothSchemes(page, 'lesson 2.6 clip facade');
    await facade.click();
    const frame = page.locator('figure', { hasText: 'Why this clip' }).locator('iframe');
    await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/SlqjA04_dpk\?start=8531&end=8701/);
    expect(blocked.every(u => /youtube|ytimg|googlevideo/.test(u))).toBe(true);
  });
});
