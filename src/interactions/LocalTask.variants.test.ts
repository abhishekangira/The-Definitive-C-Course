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
import { emptyProgress, getProgress, replaceProgress } from '../progress/store';
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
const click = (root: ParentNode, name: RegExp) => act(() => { findButton(root, name).click(); });
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
    expect(getProgress().streak.days.length).toBe(1);
    expect(findButton(task, /^Show the solution$/).disabled).toBe(true);
    expect(task.textContent).toContain('One more progress code from a changed program');

    await paste(task, code2);
    expect(getProgress().exercises['lt-free-list'].substantive).toBe(2);
    const unlocked = findButton(task, /^Show the solution$/);
    expect(unlocked.disabled).toBe(false);
    await click(task, /^Show the solution$/);
    expect(getProgress().exercises['lt-free-list'].solutionViewed).toBe(true);
    expect(task.textContent).toContain(parentSolution);
    expect(host.textContent).not.toContain(variantMarker);

    await click(task, /^Start the variant$/);
    const v = box('lt-free-list/variants/v1');
    expect(v).not.toBeNull();
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
    expect(box('lt-free-list/variants/v2').textContent).toContain('Count the other way');
    expect(box('lt-free-list/variants/v1')).toBeNull();
    expect(host.textContent).not.toContain('V2_SOLUTION_HIDDEN');
    expect(host.textContent).not.toContain(variantMarker);
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
});
