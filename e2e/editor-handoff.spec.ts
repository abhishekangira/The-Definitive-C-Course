// The editor is a lazy chunk. While it loads, a static placeholder stands in; these tests hold the chunk back
// (route gate, so no timing guesses) and check what carries over when the real editor replaces the placeholder:
// focus, caret/selection and plain typing, and that a request for a placeholder the learner left never fires later.
import { test, expect, type Page } from '@playwright/test';
import { availableModules } from './lib';

const mod = availableModules()[0];
const lesson = mod.lessons[2];
const url = `#/m/${mod.id}/${lesson.stem}`;

async function open(page: Page) {
  const quizKey = `${mod.id}:retrieval`;
  // Every card of the lesson unlocked and the warm-up passed, so all editors are on the page at once.
  await page.addInitScript(([lessonId, quizKey]) => {
    if (localStorage.getItem('tdcc:v1:progress')) return;
    const cards = { [lessonId]: Array.from({ length: 40 }, (_, k) => k) };
    localStorage.setItem('tdcc:v1:progress', JSON.stringify({ version: 1, seed: '0123456789abcdef', settings: {}, cards, lessons: {}, samples: {}, exercises: {}, quizzes: { [quizKey]: { passed: true, score: 1, total: 1, at: 'x', answers: {} } }, projects: {} }));
  }, [lesson.id, quizKey]);
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  await page.route(/CodeEditorImpl-.*\.js/, async route => { await gate; await route.continue(); });
  await page.goto(url);
  return release;
}

const placeholders = (page: Page) => page.getByRole('group', { name: /\(editor loading\)$/ });

test('typing, caret and focus carry over from the placeholder to the editor', async ({ page }) => {
  const release = await open(page);
  // The fix-the-code exercise editor (pyramid.c) is the only editable editor in this lesson.
  const ph = page.getByRole('group', { name: /pyramid\.c \(editor loading\)$/ });
  await expect(ph).toBeVisible();
  const label = (await ph.getAttribute('aria-label'))!.replace(' (editor loading)', '');

  // Click inside the second line (not offset 0), then type while the chunk is still blocked.
  await ph.click({ position: { x: 120, y: 10 + 20.3 * 1.5 } });
  const original = (await ph.textContent())!;
  await page.keyboard.type('ZZ');
  expect(await ph.textContent(), 'placeholder is never edited in place').toBe(original);

  release();
  const editor = page.getByRole('textbox', { name: label });
  await expect(editor).toBeFocused();
  const text = (await editor.innerText()).replace(/\u200b/g, '');
  expect(text, 'typed keys were replayed into the editor').toContain('ZZ');
  expect(text.startsWith('ZZ'), 'caret did not reset to offset 0').toBe(false);
  // The caret sits right after what was replayed: the next keys continue there.
  await page.keyboard.type('QQ');
  expect(await editor.innerText()).toContain('ZZQQ');
});

test('a selection made in a read-only placeholder is kept', async ({ page }) => {
  const release = await open(page);
  const ph = placeholders(page).first();
  await expect(ph).toBeVisible();
  await ph.click({ position: { x: 100, y: 25 }, clickCount: 3 });
  const before = (await page.evaluate(() => getSelection()!.toString())).trim();
  expect(before.length).toBeGreaterThan(0);
  release();
  await expect(page.locator('.cm-content').first()).toBeFocused();
  expect((await page.evaluate(() => getSelection()!.toString())).trim()).toBe(before);
});

test('focus requested before navigating away does not steal focus on return', async ({ page }) => {
  const release = await open(page);
  const ph = placeholders(page).first();
  await expect(ph).toBeVisible();
  await ph.focus();
  await expect(ph).toBeFocused();
  await page.goto(`#/m/${mod.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  release();
  await page.goto(url);
  await expect(page.locator('.cm-content').first()).toBeVisible();
  await expect(placeholders(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false), 'no editor was focused automatically').toBe(false);
});
