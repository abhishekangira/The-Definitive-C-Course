// The lesson chat: highlight text, choose Explain or Reply, and the tutor answers about the lesson. The provider is a
// stub that streams server-sent events: no real key, no real network.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { availableModules, expectAccessible, priorModulesProgress } from './lib';

const KEY = 'sk-test-not-a-real-key';
const AT = '2026-01-01T00:00:00.000Z';

interface Sent { stream?: boolean; model?: string; messages: { role: string; content: string }[] }

const sse = (...parts: string[]) => parts.map(t => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + 'data: [DONE]\n\n';

/** Progress for module 1 with the given cards of the given lessons done, the module's warm-up done, and the tutor set up (or not). */
async function seed(context: BrowserContext, opts: { cards?: Record<string, number[]>; tutor?: boolean; progress?: Record<string, any> } = {}) {
  const doc = opts.progress ?? {
    version: 1, seed: '0123456789abcdef', createdAt: AT, settings: {}, cards: {}, lessons: {}, samples: {}, exercises: {}, projects: {},
    streak: { days: [], longest: 0 }, quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at: AT, answers: {} } },
  };
  doc.cards = { ...doc.cards, ...opts.cards };
  await context.addInitScript(([progress, tutor, key]) => {
    // Once only: a later navigation must keep the progress the test made.
    if (!localStorage.getItem('tdcc:v1:progress')) localStorage.setItem('tdcc:v1:progress', progress);
    if (tutor && !localStorage.getItem('tdcc:v1:tutor')) {
      localStorage.setItem('tdcc:v1:tutor', JSON.stringify({ version: 1, apiKey: key, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: 'tutor.test', lessonConsentedHost: 'tutor.test' }));
    }
  }, [JSON.stringify(doc), opts.tutor ?? true, KEY] as const);
}

/** Answers every request to the stub provider with the next reply and records the bodies. */
async function stubProvider(page: Page, ...replies: string[][]) {
  const bodies: Sent[] = [];
  const foreign: string[] = [];
  page.on('request', r => { if (/openrouter\.ai/.test(r.url())) foreign.push(r.url()); });
  await page.route(/tutor\.test/, async route => {
    bodies.push(JSON.parse(route.request().postData() ?? '{}') as Sent);
    const parts = replies[Math.min(bodies.length, replies.length) - 1] ?? ['(no reply set up)'];
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(...parts) });
  });
  return { bodies, foreign };
}

const toolbar = (page: Page) => page.locator('[data-tutor="selection"]');
const panel = (page: Page) => page.locator('[data-tutor="lesson-chat"]');
const log = (page: Page) => panel(page).locator('[data-tutor="log"]');

