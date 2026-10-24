// @vitest-environment jsdom
// Real page, progress, stats, lesson context and CodeSample. Only content loading and the C runtime are replaced.
import { act, createElement, Fragment, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lessonChoiceIds, lessonCompilerErrorIds } from '../../../tools/mdx/remark-course';
import type { SamplesFile } from '../../content-model/types';
import samplesJson from '../../generated/samples/m01.json';
import { emptyProgress, getProgress, replaceProgress, update } from '../../progress/store';
import { PERFECT_SEEN_KEY, resetPerfectSeen } from '../../components/PerfectLesson';
import { usePredictionShown } from '../../lesson/LessonContext';
import { nativeFor } from '../../interactions/platform';
import type { RunPhase, RunSummary, useCRun } from '../../runtime/useCRun';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const samples = samplesJson as SamplesFile;
const bag = vi.hoisted(() => ({ pending: null as Promise<RunSummary> | null, file: null as SamplesFile | null, failSamples: false, stripQuestions: false, callbacks: new Set<unknown>() }));
const stem = '01-hello-compiled-world';
const MDX = readFileSync(join(process.cwd(), 'content/modules/m01-c-in-your-browser/lessons', `${stem}.mdx`), 'utf8');
/** M1 L1's <Choice> qids, hashed from the lesson's MDX the way remark-course does (the `?frontmatter` loader's `choices`; checked below). */
const QIDS = lessonChoiceIds(MDX);
const QUIZ = QIDS.length;
/** M1 L1's compiler-error questions (`<instance>:<kind>`), counted by the `?frontmatter` loader. */
const REPORT_QIDS = lessonCompilerErrorIds(MDX);
/** The fake lesson renders M1 L1's real CompilerError: sample, authored answer and the browser diagnostic's line. */
const REPORT_SAMPLE = 'missing-semicolon';
const REPORT_ANSWER: number = 1;
const REPORT_LINE = (samples.samples[REPORT_SAMPLE].results['wasm32-clang22']?.compile.diagnostics ?? []).find(d => d.severity !== 'note')!.line;
function ObserveCallback() { bag.callbacks.add(usePredictionShown()); return null; }
const predictions = () => Object.values((bag.file ?? samples).samples).filter(s => s.lesson === stem && s.meta.predict !== 'none');
vi.mock('../../content-runtime/course', async importOriginal => {
  const real = await importOriginal<typeof import('../../content-runtime/course')>();
  return { ...real, samplesFor: async (id: string) => { if (bag.failSamples) throw new Error('chunk failed'); return id === 'm01' ? bag.file ?? samples : null; }, sessionsFor: async () => null,
    // A test that needs a lesson with no scored questions strips the loader's question ids from its frontmatter.
    moduleById: (id: string) => {
      const m = real.moduleById(id);
      if (!bag.stripQuestions || !m) return m;
      return { ...m, lessons: m.lessons.map(l => ({ ...l, frontmatter: { ...l.frontmatter, choices: undefined, compilerErrors: undefined } })) };
    },
    lessonLoader: () => async () => ({ default: () => createElement(Fragment, null, createElement(ObserveCallback),
      ...predictions().map(s => createElement(CodeSample, { key: s.id, id: s.id, code: s.code, meta: JSON.stringify(s.meta) })),
      // M1 L1's real CompilerError (its nested fences are data, not prediction widgets), so its questions count and
      // answer like the lesson's own. The authored answer is option 1 (content/modules/m01.../01-hello-compiled-world.mdx).
      createElement(CompilerError, { key: 'report', ceid: REPORT_SAMPLE, question: 'What is clang telling you?', options: ['Spelled wrong', 'Missing semicolon', 'Needs quotes', 'Return first'], answer: REPORT_ANSWER },
        createElement(CodeSample, { key: REPORT_SAMPLE, id: REPORT_SAMPLE, code: samples.samples[REPORT_SAMPLE].code, meta: JSON.stringify(samples.samples[REPORT_SAMPLE].meta) }),
        createElement(CodeSample, { key: `${REPORT_SAMPLE}-fixed`, id: `${REPORT_SAMPLE}-fixed`, code: samples.samples[`${REPORT_SAMPLE}-fixed`].code, meta: JSON.stringify(samples.samples[`${REPORT_SAMPLE}-fixed`].meta) })),
      // The lesson's "Check your understanding" questions, with the qids remark-course gives them. Option 0 is right.
      ...QIDS.map((qid, i) => createElement(Choice, { key: qid, qid, question: `Question ${i}`, options: ['Right', 'Wrong'], answer: 0 }))) }),
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
const { Choice } = await import('../../interactions/Choice');
const { CompilerError } = await import('../../interactions/CompilerError');
const { modules } = await import('../../content-runtime/course');
const { LessonPage } = await import('./LessonPage');
const { ModulePage } = await import('./ModulePage');
const { CourseMap } = await import('./CourseMap');
let root: Root, host: HTMLDivElement, router: ReturnType<typeof createMemoryRouter>;
beforeEach(async () => {
  bag.pending = null; bag.file = null; bag.failSamples = false; bag.stripQuestions = false; bag.callbacks.clear();
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
async function answer(q: number, option = 0) {
  const box = host.querySelector(`[data-qid="${QIDS[q]}"]`)!;
  await act(async () => box.querySelectorAll('input')[option].click());
  const submit = box.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.focus(); await act(async () => submit.click());
  return box;
}
const answerQuizInStore = (correct = true) => act(async () => update(p => {
  for (const qid of QIDS) p.choices[`m01-l1#${qid}`] = { picked: correct ? 0 : 1, correct, at: new Date().toISOString() };
}));
/** M1 L1's CompilerError questions answered correctly in the store (as an import or an earlier visit would). */
const answerReportsInStore = (correct = true) => act(async () => update(p => {
  for (const qid of REPORT_QIDS) p.compilerErrors[`m01-l1#${qid}`] = { correct, at: new Date().toISOString() };
}));
const reportBox = () => host.querySelector<HTMLElement>('[data-interaction="compiler-error"]')!;
/** Answers the compiler-error exercise like a learner: click a line, pick an option, Check. */
async function answerReport({ line = REPORT_LINE, option = REPORT_ANSWER, check = true } = {}) {
  const box = reportBox();
  await act(async () => box.querySelector<HTMLInputElement>(`label[data-line="${line}"] input`)!.click());
  await act(async () => box.querySelectorAll<HTMLInputElement>('[data-question="kind"] input')[option].click());
  if (check) {
    const submit = box.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.focus(); await act(async () => submit.click());
  }
  return box;
}
async function escapeDialog() {
  await act(async () => document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
}
it('reads the lesson\'s quiz question ids from its frontmatter', () => {
  expect(QUIZ).toBe(3);
  expect(QIDS.every(q => /^q[0-9a-f]{8}$/.test(q))).toBe(true);
  expect(modules.m01.lessons.find(l => l.stem === stem)!.frontmatter.choices).toEqual(QIDS);
  expect(modules.m01.lessons.find(l => l.stem === '02-types-are-layouts')!.frontmatter.choices).toBeUndefined();
});
it('does not celebrate after the first exact prediction while quiz and compiler-error questions are unanswered (the M1 L1 bug); it fires after the last one', async () => {
  const box = await exact(0); await click(button(box, 'Reveal the result'));
  expect(document.querySelector('dialog')).toBeNull();
  await answerReport(); expect(document.querySelector('dialog')).toBeNull();
  await answer(0); await answer(1); expect(document.querySelector('dialog')).toBeNull();
  const last = await answer(2);
  expect(document.querySelector('dialog')).not.toBeNull();
  expect(getProgress().choices).toMatchObject({ [`m01-l1#${QIDS[0]}`]: { picked: 0, correct: true }, [`m01-l1#${QIDS[2]}`]: { picked: 0, correct: true } });
  expect(getProgress().compilerErrors).toMatchObject({ [`m01-l1#${REPORT_SAMPLE}:line`]: { correct: true }, [`m01-l1#${REPORT_SAMPLE}:kind`]: { correct: true } });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  expect(document.querySelector('dialog [role="status"]')?.textContent).toContain('Perfect lesson:');
  // Three kinds (prediction, quiz, compiler-error): the hint is neutral rather than a clumsy list.
  expect(document.querySelector('[data-perfect-hint]')?.textContent).toBe('Every question right on the first try. Press Esc or Close to continue.');
  await escapeDialog();
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(last.querySelector('button[type="submit"]'));
});
it('a quiz question missed on the first try is never perfect, even after Check again', async () => {
  await answer(0); await answer(1, 1); await answer(2);
  await answer(1, 0); // Check again, now right
  expect(getProgress().choices[`m01-l1#${QIDS[1]}`]).toMatchObject({ picked: 1, correct: false });
  const box = await exact(0); await click(button(box, 'Reveal the result'));
  expect(document.querySelector('dialog')).toBeNull();
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
});
it('after importing perfect progress, a quiz answer (wrong, right or Check again) never opens the celebration', async () => {
  // perfect-seen is local, so a fresh browser that imports a perfect lesson has not seen it.
  await answerQuizInStore(); await answerReportsInStore();
  await act(async () => update(p => { for (const s of predictions()) p.samples[s.id] = { prediction: s.answer.stdout, correct: true, verdict: 'exact', first: 'exact', at: new Date().toISOString() }; }));
  await answer(0, 1); expect(document.querySelector('dialog')).toBeNull();
  await answer(0, 0); expect(document.querySelector('dialog')).toBeNull();
  await answer(1, 0); expect(document.querySelector('dialog')).toBeNull();
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
});
it('after importing perfect progress, Predict again and an exact reveal (or 64-bit check) never open the celebration', async () => {
  // perfect-seen is local, so a fresh browser that imports a perfect lesson has not seen it.
  const source = Object.values(samples.samples).find(s => s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none')!;
  const s = { ...source, lesson: stem };
  bag.file = { ...samples, samples: { [s.id]: s } };
  await answerQuizInStore(); await answerReportsInStore();
  const out64 = nativeFor(s, undefined).run!.stdout;
  await act(async () => update(p => { p.samples[s.id] = { prediction: s.answer.stdout, correct: true, verdict: 'exact', first: 'exact', predict64: out64, predict64Correct: true, predict64Verdict: 'exact', first64: 'exact', at: new Date().toISOString() }; }));
  await act(async () => router.navigate('/m/m01')); await act(async () => router.navigate(`/m/m01/${stem}`));
  const box = host.querySelector(`[data-sample="${s.id}"]`)!;
  await click(button(box, 'Predict the 64-bit output again'));
  const input = box.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, out64);
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
  await click(button(box, 'Check my 64-bit prediction'));
  expect(document.querySelector('dialog')).toBeNull();
  await click(button(box, 'Predict again'));
  await exact(0); await click(button(box, 'Reveal the result'));
  expect(getProgress().samples[s.id]).toMatchObject({ verdict: 'exact', first: 'exact', first64: 'exact' });
  expect(document.querySelector('dialog')).toBeNull();
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
});
it('celebrates after the last exact reveal, never lock-in or rerun, and only once after a reset', async () => {
  await answerQuizInStore(); await answerReportsInStore();
  const last = await exact(0); expect(document.querySelector('dialog')).toBeNull();
  expect(getProgress().samples[predictions()[0].id].verdict).toBe('exact');
  const trigger = button(last, 'Reveal the result'); await click(trigger);
  expect(document.querySelector('dialog')).not.toBeNull();
  expect(getProgress().samples[predictions()[0].id].first).toBe('exact');
  await act(async () => document.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
  expect(document.querySelector('dialog')).not.toBeNull();
  await click(document.querySelector<HTMLButtonElement>('[data-perfect-close]')!);
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await click(trigger); expect(document.querySelector('dialog')).toBeNull();
  await click(button(last, 'Predict again'));
  expect(getProgress().samples[predictions()[0].id]).toMatchObject({ cleared: true, first: 'exact' });
  await exact(0); await click(trigger);
  expect(document.querySelector('dialog')).toBeNull();
  expect(JSON.parse(localStorage.getItem(PERFECT_SEEN_KEY)!)).toContain('m01-l1');
});
it('a wrong first prediction stays wrong after Predict again and an exact second try', async () => {
  await answerQuizInStore();
  const box = host.querySelector(`[data-sample="${predictions()[0].id}"]`)!;
  const input = box.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'surely not this');
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
  await click(button(box, 'Lock in my prediction')); await click(button(box, 'Reveal the result'));
  expect(getProgress().samples[predictions()[0].id].first).toBe('wrong');
  await click(button(box, 'Predict again')); await exact(0); await click(button(box, 'Reveal the result'));
  expect(document.querySelector('dialog')).toBeNull();
  expect(getProgress().samples[predictions()[0].id]).toMatchObject({ verdict: 'exact', first: 'wrong' });
});
it('shows the count of predictions, quiz and compiler-error questions after completion; a module mark needs them all', async () => {
  const scored = 1 + QUIZ + REPORT_QIDS.length; // one prediction, the quiz questions and the compiler-error questions
  expect(host.querySelector('[data-prediction-count]')).toBeNull();
  await act(async () => update(p => {
    p.lessons['m01-l1'] = { completedAt: new Date().toISOString() };
    for (const s of predictions()) p.samples[s.id] = { prediction: s.answer.stdout, correct: true, verdict: 'exact', at: new Date().toISOString() };
  }));
  const count = host.querySelector('[data-prediction-count]')!;
  // Three kinds: the neutral label rather than a list.
  expect(count.textContent).toBe(`1 of ${scored} questions right`); expect(count.closest('footer')).not.toBeNull();
  await act(async () => router.navigate('/m/m01'));
  expect(host.querySelector('[aria-label="Perfect lesson"]')).toBeNull();
  await answerQuizInStore(); await answerReportsInStore();
  expect(host.querySelectorAll('[aria-label="Perfect lesson"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Perfect lesson"]')?.closest('a')?.getAttribute('href')).toContain(stem);
  await act(async () => router.navigate('/'));
  // 11 lessons have a scored question once compiler-error questions count.
  expect(host.querySelector('[data-perfect-total]')?.textContent).toBe('Perfect lessons: 1 of 11');
  await act(async () => router.navigate(`/m/m01/${stem}`));
  expect(host.querySelector('[data-prediction-count]')?.textContent).toBe(`${scored} of ${scored} questions right`);
  // Predict again keeps the first try: the lesson stays perfect.
  await click(button(host.querySelector(`[data-sample="${predictions()[0].id}"]`)!, 'Predict again'));
  expect(host.querySelector('[data-prediction-count]')?.textContent).toBe(`${scored} of ${scored} questions right`);
  await answerQuizInStore(false);
  // The prediction and both compiler-error questions stay right, the three quiz questions are wrong.
  expect(host.querySelector('[data-prediction-count]')?.textContent).toBe(`3 of ${scored} questions right`);
  await act(async () => router.navigate('/m/m01')); expect(host.querySelector('[aria-label="Perfect lesson"]')).toBeNull();
});

it('browser mode waits for the deferred run and then restores focus to the enabled Run button', async () => {
  await answerQuizInStore(); await answerReportsInStore();
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
  await answerQuizInStore(); await answerReportsInStore();
  await act(async () => router.navigate('/m/m01')); await act(async () => router.navigate(`/m/m01/${stem}`));
  const box = await exact(0); await click(button(box, 'Reveal the result')); expect(document.querySelector('dialog')).toBeNull();
  const input = box.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, nativeFor(s, undefined).run!.stdout);
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
  const check = button(box, 'Check my 64-bit prediction'); await click(check);
  expect(check.isConnected).toBe(false); expect(document.querySelector('dialog')).not.toBeNull();
  await escapeDialog(); expect(document.activeElement).toBe(button(box, 'Predict the 64-bit output again'));
});
it('a second 64-bit try after "Predict the 64-bit output again" keeps the first 64-bit verdict', async () => {
  const source = Object.values(samples.samples).find(s => s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none')!;
  const s = { ...source, lesson: stem };
  bag.file = { ...samples, samples: { [s.id]: s } };
  await answerQuizInStore(); await answerReportsInStore();
  await act(async () => router.navigate('/m/m01')); await act(async () => router.navigate(`/m/m01/${stem}`));
  const box = await exact(0); await click(button(box, 'Reveal the result'));
  const fill64 = async (text: string) => {
    const input = box.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
    await click(button(box, 'Check my 64-bit prediction'));
  };
  await fill64('surely not the 64-bit output');
  expect(getProgress().samples[s.id]).toMatchObject({ first: 'exact', predict64Verdict: 'wrong', first64: 'wrong' });
  await click(button(box, 'Predict the 64-bit output again'));
  await fill64(nativeFor(s, undefined).run!.stdout);
  expect(getProgress().samples[s.id]).toMatchObject({ predict64Verdict: 'exact', first64: 'wrong' });
  expect(document.querySelector('dialog')).toBeNull();
});
it('a reset clears the seen mark, so finishing the lesson perfectly again celebrates', async () => {
  await answerQuizInStore(); await answerReportsInStore();
  const first = await exact(0); await click(button(first, 'Reveal the result'));
  expect(document.querySelector('dialog')).not.toBeNull();
  await click(document.querySelector<HTMLButtonElement>('[data-perfect-close]')!);
  expect(JSON.parse(localStorage.getItem(PERFECT_SEEN_KEY)!)).toContain('m01-l1');
  // What Settings' "Reset all progress" does: an empty document plus resetPerfectSeen (the mark is outside the document).
  await act(async () => { replaceProgress(emptyProgress()); resetPerfectSeen(); });
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
  // The reset also cleared the retrieval quiz (the lesson gate) and the stored-output setting; put both back.
  await act(async () => update(p => {
    p.quizzes['m01:retrieval'] = { score: 1, total: 1, passed: true, at: new Date().toISOString(), answers: {} };
    p.settings.storedOutputMode = true;
  }));
  await answerQuizInStore(); await answerReportsInStore();
  await act(async () => router.navigate('/m/m01')); await act(async () => router.navigate(`/m/m01/${stem}`));
  const again = await exact(0); await click(button(again, 'Reveal the result'));
  expect(document.querySelector('dialog')).not.toBeNull();
});
it('navigation interrupts a celebration permanently', async () => {
  await answerQuizInStore(); await answerReportsInStore();
  const box = await exact(0); await click(button(box, 'Reveal the result')); expect(document.querySelector('dialog')).not.toBeNull();
  await act(async () => router.navigate('/m/m01/02-types-are-layouts')); expect(document.querySelector('dialog')).toBeNull();
  await act(async () => router.navigate(`/m/m01/${stem}`)); expect(document.querySelector('dialog')).toBeNull();
});
it('counts quiz and compiler-error questions for a lesson without predictions, and hides the count with no scored items', async () => {
  bag.file = { ...samples, samples: {} };
  await act(async () => router.navigate('/m/m01'));
  await act(async () => update(p => { p.lessons['m01-l1'] = { completedAt: new Date().toISOString() }; p.lessons['m01-l2'] = { completedAt: new Date().toISOString() }; }));
  await act(async () => router.navigate(`/m/m01/${stem}`));
  expect(host.querySelector('[data-prediction-count]')?.textContent)
    .toBe(`0 of ${QUIZ + REPORT_QIDS.length} quiz questions and compiler-error questions right`);
  // A lesson the loader says asks nothing (and with no samples left) hides the count.
  bag.stripQuestions = true;
  await act(async () => router.navigate('/m/m01/02-types-are-layouts'));
  expect(host.querySelector('[data-prediction-count]')).toBeNull();
});
it('a lesson with only quiz and compiler-error questions celebrates after the last one, and its hint names both', async () => {
  // No prediction samples, but the compiler-error program (and its fixed version) still have generated output.
  bag.file = { ...samples, samples: {
    [REPORT_SAMPLE]: samples.samples[REPORT_SAMPLE],
    [`${REPORT_SAMPLE}-fixed`]: samples.samples[`${REPORT_SAMPLE}-fixed`],
  } };
  await act(async () => router.navigate('/m/m01')); await act(async () => router.navigate(`/m/m01/${stem}`));
  await answerReport(); await answer(0); await answer(1); expect(document.querySelector('dialog')).toBeNull();
  await answer(2);
  expect(document.querySelector('[data-perfect-hint]')?.textContent).toBe('Every quiz question and compiler-error question right on the first try. Press Esc or Close to continue.');
});
it('a wrong first compiler-error line or option blocks perfect, even after a right retry', async () => {
  await answerQuizInStore();
  const box = await exact(0); await click(button(box, 'Reveal the result'));
  expect(document.querySelector('dialog')).toBeNull();
  // A wrong line first, then the right one; then a wrong option, then the right one. Both first answers stay wrong.
  const wrongLine = REPORT_LINE === 1 ? 2 : 1;
  const report = reportBox();
  await act(async () => report.querySelector<HTMLInputElement>(`label[data-line="${wrongLine}"] input`)!.click());
  await act(async () => report.querySelector<HTMLInputElement>(`label[data-line="${REPORT_LINE}"] input`)!.click());
  await act(async () => report.querySelectorAll<HTMLInputElement>('[data-question="kind"] input')[REPORT_ANSWER === 0 ? 1 : 0].click());
  const submit = report.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  await act(async () => submit.click());
  await act(async () => report.querySelectorAll<HTMLInputElement>('[data-question="kind"] input')[REPORT_ANSWER].click());
  await act(async () => submit.click());
  expect(getProgress().compilerErrors[`m01-l1#${REPORT_SAMPLE}:line`]).toMatchObject({ correct: false });
  expect(getProgress().compilerErrors[`m01-l1#${REPORT_SAMPLE}:kind`]).toMatchObject({ correct: false });
  expect(document.querySelector('dialog')).toBeNull();
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
});
it('a compiler-error Check with every answer already imported never opens the celebration', async () => {
  // perfect-seen is local, so a fresh browser that imports a perfect lesson has not seen it.
  await answerQuizInStore(); await answerReportsInStore();
  await act(async () => update(p => { for (const s of predictions()) p.samples[s.id] = { prediction: s.answer.stdout, correct: true, verdict: 'exact', first: 'exact', at: new Date().toISOString() }; }));
  await act(async () => router.navigate('/m/m01')); await act(async () => router.navigate(`/m/m01/${stem}`));
  // Retrying the questions of an already-perfect imported lesson must not celebrate.
  await answerReport();
  expect(document.querySelector('dialog')).toBeNull();
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
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
