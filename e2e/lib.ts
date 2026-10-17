// Helpers for the click-through: load generated answers from disk and complete each interaction
// type the way a learner would, using only verified data (samples, traces, tests, reference solutions).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ModuleMeta, SampleResult, SamplesFile, TraceFile } from '../src/content-model/types';
import { nativeFor, normOutput } from '../src/interactions/platform';
import { findVar } from '../src/visualizers/trace-format';
import { correctAnswer } from '../src/interactions/memory-answers';
import { binary, floatDrillBits, floatText, hex, parseNumber, toBits, type Width } from '../src/visualizers/numbers';

export const ROOT = process.cwd();
const RUN_TIMEOUT = Number(process.env.E2E_RUN_TIMEOUT ?? 180_000);

export interface QuizItemYaml {
  id: string; type: string; code?: string; choices?: string[]; answer?: number; exercise?: string; items?: string[];
}
export interface ModuleInfo {
  id: string;
  dir: string;
  meta: ModuleMeta;
  samples: SamplesFile;
  lessons: Array<{ stem: string; id: string; title: string }>;
  quiz: (kind: 'retrieval' | 'checkpoint') => QuizItemYaml[];
}

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

export function availableModules(): ModuleInfo[] {
  const course = parse(read('content/course.yaml')) as { modules: Array<{ id: string; dir: string; available: boolean }> };
  return course.modules.filter(m => m.available).map(m => {
    const dir = `content/modules/${m.dir}`;
    const meta = parse(read(`${dir}/module.yaml`)) as ModuleMeta;
    const samples = JSON.parse(read(`src/generated/samples/${m.id}.json`)) as SamplesFile;
    const lessons = meta.lessons.map(stem => {
      const fm = parse(read(`${dir}/lessons/${stem}.mdx`).split(/^---$/m)[1]) as { id: string; title: string };
      return { stem, id: fm.id, title: fm.title };
    });
    const quiz = (kind: 'retrieval' | 'checkpoint') => {
      const p = `${dir}/quizzes/${kind}.yaml`;
      return existsSync(join(ROOT, p)) ? (parse(read(p)) as QuizItemYaml[]) : [];
    };
    return { id: m.id, dir, meta, samples, lessons, quiz };
  });
}

/** The course title on the map's h1 (content/course.yaml), so the map is told apart from any other page. */
export function courseTitle(): string {
  return (parse(read('content/course.yaml')) as { title: string }).title;
}

export function trace(id: string): TraceFile {
  return JSON.parse(read(`src/generated/traces/${id}.json`)) as TraceFile;
}

/** Reference solution for an exercise key ("cash", "cash/variants/1") or project ("project/mario-more"). */
export function solutionOf(mod: ModuleInfo, key: string): string {
  if (key.startsWith('project/')) {
    const folder = `${mod.dir}/${key}/solution`;
    const files = readdirSync(join(ROOT, folder));
    return read(`${folder}/${files[0]}`);
  }
  return read(`${mod.dir}/exercises/${key}/solution.c`);
}

export function starterOf(mod: ModuleInfo, key: string): string {
  return read(`${mod.dir}/exercises/${key}/starter.c`);
}

function sample(mod: ModuleInfo, id: string | null): SampleResult {
  const s = id ? mod.samples.samples[id] : undefined;
  if (!s) throw new Error(`no generated sample "${id}" in ${mod.id}`);
  return s;
}