test('highlight, Explain and Reply: the lesson goes with every question, and nothing the learner has not reached', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  // Parts 1 and 2 are done, so parts 1 to 3 are on screen (the third holds the animation). Part 4 on is still locked.
  await seed(context, { cards: { 'm01-l1': [0, 1] } });
  const { bodies, foreign } = await stubProvider(page, ['The compiler ', 'runs first.'], ['Not quite a bundler. ', 'It emits machine code.']);

  await page.goto('#/m/m01/01-hello-compiled-world');
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, compiled world' })).toBeVisible();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await expect(page.locator('details[data-transcript]'), 'the animation has loaded its transcript').toHaveCount(1);
  await expect(panel(page)).toBeHidden();
  await expect(toolbar(page), 'nothing is selected').toHaveCount(0);

  // Highlight a paragraph. The toolbar follows once the selection holds still.
  await page.locator('p', { hasText: 'In JavaScript you hand source code' }).selectText();
  await expect(toolbar(page)).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'Explain' })).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'Reply' })).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `lesson with the selection toolbar (${scheme})`);
  }
  expect(bodies, 'highlighting sends nothing').toEqual([]);

  await toolbar(page).getByRole('button', { name: 'Explain' }).click();
  await expect(toolbar(page), 'the highlight is spent').toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(log(page)).toContainText('The compiler runs first.');
  await expect(log(page)).toContainText('Explain this.');
  await expect(log(page)).toContainText('In JavaScript you hand source code');
  await expect(panel(page).getByRole('button', { name: 'Send' })).toBeVisible();

  expect(bodies).toHaveLength(1);
  const first = bodies[0];
  expect(first.stream).toBe(true);
  expect(first.model).toBe('test-model');
  expect(first.messages.map(m => m.role)).toEqual(['system', 'user']);
  const system = first.messages[0].content;
  expect(system).toContain('Hello, compiled world (Module 1)');
  expect(system).toMatch(/--- Part 1 of \d+ ---/);
  expect(system).toMatch(/--- Part 3 of \d+ ---/);
  expect(system, 'part 4 is not reached').not.toMatch(/--- Part 4 of \d+ ---/);
  expect(system, 'code is read with its indentation, without line numbers').toContain('int main(void) {\n    printf("Hello, world!\\n");');
  expect(system, 'the transcript of the animation shown in part 3').toContain('The page sends your source text to a Web Worker.');
  expect(system, 'a locked part').not.toContain('Compiler messages are precise');
  expect(system, 'the last part').not.toContain('What you know now');
  expect(system, 'the explanation of a question the learner has not answered').not.toContain('Shells, `make` and CI pipelines read it');
  expect(first.messages[1].content).toContain('In JavaScript you hand source code');
  expect(first.messages[1].content).toContain('Explain this.');
  expect(JSON.stringify(first)).not.toContain(KEY);

  // The panel docks beside the lesson and does not cover it.
  const article = await page.locator('article').first().boundingBox();
  const docked = await panel(page).boundingBox();
  expect(article!.x + article!.width, 'the reading column ends before the panel').toBeLessThanOrEqual(docked!.x);

  // Reply: a double-click picks a word with the real mouse; the quote waits above the box for a question.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('p strong', { hasText: 'compiler' }).first().dblclick();
  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).getByRole('button', { name: 'Reply' }).click();
  await expect(panel(page).getByText('Replying to')).toBeVisible();
  await expect(panel(page).locator('q')).toHaveText('compiler');
  await expect(panel(page).getByRole('textbox', { name: 'Your question' }), 'Reply puts the cursor in the box').toBeFocused();
  expect(bodies, 'Reply sends nothing until the learner asks').toHaveLength(1);
  await page.keyboard.type('Is that like a JS bundler?');
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('It emits machine code.');

  expect(bodies).toHaveLength(2);
  const second = bodies[1];
  expect(second.messages.map(m => m.role), 'the whole conversation, not just the new question').toEqual(['system', 'user', 'assistant', 'user']);
  expect(second.messages[0].content, 'the same lesson').toBe(system);
  expect(second.messages[1]).toEqual(first.messages[1]);
  expect(second.messages[2].content).toBe('The compiler runs first.');
  expect(second.messages[3].content).toContain('compiler');
  expect(second.messages[3].content).toContain('Is that like a JS bundler?');
  expect(foreign).toEqual([]);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `lesson with the tutor chat open (${scheme})`);
  }
  await context.close();
});

test('the keyboard reaches the chat without a highlight: button, box, Enter, Escape', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  await seed(context, { cards: { 'm01-l1': [0] } });
  const { bodies } = await stubProvider(page, ['Keyboard answer.']);

  await page.goto('#/m/m01/01-hello-compiled-world');
  const open = page.getByRole('button', { name: 'Ask the tutor' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(open, 'the floating button gives way to the panel').toBeHidden();
  const box = panel(page).getByRole('textbox', { name: 'Your question' });
  await expect(box, 'opening puts the cursor in the box').toBeFocused();
  await page.keyboard.type('What does int main(void) mean?');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Please be short.');
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('Keyboard answer.');
  expect(bodies[0].messages[1].content, 'Shift+Enter is a new line').toBe('What does int main(void) mean?\nPlease be short.');
  expect(bodies[0].messages[1].content, 'no highlight, no quote').not.toContain('highlighted');

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(open, 'focus goes back to the button that opened it').toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(log(page), 'the conversation is still there').toContainText('Keyboard answer.');
  await panel(page).getByRole('button', { name: 'New chat' }).click();
  await expect(log(page)).not.toContainText('Keyboard answer.');
  await context.close();
});

test('a learner who has not set up the tutor sees no button and no toolbar', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seed(context, { cards: { 'm01-l1': [0] }, tutor: false });
  await page.goto('#/m/m01/01-hello-compiled-world');
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, compiled world' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the tutor' })).toHaveCount(0);
  await page.locator('p', { hasText: 'In JavaScript you hand source code' }).selectText();
  await page.waitForTimeout(700);
  await expect(toolbar(page)).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await context.close();
});

test('the first request waits for the learner to agree, and the Explain that asked for it goes out afterwards', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seed(context, { cards: { 'm01-l1': [0] } });
  await context.addInitScript(key => {
    localStorage.setItem('tdcc:v1:tutor', JSON.stringify({ version: 1, apiKey: key, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: '', lessonConsentedHost: '' }));
  }, KEY);
  const { bodies } = await stubProvider(page, ['Allowed now.']);
  await page.goto('#/m/m01/01-hello-compiled-world');
  await page.locator('p', { hasText: 'In JavaScript you hand source code' }).selectText();
  await toolbar(page).getByRole('button', { name: 'Explain' }).click();
  await expect(panel(page).getByText('The first request sends your API key to tutor.test.')).toBeVisible();
  await expect(panel(page).getByText(/the text of the lesson parts you have reached/)).toBeVisible();
  expect(bodies, 'nothing is sent before the learner agrees').toEqual([]);
  await panel(page).getByRole('button', { name: 'Send to tutor.test' }).click();
  await expect(log(page)).toContainText('Allowed now.');
  expect(bodies).toHaveLength(1);
  await context.close();
});

