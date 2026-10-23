// @vitest-environment jsdom
// Real page, progress, stats, lesson context and CodeSample. Only content loading and the C runtime are replaced.
import { act, createElement, Fragment, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SamplesFile } from '../../content-model/types';
import samplesJson from '../../generated/samples/m01.json';
import { emptyProgress, getProgress, replaceProgress, update } from '../../progress/store';
import { PERFECT_SEEN_KEY } from '../../components/PerfectLesson';
import { usePredictionShown } from '../../lesson/LessonContext';
import { nativeFor } from '../../interactions/platform';
import type { RunPhase, RunSummary, useCRun } from '../../runtime/useCRun';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const samples = samplesJson as SamplesFile;
const bag = vi.hoisted(() => ({ pending: null as Promise<RunSummary> | null, file: null as SamplesFile | null, failSamples: false, callbacks: new Set<unknown>() }));
const stem = '01-hello-compiled-world';
function ObserveCallback() { bag.callbacks.add(usePredictionShown()); return null; }
const predictions = () => Object.values((bag.file ?? samples).samples).filter(s => s.lesson === stem && s.meta.predict !== 'none');
vi.mock('../../content-runtime/course', async importOriginal => {
  const real = await importOriginal<typeof import('../../content-runtime/course')>();
  return { ...real, samplesFor: async (id: string) => { if (bag.failSamples) throw new Error('chunk failed'); return id === 'm01' ? bag.file ?? samples : null; }, sessionsFor: async () => null,
    lessonLoader: () => async () => ({ default: () => createElement(Fragment, null, createElement(ObserveCallback), ...predictions().map(s => createElement(CodeSample, { key: s.id, id: s.id, code: s.code, meta: JSON.stringify(s.meta) }))) }),
  };
});
vi.mock('../../content-runtime/mdx-components', () => ({ mdxComponents: {} }));
vi.mock('../../components/CodeEditor', () => ({ preloadCodeEditor() {}, CodeEditor: () => null }));
vi.mock('../../runtime/CRuntime', () => ({ getRuntime: () => ({ prefetch() {} }) }));
vi.mock('../../runtime/useCRun', () => ({ useCRun: (): ReturnType<typeof useCRun> => {
  const [phase, setPhase] = useState<RunPhase>('idle');
  return { phase, diagnostics: [], rawDiagnostics: '', segments: [], result: null,
    run: async () => { setPhase('compiling'); const result = await (bag.pending ?? Promise.resolve({ compile: { ok: true, diagnostics: [], raw: '', ms: 0 }, stdout: '', stderr: '' })); setPhase('done'); return result; },
    stop() {}, reset() { setPhase('idle'); }, sendInput() {}, sendEOF() {},
  };
} }));
vi.mock('../../components/Terminal', () => ({ Terminal: () => null }));
vi.mock('../../tutor/settings', () => ({ useTutorSettings: () => ({}) }));
vi.mock('../../tutor/LessonChat', () => ({ LESSON_CHAT_ID: 'chat', LessonChat: () => null }));
vi.mock('../../tutor/SelectionToolbar', () => ({ SelectionToolbar: () => null }));
const { CodeSample } = await import('../../interactions/CodeSample');
const { LessonPage } = await import('./LessonPage');
const { ModulePage } = await import('./ModulePage');
const { CourseMap } = await import('./CourseMap');
let root: Root, host: HTMLDivElement, router: ReturnType<typeof createMemoryRouter>;
beforeEach(async () => {
  bag.pending = null; bag.file = null; bag.failSamples = false; bag.callbacks.clear();
  localStorage.clear(); const p = emptyProgress(); p.settings.storedOutputMode = true;
  p.quizzes['m01:retrieval'] = { score: 1, total: 1, passed: true, at: new Date().toISOString(), answers: {} }; replaceProgress(p);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  router = createMemoryRouter([
    { path: '/', element: createElement(CourseMap) }, { path: '/m/:moduleId', element: createElement(ModulePage) },
    { path: '/m/:moduleId/:lessonStem', element: createElement(LessonPage) },
  ], { initialEntries: [`/m/m01/${stem}`] });
  await act(async () => root.render(createElement(RouterProvider, { router })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const click = async (button: HTMLButtonElement) => { button.focus(); await act(async () => button.click()); };
const button = (box: Element, text: string) => [...box.querySelectorAll('button')].find(b => b.textContent === text)!;
async function exact(index: number) {
  const box = host.querySelector(`[data-sample="${predictions()[index].id}"]`)!;
  const input = box.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, predictions()[index].answer.stdout);
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
  await click(button(box, 'Lock in my prediction'));
  return box;
}
it('celebrates after the last exact reveal, never lock-in or rerun, and only once after a reset', async () => {
  const last = await exact(0); expect(document.querySelector('dialog')).toBeNull();
  expect(getProgress().samples[predictions()[0].id].verdict).toBe('exact');
  const trigger = button(last, 'Reveal the result'); await click(trigger);
  expect(document.querySelector('dialog')).not.toBeNull();
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  expect(document.querySelector('dialog [role="status"]')?.textContent).toContain('Perfect lesson:');
  await act(async () => document.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(trigger);
  await click(trigger); expect(document.querySelector('dialog')).toBeNull();
  await click(button(last, 'Predict again')); await exact(0); await click(trigger);
  expect(document.querySelector('dialog')).toBeNull();
  expect(JSON.parse(localStorage.getItem(PERFECT_SEEN_KEY)!)).toContain('m01-l1');
});
it('shows the count only after completion at the footer, and removes a perfect module mark after Predict again', async () => {
  expect(host.querySelector('[data-prediction-count]')).toBeNull();
  await act(async () => update(p => {
    p.lessons['m01-l1'] = { completedAt: new Date().toISOString() };
    for (const s of predictions()) p.samples[s.id] = { prediction: s.answer.stdout, correct: true, verdict: 'exact', at: new Date().toISOString() };
  }));
  const count = host.querySelector('[data-prediction-count]')!;
  expect(count.textContent).toBe('1 of 1 prediction right'); expect(count.closest('footer')).not.toBeNull();
  await act(async () => router.navigate('/m/m01'));
  expect(host.querySelectorAll('[aria-label="Perfect lesson"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Perfect lesson"]')?.closest('a')?.getAttribute('href')).toContain(stem);
  await act(async () => router.navigate('/'));
  expect(host.querySelector('[data-perfect-total]')?.textContent).toBe('Perfect lessons: 1 of 6');
  await act(async () => router.navigate(`/m/m01/${stem}`));
  await click(button(host.querySelector(`[data-sample="${predictions()[0].id}"]`)!, 'Predict again'));
  expect(host.querySelector('[data-prediction-count]')?.textContent).toBe('0 of 1 prediction right');
  await act(async () => router.navigate('/m/m01')); expect(host.querySelector('[aria-label="Perfect lesson"]')).toBeNull();
});


async function escapeDialog() {
  await act(async () => document.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
}
it('browser mode waits for the deferred run and then restores focus to the enabled Run button', async () => {
  let finish!: (summary: RunSummary) => void;
  bag.pending = new Promise(resolve => { finish = resolve; });
  await act(async () => update(p => { p.settings.storedOutputMode = false; }));
  const box = await exact(0); const run = button(box, 'Run'); await click(run);
  expect(run.disabled).toBe(true); expect(document.querySelector('dialog')).toBeNull();
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
  await act(async () => finish({ compile: { ok: true, diagnostics: [], raw: '', ms: 1 }, stdout: predictions()[0].answer.stdout, stderr: '' }));
  expect(document.querySelector('dialog')).not.toBeNull(); expect(run.disabled).toBe(false);
  await escapeDialog(); expect(document.activeElement).toBe(run);
});
it('a reset cancels a pending browser celebration', async () => {
  let finish!: (summary: RunSummary) => void;
  bag.pending = new Promise(resolve => { finish = resolve; });
  await act(async () => update(p => { p.settings.storedOutputMode = false; }));
  const box = await exact(0); await click(button(box, 'Run')); await click(button(box, 'Predict again'));
  await act(async () => finish({ compile: { ok: true, diagnostics: [], raw: '', ms: 1 }, stdout: '', stderr: '' }));
  expect(document.querySelector('dialog')).toBeNull(); expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
});
it('the 64-bit check returns focus to its replacement button after the form unmounts', async () => {
  const source = Object.values(samples.samples).find(s => s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none')!;
  const s = { ...source, lesson: stem };
  bag.file = { ...samples, samples: { [s.id]: s } };
  await act(async () => router.navigate('/m/m01')); await act(async () => router.navigate(`/m/m01/${stem}`));
  const box = await exact(0); await click(button(box, 'Reveal the result')); expect(document.querySelector('dialog')).toBeNull();
  const input = box.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, nativeFor(s, undefined).run!.stdout);
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
  const check = button(box, 'Check my 64-bit prediction'); await click(check);
  expect(check.isConnected).toBe(false); expect(document.querySelector('dialog')).not.toBeNull();
  await escapeDialog(); expect(document.activeElement).toBe(button(box, 'Predict the 64-bit output again'));
});
it('navigation interrupts a celebration permanently even when returning before its timeout', async () => {
  const box = await exact(0); await click(button(box, 'Reveal the result')); expect(document.querySelector('dialog')).not.toBeNull();
  await act(async () => router.navigate('/m/m01/02-types-are-layouts')); expect(document.querySelector('dialog')).toBeNull();
  await act(async () => router.navigate(`/m/m01/${stem}`)); expect(document.querySelector('dialog')).toBeNull();
});
it('hides the footer count for a completed lesson without prediction questions', async () => {
  bag.file = { ...samples, samples: {} };
  await act(async () => router.navigate('/m/m01'));
  await act(async () => update(p => { p.lessons['m01-l1'] = { completedAt: new Date().toISOString() }; }));
  await act(async () => router.navigate(`/m/m01/${stem}`));
  expect(host.querySelector('[data-prediction-count]')).toBeNull();
});
it('reports failed samples chunks without publishing partial course totals', async () => {
  bag.failSamples = true;
  await act(async () => router.navigate('/m/m01'));
  expect(host.textContent).toContain('Perfect lesson marks unavailable.');
  await act(async () => router.navigate('/'));
  expect(host.textContent).toContain('Perfect lesson counts unavailable.');
  expect(host.querySelector('[data-perfect-total]')).toBeNull();
});

it('keeps the prediction callback stable across progress updates', async () => {
  await exact(0);
  await act(async () => update(p => { p.lessons['m01-l1'] = { completedAt: new Date().toISOString() }; }));
  expect(bag.callbacks.size).toBe(1);
});
