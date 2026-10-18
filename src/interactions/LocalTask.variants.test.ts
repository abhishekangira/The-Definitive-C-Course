// @vitest-environment jsdom
// Local-task solution gate and variant (issue #11). No lesson ships an LT exercise until Module 3,
// so Playwright cannot open this panel. This mounts LocalTask against the fixture folder
// tools/exercises/fixtures/.../lt-free-list, which verify:exercises also runs.
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { emptyProgress, getProgress, migrate, replaceProgress, type ExerciseProgress } from '../progress/store';
import { encodeCompletionToken, encodeProgressCode } from '../testing/token';
import type { ExerciseMeta } from '../content-model/types';
import type { ExerciseEntry } from '../content-runtime/course';
import type { ZipInput } from './zip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../tools/exercises/fixtures/content/modules/m00-fixtures/exercises/lt-free-list');
const parentSolution = readFileSync(path.join(FIXTURE, 'solution.c'), 'utf8');
const variantSolution = readFileSync(path.join(FIXTURE, 'variants/v1/solution.c'), 'utf8');
const variantMarker = variantSolution.split('\n').map(l => l.trim()).find(l => l.startsWith('/* variant:')) ?? '';

const catalog = vi.hoisted(() => ({ exercises: {} as Record<string, ExerciseEntry> }));
const folders = vi.hoisted(() => ({ current: {} as Record<string, Record<string, string>> }));
const zip = vi.hoisted(() => ({
  buildZip: vi.fn(async (_input: ZipInput) => new Blob(['pk'])),
  downloadBlob: vi.fn(),
}));

vi.mock('../content-runtime/course', () => ({
  exercises: catalog.exercises,
  course: { modules: [] },
  modules: {},
  quizFor: () => [],
}));
vi.mock('./Exercise', () => ({
  useFolder: (entry: { id: string } | undefined) => (entry ? folders.current[entry.id] ?? null : null),
}));
vi.mock('./zip', () => ({ buildZip: zip.buildZip, downloadBlob: zip.downloadBlob }));
vi.mock('../components/CodeEditor', async () => {
  const { createElement: h } = await import('react');
  return {
    CodeEditor: ({ value, label }: { value: string; label: string }) => h('pre', { 'aria-label': label }, value),
  };
});

const { LocalTask } = await import('./LocalTask');

function readFolder(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['starter.c', 'solution.c', 'tests.json']) out[name] = readFileSync(path.join(dir, name), 'utf8');
  return out;
}

function entry(dir: string, id: string, variants: string[]): ExerciseEntry {
  const meta = parse(readFileSync(path.join(dir, 'exercise.yaml'), 'utf8')) as ExerciseMeta;
  return { id, moduleId: 'm00', folder: `exercises/${id}`, meta: { ...meta, variants } };
}