const outcomeKey = (o: string) => (o.startsWith('exit:') ? (o === 'exit:0' ? 'runs' : 'runtime-error') : o);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace the text of a CodeMirror editor and check it took the text verbatim. */
export async function setEditor(page: Page, scope: Locator, code: string): Promise<void> {
  const editor = scope.locator('.cm-content[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  const text = await editor.evaluate(el => Array.from(el.querySelectorAll('.cm-line')).map(l => l.textContent ?? '').join('\n'));
  expect(text.replace(/​/g, '').trimEnd()).toBe(code.trimEnd());
}

/** Waits until a compile/run started from `scope` has finished (exit status, crash, or diagnostics only). */
async function waitForRun(scope: Locator): Promise<void> {
  await expect(scope.getByText(/^(Program exited with status|Program crashed|Stopped)/).or(scope.locator('[data-diagnostics]')).first()).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(scope.getByText('compiling…')).toHaveCount(0, { timeout: RUN_TIMEOUT });
  await expect(scope.getByText('running', { exact: true })).toHaveCount(0, { timeout: RUN_TIMEOUT });
}

async function terminalStdout(scope: Locator): Promise<string> {
  return (await scope.locator('[role=log] [data-kind="out"]').allTextContents()).join('');
}

export async function completePredict(mod: ModuleInfo, box: Locator): Promise<void> {
  const id = await box.getAttribute('data-sample');
  const s = sample(mod, id);
  const kind = s.meta.predict ?? 'output';
  const nativeOnly = s.meta.target === 'native';
  if (kind === 'none') {
    await box.getByRole('button', { name: 'Run', exact: true }).click();
  } else {
    if (kind === 'output') await box.locator('textarea').first().fill(normOutput(s.answer.stdout));
    if (kind === 'choice') {
      const want = normOutput(s.answer.stdout).trim();
      const idx = (s.meta.choices ?? []).findIndex(c => c.trim() === want);
      expect(idx, `${id}: verified output must be one of the choices`).toBeGreaterThanOrEqual(0);
      await box.locator('input[type=radio]').nth(idx).check();
    }
    if (kind === 'outcome') await box.locator(`input[type=radio][value="${outcomeKey(s.answer.outcome)}"]`).check();
    await box.getByRole('button', { name: 'Lock in my prediction' }).click();
    await box.getByRole('button', { name: nativeOnly ? 'Reveal the result' : 'Run', exact: true }).click();
  }
  if (!nativeOnly) {
    await waitForRun(box);
    // The real browser compiler must reproduce the output verified in Node.
    if (!/%p/.test(s.code) && s.results['wasm32-clang22']?.compile.ok) {
      expect(normOutput(await terminalStdout(box)), `${id}: browser output`).toBe(normOutput(s.results['wasm32-clang22'].run?.stdout ?? ''));
    }
  }
  if (kind !== 'none') await expect(box.getByText('Your prediction was right.', { exact: true })).toBeVisible();
  if (s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none') {
    const native = nativeFor(s, undefined);
    await box.locator('textarea').last().fill(normOutput(native.run?.stdout ?? ''));
    await box.getByRole('button', { name: 'Check my 64-bit prediction' }).click();
    await expect(box.getByText('Right for 64-bit too.', { exact: true })).toBeVisible();
  }
}

/** Authored multiple choice: answer, read which option the page marks correct, and answer again. */
async function answerAuthoredChoice(box: Locator, submit: string, scope: Locator = box): Promise<void> {
  await scope.locator('input[type=radio]').first().check();
  await box.getByRole('button', { name: submit, exact: true }).click();
  await scope.locator('[data-correct="true"] input[type=radio]').check();
  await box.getByRole('button', { name: /^(Check|Check again)$/ }).click();
  await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
}

export async function completeChoice(box: Locator): Promise<void> {
  await answerAuthoredChoice(box, 'Check');
}

export async function completeCompilerError(page: Page, mod: ModuleInfo, box: Locator): Promise<void> {
  const id = await box.getAttribute('data-sample');
  const s = sample(mod, id);
  const first = s.results['wasm32-clang22']?.compile.diagnostics.find(d => d.severity !== 'note');
  expect(first, `${id}: needs a browser diagnostic`).toBeTruthy();
  await box.locator(`label[data-line="${first!.line}"]`).click();
  await expect(box.getByText('Yes: the file:line:col prefix says so.', { exact: true })).toBeVisible();
  await answerAuthoredChoice(box, 'Check', box.locator('form'));
  const fixButton = box.getByRole('button', { name: 'Compile and check' });
  if (await fixButton.count()) {
    const fixed = sample(mod, `${id}-fixed`);
    await setEditor(page, box, fixed.code);
    await fixButton.click();
    await expect(box.getByText(/^\s*Fixed: it compiles cleanly/)).toBeVisible({ timeout: RUN_TIMEOUT });
    await box.getByRole('button', { name: 'Continue' }).click();
  }
}

export async function completeMemoryDiagram(box: Locator): Promise<void> {
  const id = (await box.getAttribute('data-sample'))!;
  const step = trace(id).steps[Number(await box.getAttribute('data-step'))];
  for (const input of await box.locator('input[aria-label*=": value of "]').all()) {
    const [func, name] = (await input.getAttribute('aria-label'))!.split(': value of ');
    const hit = findVar(step, `${func}.${name}`);
    expect(hit, `${id}: ${func}.${name} in the trace`).toBeTruthy();
    await input.fill(correctAnswer(hit!.v));
  }
  for (const select of await box.locator('select[aria-label$=" points to"]').all()) {
    const [func, rest] = (await select.getAttribute('aria-label'))!.split(': ');
    const hit = findVar(step, `${func}.${rest.replace(/ points to$/, '')}`);
    await select.selectOption(correctAnswer(hit!.v));
  }
  await box.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(box.getByText('All correct.', { exact: true })).toBeVisible();
}

export async function completeStepper(box: Locator): Promise<void> {
  const id = (await box.getAttribute('data-sample'))!;
  const steps = trace(id).steps;
  const stepButton = box.getByRole('button', { name: 'Step', exact: true });
  for (let guard = 0; guard < steps.length + 5; guard++) {
    if (await box.getByText('which line runs next?').isVisible()) {
      const counter = (await box.getByText(/^Step \d+ of \d+/).textContent())!;
      const current = Number(/^Step (\d+)/.exec(counter)![1]); // 1-based, so steps[current] is the next step
      await box.getByRole('button', { name: new RegExp(`^Line ${steps[current].line}:`) }).click();
      await expect(box.getByText(/^\s*Right\./)).toBeVisible();
    }
    if (await stepButton.isDisabled()) break;
    await stepButton.click();
  }
  await expect(box.getByText(new RegExp(`^Step ${steps.length} of ${steps.length}`))).toBeVisible();
}

export async function completeNumberDrill(box: Locator): Promise<void> {
  const width = Number(await box.getAttribute('data-width')) as Width;
  const to = await box.getAttribute('data-to');
  const raw = (await box.getAttribute('data-value'))!;
  if ((await box.getAttribute('data-kind')) === 'float') {
    // A float drill: the value is "0x..." text to decode, or a number to encode (same helpers as the app).
    const fbits = floatDrillBits(raw.startsWith('0x') ? raw : Number(raw));
    await box.locator('input').first().fill(to === 'hex' ? hex(fbits, 32) : floatText(fbits, 32));
    await box.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
    return;
  }
  const bits = toBits(parseNumber(raw)!, width);
  const answer = to === 'bin' ? binary(bits, width) : to === 'hex' ? hex(bits, width) : bits.toString();
  await box.locator('input').first().fill(answer);
  await box.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
}

export async function completeExercise(page: Page, mod: ModuleInfo, box: Locator, opts: { viewHint?: boolean } = {}): Promise<void> {
  const key = (await box.getAttribute('data-exercise'))!;
  if (opts.viewHint) {
    await box.getByRole('button', { name: 'Stuck? Show a hint' }).click();
    await expect(box.getByText('Hint 1 · Nudge')).toBeVisible();
  }
  await setEditor(page, box, solutionOf(mod, key));
  await box.getByRole('button', { name: 'Check my code' }).click();
  await expect(box.getByText(/^(\d+) of \1 checks passed\.$/)).toBeVisible({ timeout: RUN_TIMEOUT });
}

export async function completeParsons(mod: ModuleInfo, box: Locator): Promise<void> {
  const key = (await box.getAttribute('data-exercise'))!;
  for (const line of solutionOf(mod, key).split('\n').filter(l => l.trim() !== '')) {
    await box.getByRole('button', { name: `Add line: ${line.trim()}`, exact: true }).first().click();
  }
  await box.getByRole('button', { name: 'Compile and test my program' }).click();
  await expect(box.getByText(/^(\d+) of \1 checks passed\.$/)).toBeVisible({ timeout: RUN_TIMEOUT });
}

export async function completeInteraction(page: Page, mod: ModuleInfo, box: Locator): Promise<void> {
  const kind = await box.getAttribute('data-interaction');
  await box.scrollIntoViewIfNeeded();
  switch (kind) {
    case 'predict': return completePredict(mod, box);
    case 'choice': return completeChoice(box);
    case 'compiler-error': return completeCompilerError(page, mod, box);
    case 'memory-diagram': return completeMemoryDiagram(box);
    case 'stepper': return completeStepper(box);
    case 'number-drill': return completeNumberDrill(box);
    case 'ct': case 'fb': return completeExercise(page, mod, box);
    case 'parsons': return completeParsons(mod, box);
    default: throw new Error(`no e2e handler for interaction "${kind}"`);
  }
}

/**
 * Opens a lesson and completes its cards, as a learner must, until one contains `selector`, and returns that card without
 * touching what it asks. Cards before it are completed, so heavy interactions cost the same as in `completeLesson`.
 */
export async function reachCard(page: Page, mod: ModuleInfo, stem: string, selector: string): Promise<Locator> {
  await page.goto(`#/m/${mod.id}/${stem}`);
  for (let i = 0; i < 30; i++) {
    const card = page.locator(`section[data-card="${i}"]`);
    await expect(card, `card ${i + 1} of ${stem} appears`).toBeVisible();
    await expect(card.locator('[data-loading="true"]')).toHaveCount(0);
    if (await card.locator(selector).count()) return card;
    await expect(topLevel(card).first(), `card ${i + 1} of ${stem} has its interaction`).toBeVisible();
    for (const box of await topLevel(card).all()) await completeInteraction(page, mod, box);
  }
  throw new Error(`${stem}: no card contains ${selector}`);
}

/** Interactions that are not nested inside another interaction. */
export const topLevel = (scope: Locator) => scope.locator('[data-interaction]:not([data-interaction] [data-interaction])');

export async function completeLesson(page: Page, mod: ModuleInfo, stem: string): Promise<void> {
  await page.goto(`#/m/${mod.id}/${stem}`);
  const first = page.locator('section[data-card="0"]');
  await expect(first).toBeVisible();
  const total = Number(/of (\d+)$/.exec((await first.getAttribute('aria-label'))!)![1]);
  for (let i = 0; i < total; i++) {
    const card = page.locator(`section[data-card="${i}"]`);
    await expect(card, `card ${i + 1} of ${total} appears`).toBeVisible();
    // `.all()` does not wait: on a slow runner the card's section can be visible before its interaction is in the DOM,
    // the loop then finds no boxes, skips the card and times out waiting for the next one (CI run 38870988443).
    // Every card except the last (non-gated) one ends in an interaction, so wait for it.
    if (i < total - 1) await expect(topLevel(card).first(), `card ${i + 1} of ${total} has its interaction`).toBeVisible();
    // Heavy interactions are lazy chunks: wait for their loading placeholders (data-loading) to go before looking for them.
    await expect(card.locator('[data-loading="true"]'), `card ${i + 1} finished loading`).toHaveCount(0);
    for (const box of await topLevel(card).all()) await completeInteraction(page, mod, box);
  }
}

export async function answerQuiz(page: Page, mod: ModuleInfo, kind: 'retrieval' | 'checkpoint'): Promise<void> {
  for (const item of mod.quiz(kind)) {
    const box = page.locator(`[data-quiz-item="${item.id}"]`);
    await box.scrollIntoViewIfNeeded();
    const inner = topLevel(box);
    if (await inner.count()) { await completeInteraction(page, mod, inner.first()); continue; }
    const s = item.code ? sample(mod, item.id) : undefined;
    if (item.type === 'predict') await box.locator('textarea').fill(normOutput(s!.answer.stdout));
    else if (item.type === 'outcome') {
      const label = { 'compile-error': "It doesn't compile", 'runtime-error': 'It compiles, then crashes or stops with an error', runs: 'It runs and exits normally' }[outcomeKey(s!.answer.outcome)]!;
      await box.getByLabel(label).check();
    } else if (item.type === 'choice' || item.type === 'ce') {
      const idx = item.answer ?? (item.choices ?? []).findIndex(c => c.trim() === normOutput(s!.answer.stdout).trim());
      expect(idx, `${item.id}: answer resolves`).toBeGreaterThanOrEqual(0);
      await box.locator('input[type=radio]').nth(idx).check();
    } else throw new Error(`no e2e handler for quiz item type ${item.type}`);
    await box.getByRole('button', { name: 'Submit answer' }).click();
    await expect(box.getByText('Correct.', { exact: true })).toBeVisible();
  }
}

export async function expectAccessible(page: Page, what: string): Promise<void> {
  // A card fades in when it appears; axe measured contrast mid-fade on a slow runner (a false color-contrast failure on the
  // last card of m02 lesson 1). Wait for the finite animations and transitions to end before measuring.
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))));
  // @axe-core/playwright bundles its own playwright-core types, so the Page types are nominally different.
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')})`), `axe on ${what}`).toEqual([]);
}