test('an exercise inside a lesson is left out: no toolbar on it, and its text is not sent', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seed(context, { cards: { 'm01-l3': Array.from({ length: 80 }, (_, i) => i) } });
  const { bodies } = await stubProvider(page, ['Fine.']);
  await page.goto('#/m/m01/03-control-flow');
  const exercise = page.locator('[data-exercise="fix-pyramid"]');
  await expect(exercise).toBeVisible();
  const title = ((await exercise.locator('h3').textContent()) ?? '').trim();
  expect(title.length).toBeGreaterThan(3);

  await exercise.locator('h3').selectText();
  await page.waitForTimeout(700);
  await expect(toolbar(page), 'a highlight inside the exercise').toHaveCount(0);

  await page.getByRole('button', { name: 'Ask the tutor' }).click();
  await page.keyboard.type('What is this lesson about?');
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('Fine.');
  const system = bodies[0].messages[0].content;
  expect(system).toContain('[An exercise is here. Its text is left out.]');
  expect(system, 'the exercise title').not.toContain(title);
  await context.close();
});

test('the transcript of a YouTube clip goes with the lesson', async ({ browser }) => {
  const mod = availableModules().find(m => m.id === 'm02');
  test.skip(!mod, 'module 2 is not available');
  const lesson = mod!.lessons.find(l => l.stem === '06-overflow-in-the-real-world')!;
  const doc = priorModulesProgress(mod!)!;
  (doc.quizzes as Record<string, unknown>)['m02:retrieval'] = { score: 1, total: 1, passed: true, at: AT, answers: {} };
  const context = await browser.newContext();
  const page = await context.newPage();
  await seed(context, { progress: doc, cards: { [lesson.id]: Array.from({ length: 80 }, (_, i) => i) } });
  const { bodies } = await stubProvider(page, ['It was a 32-bit counter.']);
  await page.goto(`#/m/m02/${lesson.stem}`);
  const transcript = page.locator('details[data-transcript]').first();
  await expect(transcript).toHaveCount(1);
  await expect(transcript, 'closed until the learner opens it').not.toHaveAttribute('open', '');

  await page.getByRole('button', { name: 'Ask the tutor' }).click();
  await page.keyboard.type('What went wrong in the Boeing clip?');
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('It was a 32-bit counter.');
  const shown = ((await transcript.locator('p').first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  expect(shown.length, 'the transcript is the clip, not a stub').toBeGreaterThan(500);
  expect(bodies[0].messages[0].content, 'the words of the clip, the same as the page shows').toContain(shown);
  await context.close();
});

test('a keyboard selection does not show the toolbar it could not reach; the chat button is the keyboard route', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seed(context, { cards: { 'm01-l1': [0] } });
  await page.goto('#/m/m01/01-hello-compiled-world');
  await page.locator('p', { hasText: 'In JavaScript you hand source code' }).selectText();
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(toolbar(page), 'changed with the keyboard: hidden').toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(toolbar(page), 'and it does not come back when the selection settles').toHaveCount(0);
  await context.close();
});

test('phone width (390x844): the chat fits, Enter is a new line and Send sends', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  await seed(context, { cards: { 'm01-l1': [0] } });
  const { bodies } = await stubProvider(page, ['Short answer.']);
  await page.goto('#/m/m01/01-hello-compiled-world');
  await page.getByRole('button', { name: 'Ask the tutor' }).tap();
  await expect(panel(page)).toBeVisible();
  const box = await panel(page).boundingBox();
  expect(box!.x, 'the panel starts on screen').toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, 'the panel ends on screen').toBeLessThanOrEqual(390);
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll, 'no sideways scroll with the chat open').toBeLessThanOrEqual(width);

  const question = panel(page).getByRole('textbox', { name: 'Your question' });
  await expect(panel(page).getByText('Enter for a new line. Send sends.')).toBeVisible();
  await question.fill('First line');
  await question.press('Enter');
  await question.pressSequentially('second line');
  await expect(question).toHaveValue('First line\nsecond line');
  expect(bodies, 'Enter did not send').toEqual([]);
  await panel(page).getByRole('button', { name: 'Send' }).tap();
  await expect(log(page)).toContainText('Short answer.');
  expect(bodies[0].messages[1].content).toBe('First line\nsecond line');
  await expectAccessible(page, 'lesson chat at phone width');
  await context.close();
});
