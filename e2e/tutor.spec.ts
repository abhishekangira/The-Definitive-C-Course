// Optional AI tutor (issue #47). The provider is a stub: no real key, no real network.
import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Route } from '@playwright/test';
import { expectAccessible, setEditor } from './lib';

const KEY = 'sk-test-not-a-real-key';
const RUN = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);

function userMessage(raw: string): string {
  const sent = JSON.parse(raw) as { messages: { role: string; content: string }[] };
  const user = sent.messages.find(m => m.role === 'user');
  if (!user) throw new Error('the tutor request had no user message');
  return user.content;
}

/** Wait until this check's button has gone through "Checking…" and come back, so a previous result cannot satisfy the assertion. */
async function checkCode(scope: Locator) {
  await scope.getByRole('button', { name: 'Check my code' }).click();
  await expect(scope.getByRole('button', { name: 'Checking…' })).toBeVisible();
  await expect(scope.getByRole('button', { name: 'Check my code' })).toBeVisible({ timeout: RUN });
  await expect(scope.getByText(/\d+ of \d+ checks passed\./)).toBeVisible();
}

test('ask the tutor after a failed check, and nowhere else', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', e => { throw e; });
  page.on('dialog', d => void d.accept());

  const tutorUrls: string[] = [];
  const foreign: string[] = [];
  const bodies: string[] = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('tutor.test') || url.includes('/chat/completions')) tutorUrls.push(url);
    if (url.includes('openrouter.ai')) foreign.push(url);
  });

  let mode: 'nudge' | 'why' | 'leak' | '401' | '429' = 'nudge';
  const fulfill = async (route: Route) => {
    bodies.push(route.request().postData() ?? '');
    if (mode === '401' || mode === '429') {
      await route.fulfill({ status: mode === '401' ? 401 : 429, contentType: 'application/json', body: JSON.stringify({ error: KEY }) });
      return;
    }
    const content = mode === 'leak'
      ? '// Printf("hello, world\\n");'
      : mode === 'why'
        ? 'The check shows an empty actual output.'
        : 'Print the greeting the check expects.';
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  };
  await page.route(/tutor\.test/, fulfill);

  await page.addInitScript(key => {
    // Once only. A later navigation must keep the tutor questions already stored, or the export
    // would be a fresh document and would not show that a real session omits the key.
    if (localStorage.getItem('tdcc:v1:progress')) return;
    const at = '2026-01-01T00:00:00.000Z';
    const lessons: Record<string, { completedAt: string }> = {};
    for (const id of ['m01-l1', 'm01-l2', 'm01-l3', 'm01-l4', 'm01-l5', 'm01-l6']) lessons[id] = { completedAt: at };
    const progress = {
      version: 1, seed: '0123456789abcdef', createdAt: at, settings: {},
      cards: { 'm01-l3': Array.from({ length: 80 }, (_, i) => i) },
      lessons, samples: {}, exercises: {}, projects: {}, streak: { days: [], longest: 0 },
      quizzes: { 'm01:retrieval': { score: 1, total: 1, passed: true, at, answers: {} } },
    };
    localStorage.setItem('tdcc:v1:progress', JSON.stringify(progress));
    if (!localStorage.getItem('tdcc:v1:tutor')) {
      localStorage.setItem('tdcc:v1:tutor', JSON.stringify({
        version: 1, apiKey: key, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: '',
      }));
    }
  }, KEY);

  await page.goto('#/m/m01');
  const details = page.locator('details', { has: page.locator('[data-exercise="hello-world"]') });
  await details.locator(':scope > summary').click();
  const box = details.locator('[data-exercise="hello-world"]');
  await expect(box.getByRole('button', { name: 'Check my code' })).toBeVisible({ timeout: RUN });
  await expect(box.locator('[data-tutor]')).toHaveCount(0);

  await checkCode(box);
  const tutor = box.locator('[data-tutor="ask"]');
  await expect(tutor).toBeVisible();
  await expect(tutor.getByText(/sends your API key to tutor\.test/)).toBeVisible();
  expect(tutorUrls, 'nothing is sent before consent').toEqual([]);
  expect(foreign).toEqual([]);

  await tutor.getByRole('button', { name: 'Send to tutor.test' }).click();
  expect(tutorUrls, 'accepting the notice still sends nothing by itself').toEqual([]);
  const nudge = tutor.getByRole('button', { name: 'Give me a nudge' });
  await nudge.focus();
  await page.keyboard.press('Enter');
  await expect(tutor.locator('[data-tutor-reply]')).toContainText('Print the greeting the check expects.');
  expect(tutorUrls.length, 'the same log sees the request after consent').toBeGreaterThan(0);
  expect(foreign).toEqual([]);
  expect(tutorUrls.every(u => u.startsWith('https://tutor.test/'))).toBe(true);
  const nudgeBody = userMessage(bodies.at(-1) ?? '');
  const sentBody = JSON.parse(bodies.at(-1) ?? '{}') as Record<string, unknown>;
  expect(Object.keys(sentBody).sort(), 'a chosen model gets the plain body, never OpenRouter-only fields').toEqual(['max_tokens', 'messages', 'model']);
  expect(sentBody.model).toBe('test-model');
  expect((sentBody.messages as { role: string }[]).map(m => m.role)).toEqual(['user']);
  expect(nudgeBody).toContain('hello, world');
  expect(nudgeBody).toContain('actual output: ""');
  expect(nudgeBody).not.toContain("doesn't add a newline");
  expect(nudgeBody).not.toContain(KEY);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `exercise with the tutor panel (${scheme})`);
  }

  await box.getByRole('button', { name: 'Stuck? Show a hint' }).click();
  await expect(box.getByText('Hint 1 · Nudge')).toBeVisible();
  mode = 'why';
  await tutor.getByLabel('What were you trying to do?').fill('I returned zero without printing.');
  const why = tutor.getByRole('button', { name: 'Ask about my approach' });
  await why.focus();
  await page.keyboard.press('Enter');
  await expect(tutor.locator('[data-tutor-reply]')).toContainText('empty actual output');
  const whyBody = userMessage(bodies.at(-1) ?? '');
  expect(whyBody).toContain('You need');
  expect(whyBody).not.toContain("doesn't add a newline");
  expect(whyBody).toContain("Question: Why doesn't my approach work?");

  mode = 'leak';
  await nudge.focus();
  await page.keyboard.press('Enter');
  await expect(tutor.locator('[data-tutor-reply]')).toContainText("I can't show that reply");
  await expect(tutor.locator('[data-tutor-reply]')).not.toContainText('Printf');
  await expect(tutor.locator('[data-tutor-reply]')).not.toContainText('hello, world');

  mode = '401';
  await nudge.focus();
  await page.keyboard.press('Enter');
  await expect(tutor.locator('[data-tutor-reply]')).toContainText('rejected (401)');
  mode = '429';
  await nudge.focus();
  await page.keyboard.press('Enter');
  await expect(tutor.locator('[data-tutor-reply]')).toContainText('rate-limiting requests (429)');

  const asks = await page.evaluate(() => {
    const raw = localStorage.getItem('tdcc:v1:progress');
    const doc = raw ? JSON.parse(raw) as { exercises?: Record<string, { tutorAsks?: number }> } : {};
    return doc.exercises?.['hello-world']?.tutorAsks ?? 0;
  });
  expect(asks, 'nudge, why and the refusal count; 401 and 429 do not').toBe(3);

  await box.getByRole('button', { name: 'Show hint 2 (concept)' }).click();
  await box.getByRole('button', { name: 'Show hint 3 (partial code)' }).click();
  await setEditor(page, box, '#include <stdio.h>\nint main(void) {\n    return 1;\n}\n');
  await checkCode(box);
  const showSolution = box.getByRole('button', { name: 'Show the solution' });
  await expect(showSolution).toBeEnabled();
  await showSolution.click();
  await box.getByRole('button', { name: 'Start the variant' }).click();
  const variant = page.locator('[data-exercise="hello-world/variants/1"]');
  await expect(variant).toBeVisible();
  await expect(variant.getByRole('button', { name: 'Check my code' })).toBeVisible({ timeout: RUN });
  await expect(variant.locator('[data-tutor]')).toHaveCount(0);
  await setEditor(page, variant, 'int main(void) {\n    return 0;\n}\n');
  await checkCode(variant);
  await expect(variant.locator('[data-tutor]')).toHaveCount(0);

  await page.goto('#/m/m01/checkpoint');
  await expect(page.getByRole('heading', { level: 1, name: 'Checkpoint' })).toBeVisible();
  const cp = page.locator('[data-exercise="cp-sum-to-n"]');
  await expect(cp.getByRole('button', { name: 'Check my code' })).toBeVisible({ timeout: RUN });
  await expect(cp.locator('[data-tutor]')).toHaveCount(0);
  await checkCode(cp);
  await expect(cp.locator('[data-tutor]')).toHaveCount(0);

  await page.goto('#/m/m01/03-control-flow');
  const pa = page.locator('[data-exercise="countdown-order"]');
  await expect(pa).toBeVisible();
  await expect(pa.locator('[data-tutor]')).toHaveCount(0);
  await pa.getByRole('button', { name: /^Add line:/ }).first().click();
  await pa.getByRole('button', { name: 'Compile and test my program' }).click();
  await expect(pa.getByText(/\d+ of \d+ checks passed\./)).toBeVisible({ timeout: RUN });
  await expect(pa.locator('[data-tutor="ask"]')).toBeVisible();

  const fb = page.locator('[data-exercise="fix-pyramid"]');
  await expect(fb.locator('[data-tutor]')).toHaveCount(0);
  await fb.getByRole('button', { name: 'Check my code' }).click();
  await expect(fb.getByText(/\d+ of \d+ checks passed\./)).toBeVisible({ timeout: RUN });
  await expect(fb.locator('[data-tutor="ask"]')).toBeVisible();

  await page.goto('#/settings');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `settings with the tutor form (${scheme})`);
  }
  // The model selector. The course default exists only for OpenRouter and sends the owner's fixed body.
  // This host is stubbed too: nothing here reaches the network.
  await page.route(/openrouter\.ai/, fulfill);
  await expect(page.getByRole('radio', { name: /Course default/ })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Base URL', exact: true }).fill('https://openrouter.ai/api/v1');
  await page.getByRole('textbox', { name: 'Base URL', exact: true }).press('Tab');
  await expect(page.getByRole('radio', { name: /Course default/ })).toBeEnabled();
  await page.getByRole('radio', { name: /Course default/ }).check();
  await expect(page.locator('#tutor-model'), 'no model box while the course default is chosen').toHaveCount(0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `settings with the course default chosen (${scheme})`);
  }
  mode = 'nudge';
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/The first request sends your API key to openrouter\.ai/)).toBeVisible();
  await page.getByRole('button', { name: 'Send to openrouter.ai' }).click();
  await expect(page.getByText('Connected. The key works.')).toBeVisible();
  const defaultBody = JSON.parse(bodies.at(-1) ?? '{}') as Record<string, unknown>;
  expect(Object.keys(defaultBody).sort(), 'the course default sends exactly these four fields').toEqual(['max_tokens', 'messages', 'models', 'provider']);
  expect(defaultBody.models).toEqual(['openai/gpt-oss-120b', 'google/gemini-3.5-flash-lite', 'nvidia/nemotron-3.5-super-vl:free']);
  expect(defaultBody.provider).toEqual({ only: ['groq', 'cerebras', 'google-ai-studio', 'nvidia'], allow_fallbacks: true });
  expect((defaultBody.messages as { role: string }[]).map(m => m.role)).toEqual(['user']);

  await page.getByRole('radio', { name: /My own model id/ }).check();
  await expect(page.locator('#tutor-model')).toBeVisible();
  await expect(page.locator('section[aria-labelledby="tutor-settings-title"] [role="alert"]'), 'choosing "my own model id" is not an error before the learner types').toHaveCount(0);
  await page.locator('#tutor-model').fill('openai/gpt-4o-mini');
  await page.locator('#tutor-model').press('Tab');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connected. The key works.')).toBeVisible();
  const ownBody = JSON.parse(bodies.at(-1) ?? '{}') as Record<string, unknown>;
  expect(Object.keys(ownBody).sort()).toEqual(['max_tokens', 'messages', 'model']);
  expect(ownBody.model).toBe('openai/gpt-4o-mini');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export progress' }).click(),
  ]);
  const exported = readFileSync(await download.path(), 'utf8');
  expect(exported).toContain('"tutorAsks": 3');
  expect(exported).not.toContain(KEY);
  expect(exported).not.toContain('tutor.test');
  await page.getByRole('button', { name: 'Reset all progress' }).click();
  await expect(page.getByText('Progress reset.')).toBeVisible();
  const kept = await page.evaluate(() => localStorage.getItem('tdcc:v1:tutor') ?? '');
  expect(kept).toContain(KEY);
  const cleared = await page.evaluate(() => localStorage.getItem('tdcc:v1:progress') ?? '');
  expect(cleared).not.toContain('hello-world');

  await page.context().close();
});