export async function progressJson(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tdcc:v1:progress') ?? '{}'));
}

/**
 * Progress in which every module before `mod` (in course.yaml order) is complete: its retrieval quiz done, its
 * checkpoint passed and its project passed, which is what `isModuleUnlocked` (src/progress/gating.ts) asks for.
 * Module ids and project ids come from the content, never from a hand-kept list. `undefined` for the first module.
 */
export function priorModulesProgress(mod: ModuleInfo): Record<string, unknown> | undefined {
  const all = availableModules();
  const earlier = all.slice(0, all.findIndex(m => m.id === mod.id));
  if (!earlier.length) return undefined;
  const at = new Date().toISOString();
  const quizzes: Record<string, unknown> = {};
  const projects: Record<string, unknown> = {};
  for (const m of earlier) {
    quizzes[`${m.id}:retrieval`] = { score: 1, total: 1, passed: true, at, answers: {} };
    quizzes[`${m.id}:checkpoint`] = { score: 1, total: 1, passed: true, at, answers: {} };
    projects[m.meta.project] = { passed: true, at };
  }
  return { version: 1, seed: '00e2e00e2e00e2e0', createdAt: at, settings: {}, cards: {}, lessons: {}, samples: {}, exercises: {}, quizzes, projects, streak: { days: [], longest: 0 } };
}

/**
 * Unlocks `mod` in a fresh browser context by writing the progress document of its predecessors into localStorage before
 * the first page script runs. Does nothing for the first module. The script only writes when no progress exists yet, so
 * the learner's own progress in the test is never overwritten on a reload.
 */
export async function seedPriorModules(context: BrowserContext, mod: ModuleInfo): Promise<void> {
  const doc = priorModulesProgress(mod);
  if (!doc) return;
  await context.addInitScript(([key, json]) => {
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, json); } catch { /* an opaque frame (a blocked embed) has no storage */ }
  }, ['tdcc:v1:progress', JSON.stringify(doc)] as const);
}

/** A problem-set exercise that has variants (the hint, solution and variant test needs one); `hello-world` is skipped. */
export function exerciseWithVariants(mod: ModuleInfo): string {
  const id = mod.meta.problemSet.find(x => x !== 'hello-world' && existsSync(join(ROOT, mod.dir, 'exercises', x, 'variants')));
  if (!id) throw new Error(`${mod.id}: no problem-set exercise has variants`);
  return id;
}

export { escapeRe };