const parent = entry(FIXTURE, 'lt-free-list', ['v1', 'v2']);
const variant = entry(path.join(FIXTURE, 'variants/v1'), 'lt-free-list/variants/v1', []);
const second: ExerciseEntry = {
  id: 'lt-free-list/variants/v2',
  moduleId: 'm00',
  folder: 'exercises/lt-free-list/variants/v2',
  meta: {
    id: 'lt-free-list/variants/v2',
    kind: 'lt',
    title: 'Count the other way',
    prompt: 'In-memory second variant, so the test can ask for a different one.',
    runsIn: 'native',
    hints: ['nudge', 'concept', 'V2_PARTIAL_HIDDEN'],
    variants: [],
    file: 'count.c',
  },
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  replaceProgress(emptyProgress());
  for (const k of Object.keys(catalog.exercises)) delete catalog.exercises[k];
  Object.assign(catalog.exercises, { [parent.id]: parent, [variant.id]: variant, [second.id]: second });
  folders.current = {
    [parent.id]: readFolder(FIXTURE),
    [variant.id]: readFolder(path.join(FIXTURE, 'variants/v1')),
    [second.id]: {
      'starter.c': 'int main(void) { return 0; } /* V2_STARTER */\n',
      'solution.c': 'int main(void) { return 0; } /* V2_SOLUTION_HIDDEN */\n',
      'tests.json': '{}\n',
    },
  };
  zip.buildZip.mockClear();
  zip.downloadBlob.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (el: Parameters<Root['render']>[0]) => act(() => root.render(el));
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)); });
const box = (id: string) => host.querySelector(`[data-exercise="${id}"]`) as HTMLElement;
function findButton(root: ParentNode, name: RegExp): HTMLButtonElement {
  const b = [...root.querySelectorAll('button')].find(el => name.test(el.textContent ?? ''));
  if (!b) throw new Error(`no button matching ${name}`);
  return b as HTMLButtonElement;
}
const click = (root: ParentNode, name: RegExp) => act(async () => { findButton(root, name).click(); });
function saveExercises(partials: Record<string, Partial<ExerciseProgress>>) {
  const blank = (): ExerciseProgress => ({
    attempts: 0, substantive: 0, activeMs: 0, hintsViewed: 0, passed: false, solutionViewed: false, mastered: false,
  });
  const p = getProgress();
  replaceProgress({
    ...p,
    exercises: Object.fromEntries(Object.entries(partials).map(([id, patch]) => [id, { ...blank(), ...patch }])),
  });
}
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function paste(root: HTMLElement, text: string) {
  type(root.querySelector('input')!, text);
  await act(async () => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
}

describe('LT solution gate and variant on the fixture exercise', () => {
  it('reads a real marker out of the fixture solution, which the starter does not contain', () => {
    expect(variantMarker).toBe('/* variant: free every counted node */');
    expect(readFileSync(path.join(FIXTURE, 'variants/v1/starter.c'), 'utf8')).not.toContain(variantMarker);
    expect(parentSolution).not.toContain(variantMarker);
    expect(parentSolution).toContain('#include <stdio.h>');
  });

  it('unlocks on two distinct progress codes, then a variant zip and token master the parent', async () => {
    expect(variantMarker).not.toBe('');
    const seed = getProgress().seed;
    const code1 = await encodeProgressCode({ exercise: 'lt-free-list', bits: '110', run: 1, src: 'aaaaaaaa' }, seed);
    const code2 = await encodeProgressCode({ exercise: 'lt-free-list', bits: '111', run: 2, src: 'bbbbbbbb' }, seed);
    const parentDone = await encodeCompletionToken({ exercise: 'lt-free-list' }, seed);
    const variantDone = await encodeCompletionToken({ exercise: 'lt-free-list/variants/v1' }, seed);

    render(createElement(LocalTask, { entry: parent }));
    const task = box('lt-free-list');
    const show = findButton(task, /^Show the solution$/);
    expect(show.disabled).toBe(true);
    expect(task.textContent).toContain('Open all three hints first.');

    await click(task, /^Stuck\? Show a hint$/);
    await click(task, /^Show hint 2 \(concept\)$/);
    await click(task, /^Show hint 3 \(partial code\)$/);
    expect(task.textContent).toContain('Hint 3 · Partial code');
    expect(findButton(task, /^Show the solution$/).disabled).toBe(true);
    expect(task.textContent).toContain('Make a real attempt first: paste a progress code from make test.');
    expect(task.textContent).not.toContain('#include <stdio.h>');

    await paste(task, code1);
    await paste(task, code1);
    expect(getProgress().exercises['lt-free-list'].substantive).toBe(1);
    expect(getProgress().exercises['lt-free-list'].attempts).toBe(2);
    expect(getProgress().exercises['lt-free-list'].codes).toEqual([code1]);
    expect(getProgress().streak.days.length).toBe(1);
    expect(findButton(task, /^Show the solution$/).disabled).toBe(true);
    expect(task.textContent).toContain('One more progress code from a changed program unlocks the solution.');
    expect(task.textContent).not.toMatch(/minute/);
    expect(task.textContent).toContain('Keep going and paste the final token.');

    await paste(task, code2);
    expect(getProgress().exercises['lt-free-list'].substantive).toBe(2);
    expect(getProgress().exercises['lt-free-list'].attempts).toBe(3);
    expect(task.textContent).toContain('The reference solution is now available.');
    expect(task.textContent).not.toContain('Keep going and paste the final token.');
    const unlocked = findButton(task, /^Show the solution$/);
    expect(unlocked.disabled).toBe(false);
    await click(task, /^Show the solution$/);
    expect(getProgress().exercises['lt-free-list'].solutionViewed).toBe(true);
    expect(document.activeElement).toBe(task.querySelector('[aria-label="Reference solution for list.c"]'));
    expect(task.textContent).toContain(parentSolution);
    expect(host.textContent).not.toContain(variantMarker);

    await click(task, /^Start the variant$/);
    const v = box('lt-free-list/variants/v1');
    expect(v).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Variant: Count the nodes"]'));
    expect(host.querySelector('[data-variant-note]')?.textContent).toBe('Variant started: Count the nodes.');
    expect(host.querySelector('[data-variant-note]')?.getAttribute('role')).toBe('status');
    expect(task.querySelector('label')?.textContent).toBe('Code printed by check.mjs for Free the whole list');
    expect(v.querySelector('label')?.textContent).toBe('Variant code printed by check.mjs for Count the nodes');
    expect(task.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe('Submit code for Free the whole list');
    expect(v.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe('Submit variant code for Count the nodes');
    expect(v.textContent).toContain('Count the nodes');
    expect(v.textContent).toContain('Variants are solved without a solution');
    expect(v.textContent).not.toContain(variantMarker);
    expect([...v.querySelectorAll('button')].some(b => /Show hint 3/.test(b.textContent ?? ''))).toBe(false);
    expect([...v.querySelectorAll('button')].some(b => /Show the solution/.test(b.textContent ?? ''))).toBe(false);
    expect(task.textContent).toContain('Download its zip, run');
    expect(getProgress().exercises['lt-free-list'].mastered).toBe(false);

    await act(async () => { findButton(v, /^Download v1\.zip$/).click(); });
    await flush();
    // buildZip receives the loaded folder (it still contains solution.c). folderToProjectFiles drops solution.c
    // before the zip is written; project-zip.test.ts covers that. Here, the variant id and starter show it is the second task.
    const downloaded = zip.buildZip.mock.calls.map(c => c[0]);
    expect(downloaded.map(d => d.exerciseId)).toContain('lt-free-list/variants/v1');
    expect(downloaded.find(d => d.exerciseId === 'lt-free-list/variants/v1')?.files['starter.c']).toContain('printf("count: %d\\n", count);');

    await click(v, /^Stuck\? Show a hint$/);
    await click(v, /^Show hint 2 \(concept\)$/);
    expect([...v.querySelectorAll('button')].some(b => /Show hint 3/.test(b.textContent ?? ''))).toBe(false);
    expect(v.textContent).not.toContain('V2_PARTIAL_HIDDEN');
    expect(getProgress().exercises['lt-free-list/variants/v1'].hintsViewed).toBe(2);

    await paste(v, parentDone);
    expect(v.textContent).toMatch(/not "lt-free-list\/variants\/v1"/);
    expect(getProgress().exercises['lt-free-list'].mastered).toBe(false);

    await paste(task, parentDone);
    expect(getProgress().exercises['lt-free-list']).toMatchObject({ passed: true, solutionViewed: true, mastered: false });

    await paste(v, variantDone);
    expect(getProgress().exercises['lt-free-list/variants/v1']).toMatchObject({ passed: true, mastered: true });
    expect(getProgress().exercises['lt-free-list'].mastered).toBe(true);
    expect(host.textContent).not.toContain(variantMarker);
    expect(host.textContent).not.toContain('V2_SOLUTION_HIDDEN');

    await click(task, /^Give me a different variant$/);
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Variant: Count the other way"]'));
    expect(host.querySelector('[data-variant-note]')?.textContent).toBe('Variant started: Count the other way.');
    expect(box('lt-free-list/variants/v2').textContent).toContain('Count the other way');
    expect(box('lt-free-list/variants/v1')).toBeNull();
    expect(host.textContent).not.toContain('V2_SOLUTION_HIDDEN');
    expect(host.textContent).not.toContain(variantMarker);
  });

  it('pasting the same code twice keeps one entry', async () => {
    const code = await encodeProgressCode({ exercise: 'lt-free-list', bits: '100', run: 1, src: 'aaaaaaaa' }, getProgress().seed);
    render(createElement(LocalTask, { entry: parent }));
    const task = box('lt-free-list');
    await paste(task, code);
    await paste(task, code);
    expect(getProgress().exercises['lt-free-list'].codes).toEqual([code]);
    expect(getProgress().exercises['lt-free-list'].attempts).toBe(2);
  });

  it('does not say the solution is newly available once it is already on screen', async () => {
    const seed = getProgress().seed;
    const code1 = await encodeProgressCode({ exercise: 'lt-free-list', bits: '110', run: 1, src: 'aaaaaaaa' }, seed);
    const code2 = await encodeProgressCode({ exercise: 'lt-free-list', bits: '111', run: 2, src: 'bbbbbbbb' }, seed);
    const again = await encodeProgressCode({ exercise: 'lt-free-list', bits: '111', run: 3, src: 'cccccccc' }, seed);
    render(createElement(LocalTask, { entry: parent }));
    const task = box('lt-free-list');
    await click(task, /^Stuck\? Show a hint$/);
    await click(task, /^Show hint 2 \(concept\)$/);
    await click(task, /^Show hint 3 \(partial code\)$/);
    await paste(task, code1);
    await paste(task, code2);
    expect(task.textContent).toContain('The reference solution is now available.');
    await click(task, /^Show the solution$/);
    expect(task.textContent).toContain(parentSolution);
    await paste(task, again);
    expect(getProgress().exercises['lt-free-list'].solutionViewed).toBe(true);
    expect(getProgress().exercises['lt-free-list'].substantive).toBe(3);
    expect(task.textContent).toContain('Keep going and paste the final token.');
    expect(task.textContent).not.toContain('The reference solution is now available.');
  });

  it('a document that counted code strings stays locked after it is loaded', async () => {
    const seed = getProgress().seed;
    const sameA = await encodeProgressCode({ exercise: 'lt-free-list', bits: '110', run: 1, src: 'aaaaaaaa' }, seed);
    const sameB = await encodeProgressCode({ exercise: 'lt-free-list', bits: '110', run: 2, src: 'aaaaaaaa' }, seed);
    const loaded = migrate({
      ...getProgress(),
      exercises: {
        'lt-free-list': {
          attempts: 2, substantive: 2, activeMs: 0, hintsViewed: 3, passed: false, solutionViewed: false, mastered: false,
          codes: [sameA, sameB],
        },
      },
    });
    expect(loaded.exercises['lt-free-list'].substantive).toBe(1);
    replaceProgress(loaded);
    render(createElement(LocalTask, { entry: parent }));
    const task = box('lt-free-list');
    expect(findButton(task, /^Show the solution$/).disabled).toBe(true);
    expect(task.textContent).toContain('One more progress code from a changed program unlocks the solution.');
    await paste(task, sameB);
    expect(getProgress().exercises['lt-free-list'].substantive).toBe(1);
    expect(findButton(task, /^Show the solution$/).disabled).toBe(true);
  });

  it('a completion token without viewing the solution masters the exercise and hides the solution', async () => {
    const token = await encodeCompletionToken({ exercise: 'lt-free-list' }, getProgress().seed);
    render(createElement(LocalTask, { entry: parent }));
    await paste(box('lt-free-list'), token);
    expect(getProgress().exercises['lt-free-list']).toMatchObject({ passed: true, solutionViewed: false, mastered: true });
    expect(box('lt-free-list').textContent).not.toContain('Show the solution');
    expect(host.textContent).not.toContain(variantMarker);
  });

  it('a native project does not offer the reference solution', () => {
    render(createElement(LocalTask, { entry: parent, projectId: 'p0' }));
    const task = box('lt-free-list');
    expect(task.textContent).not.toContain('Show the solution');
    expect(findButton(task, /^Stuck\? Show a hint$/)).toBeTruthy();
  });

  it('assessment mode offers no hints and no solution, and skip counts as wrong', async () => {
    let skipped = false;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(createElement(LocalTask, { entry: parent, assessment: true, onGiveUp: () => { skipped = true; } }));
    const task = box('lt-free-list');
    expect([...task.querySelectorAll('button')].some(b => /Show a hint|Show the solution/.test(b.textContent ?? ''))).toBe(false);
    await click(task, /^Skip \(counts as wrong\)$/);
    expect(confirm).toHaveBeenCalled();
    expect(skipped).toBe(true);
    confirm.mockRestore();
  });

  it('two runs of the same source do not unlock the solution, and attempts counts pastes', async () => {
    const seed = getProgress().seed;
    const same1 = await encodeProgressCode({ exercise: 'lt-free-list', bits: '100', run: 7, src: 'aaaaaaaa' }, seed);
    const same2 = await encodeProgressCode({ exercise: 'lt-free-list', bits: '110', run: 9, src: 'aaaaaaaa' }, seed);
    const changed = await encodeProgressCode({ exercise: 'lt-free-list', bits: '111', run: 10, src: 'bbbbbbbb' }, seed);
    render(createElement(LocalTask, { entry: parent }));
    const task = box('lt-free-list');
    await click(task, /^Stuck\? Show a hint$/);
    await click(task, /^Show hint 2 \(concept\)$/);
    await click(task, /^Show hint 3 \(partial code\)$/);
    await paste(task, same1);
    await paste(task, same2);
    const saved = getProgress().exercises['lt-free-list'];
    expect(saved.attempts).toBe(2);
    expect(saved.substantive).toBe(1);
    expect(saved.codes).toEqual([same1, same2]);
    expect(findButton(task, /^Show the solution$/).disabled).toBe(true);
    expect(task.textContent).toContain('Keep going and paste the final token.');
    expect(task.textContent).not.toContain('The reference solution is now available.');
    await paste(task, changed);
    expect(getProgress().exercises['lt-free-list'].attempts).toBe(3);
    expect(getProgress().exercises['lt-free-list'].substantive).toBe(2);
    expect(findButton(task, /^Show the solution$/).disabled).toBe(false);
    expect(task.textContent).toContain('The reference solution is now available.');
    expect(task.textContent).not.toContain('Keep going and paste the final token.');
  });

  it('shows the saved solution and variant again after a remount, without moving focus', async () => {
    saveExercises({
      'lt-free-list': { hintsViewed: 3, substantive: 2, attempts: 2, solutionViewed: true, variant: 'v1', codes: ['saved-code'] },
    });
    render(createElement(LocalTask, { entry: parent }));
    expect(box('lt-free-list').textContent).toContain(parentSolution);
    expect(box('lt-free-list/variants/v1').textContent).toContain('Count the nodes');
    expect(document.activeElement).toBe(document.body);
    expect(host.querySelector('[data-variant-note]')).toBeNull();
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    render(createElement(LocalTask, { entry: parent }));
    expect(box('lt-free-list').textContent).toContain(parentSolution);
    expect(box('lt-free-list/variants/v1').textContent).toContain('Count the nodes');
    expect(getProgress().exercises['lt-free-list'].codes).toEqual(['saved-code']);
    expect(document.activeElement).toBe(document.body);
    expect(host.querySelector('[data-variant-note]')).toBeNull();
  });

  it('rejects a variant completion token pasted into the parent box', async () => {
    const seed = getProgress().seed;
    const variantDone = await encodeCompletionToken({ exercise: 'lt-free-list/variants/v1' }, seed);
    saveExercises({
      'lt-free-list': { hintsViewed: 3, substantive: 2, attempts: 2, solutionViewed: true, variant: 'v1' },
    });
    render(createElement(LocalTask, { entry: parent }));
    const task = box('lt-free-list');
    expect(box('lt-free-list/variants/v1')).not.toBeNull();
    await paste(task, variantDone);
    expect(task.textContent).toMatch(/not "lt-free-list"/);
    expect(task.textContent).not.toContain('Completion token accepted');
    expect(getProgress().exercises['lt-free-list']).toMatchObject({ passed: false, mastered: false, attempts: 2 });
    expect(getProgress().exercises['lt-free-list/variants/v1']).toBeUndefined();
  });

  it('assessment with a stored reveal hides the variant and reports the checkpoint through onPassed', async () => {
    const onPassed = vi.fn();
    saveExercises({
      'lt-free-list': { hintsViewed: 3, substantive: 2, attempts: 2, solutionViewed: true, variant: 'v1' },
    });
    render(createElement(LocalTask, { entry: parent, assessment: true, onPassed, onGiveUp: () => {} }));
    expect(host.querySelector('[data-exercise="lt-free-list/variants/v1"]')).toBeNull();
    expect(host.textContent).not.toContain('Stuck? Show a hint');
    expect(host.textContent).not.toContain('Show the solution');
    expect(host.textContent).not.toContain('Count the nodes');
    expect(host.textContent).not.toContain(variantMarker);
    expect(onPassed).not.toHaveBeenCalled();
    expect(getProgress().exercises['lt-free-list'].mastered).toBe(false);
    const token = await encodeCompletionToken({ exercise: 'lt-free-list' }, getProgress().seed);
    await paste(box('lt-free-list'), token);
    expect(onPassed).toHaveBeenCalledTimes(1);
    expect(getProgress().exercises['lt-free-list']).toMatchObject({ passed: true, solutionViewed: true, mastered: false });
  });

  it('a variant progress code does not master the parent', async () => {
    const seed = getProgress().seed;
    const progress = await encodeProgressCode({ exercise: 'lt-free-list/variants/v1', bits: '10', run: 4, src: 'cccccccc' }, seed);
    saveExercises({
      'lt-free-list': { hintsViewed: 3, substantive: 2, attempts: 2, solutionViewed: true, variant: 'v1' },
    });
    render(createElement(LocalTask, { entry: parent }));
    await paste(box('lt-free-list/variants/v1'), progress);
    expect(getProgress().exercises['lt-free-list'].mastered).toBe(false);
    expect(getProgress().exercises['lt-free-list/variants/v1']).toMatchObject({ passed: false, mastered: false, attempts: 1, substantive: 1 });
  });

  it('a variant completion during assessment calls onPassed and does not master the parent', async () => {
    const onPassed = vi.fn();
    const token = await encodeCompletionToken({ exercise: 'lt-free-list/variants/v1' }, getProgress().seed);
    render(createElement(LocalTask, { entry: variant, parentId: parent.id, assessment: true, onPassed }));
    const task = box('lt-free-list/variants/v1');
    expect(task.textContent).not.toContain('Stuck? Show a hint');
    await paste(task, token);
    expect(onPassed).toHaveBeenCalledTimes(1);
    expect(getProgress().exercises['lt-free-list/variants/v1']).toMatchObject({ passed: true, mastered: true });
    expect(getProgress().exercises['lt-free-list']?.mastered ?? false).toBe(false);
  });

  it('does not master the parent when that variant solution was viewed', async () => {
    const token = await encodeCompletionToken({ exercise: 'lt-free-list/variants/v1' }, getProgress().seed);
    saveExercises({
      'lt-free-list': { hintsViewed: 3, substantive: 2, attempts: 2, solutionViewed: true, variant: 'v1', mastered: false },
      'lt-free-list/variants/v1': { solutionViewed: true },
    });
    render(createElement(LocalTask, { entry: parent }));
    await paste(box('lt-free-list/variants/v1'), token);
    expect(getProgress().exercises['lt-free-list/variants/v1']).toMatchObject({ passed: true, solutionViewed: true, mastered: false });
    expect(getProgress().exercises['lt-free-list'].mastered).toBe(false);
  });
});
