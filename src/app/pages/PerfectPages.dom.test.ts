// @vitest-environment jsdom
// Real page, progress, stats, lesson context and CodeSample. Only content loading and the C runtime are replaced.
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SamplesFile } from '../../content-model/types';
import samplesJson from '../../generated/samples/m01.json';
import { discover } from '../../../tools/verify/discover';
import { emptyProgress, getProgress, replaceProgress, update } from '../../progress/store';
import { PERFECT_SEEN_KEY } from '../../components/PerfectLesson';
import type { useCRun } from '../../runtime/useCRun';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The verifier regenerates these metadata fields before CI tests. Locally reuse stored output without native runs.
const authored = discover({ contentRoot: 'content', module: 'm01' }).samples;
const samples: SamplesFile = { ...samplesJson, samples: Object.fromEntries(Object.entries(samplesJson.samples).map(([id, s]) => [id, { ...s, meta: authored.find(a => a.id === id)!.meta }])) } as SamplesFile;
const stem = '01-hello-compiled-world';
const predictions = Object.values(samples.samples).filter(s => s.lesson === stem && s.meta.predict !== 'none');
vi.mock('../../content-runtime/course', async importOriginal => {
  const real = await importOriginal<typeof import('../../content-runtime/course')>();
  return { ...real, samplesFor: async (id: string) => id === 'm01' ? samples : null, sessionsFor: async () => null,
    lessonLoader: () => async () => ({ default: () => createElement(Fragment, null, ...predictions.map(s => createElement(CodeSample, { key: s.id, id: s.id, code: s.code, meta: JSON.stringify(s.meta) }))) }),
  };
});
vi.mock('../../content-runtime/mdx-components', () => ({ mdxComponents: {} }));
vi.mock('../../components/CodeEditor', () => ({ preloadCodeEditor() {}, CodeEditor: () => null }));
vi.mock('../../runtime/CRuntime', () => ({ getRuntime: () => ({ prefetch() {} }) }));
vi.mock('../../runtime/useCRun', () => ({ useCRun: (): ReturnType<typeof useCRun> => ({ phase: 'idle', diagnostics: [], rawDiagnostics: '', segments: [], result: null,
  run: async () => ({ compile: { ok: true, diagnostics: [], raw: '', ms: 0 }, stdout: '', stderr: '' }), stop() {}, reset() {}, sendInput() {}, sendEOF() {},
}) }));
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
  const box = host.querySelector(`[data-sample="${predictions[index].id}"]`)!;
  const input = box.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, predictions[index].answer.stdout);
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
  await click(button(box, 'Lock in my prediction'));
  return box;
}
it('celebrates after the last exact reveal, never lock-in or rerun, and only once after a reset', async () => {
  const last = await exact(0); expect(document.querySelector('dialog')).toBeNull();
  expect(getProgress().samples[predictions[0].id].verdict).toBe('exact');
  const trigger = button(last, 'Reveal the result'); await click(trigger);
  expect(document.querySelector('dialog')).not.toBeNull();
  expect(host.querySelector('[role="status"].visually-hidden')?.textContent).toContain('Perfect lesson:');
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
    for (const s of predictions) p.samples[s.id] = { prediction: s.answer.stdout, correct: true, verdict: 'exact', at: new Date().toISOString() };
  }));
  const count = host.querySelector('[data-prediction-count]')!;
  expect(count.textContent).toBe('1 of 1 predictions right'); expect(count.closest('footer')).not.toBeNull();
  await act(async () => router.navigate('/m/m01'));
  expect(host.querySelectorAll('[aria-label="Perfect lesson"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Perfect lesson"]')?.closest('a')?.getAttribute('href')).toContain(stem);
  await act(async () => router.navigate('/'));
  expect(host.querySelector('[data-perfect-total]')?.textContent).toBe('Perfect lessons: 1 of 6');
  await act(async () => router.navigate(`/m/m01/${stem}`));
  await click(button(host.querySelector(`[data-sample="${predictions[0].id}"]`)!, 'Predict again'));
  expect(host.querySelector('[data-prediction-count]')?.textContent).toBe('0 of 1 predictions right');
  await act(async () => router.navigate('/m/m01')); expect(host.querySelector('[aria-label="Perfect lesson"]')).toBeNull();
});
