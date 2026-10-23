// @vitest-environment jsdom
// CodeSample mounted for real: the three verdicts, the two labelled boxes, and the 64-bit question.
// Replaced: the lesson context (samples and card completion), the browser compiler and the code editor.
// The progress store is the real one.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleMeta, SampleResult, SamplesFile, TargetId } from '../content-model/types';
import { emptyProgress, getProgress, replaceProgress, sampleVerdict } from '../progress/store';
import styles from './Interaction.module.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bag = vi.hoisted(() => ({ done: vi.fn(), samples: null as SamplesFile | null }));
vi.mock('../lesson/LessonContext', () => ({
  useSamples: () => bag.samples,
  useCardDone: () => bag.done,
  useSessions: () => null,
}));
vi.mock('../runtime/useCRun', () => ({
  useCRun: () => ({ run: async () => {}, phase: 'idle', diagnostics: [], rawDiagnostics: '', segments: [], result: null, stop: () => {}, sendInput: () => {}, sendEOF: () => {} }),
}));
vi.mock('../components/CodeEditor', () => ({ CodeEditor: ({ value }: { value: string }) => createElement('pre', { 'data-editor': '' }, value) }));
// Terminal pulls in the compiler runtime, which needs a generated toolchain file this test never runs.
vi.mock('../components/Terminal', () => ({ Terminal: () => null, exitLine: () => null }));

const { CodeSample } = await import('./CodeSample');

const CLOSE = 'Almost: the values are right, but the spacing, punctuation or line breaks differ.';
const compile = { ok: true, diagnostics: [], raw: '' };

function result(over: Partial<SampleMeta> & { stdout?: string; nativeStdout?: string; outcome?: SampleResult['answer']['outcome']; flagged?: boolean } = {}): SampleResult {
  const id = over.id ?? 's';
  const stdout = over.stdout ?? '3 -3 1\n3.5\n';
  const nativeStdout = over.nativeStdout ?? stdout;
  const meta: SampleMeta = { id, predict: over.predict, match: over.match, choices: over.choices, predict64: over.predict64, platform: over.flagged || undefined };
  const target = (t: TargetId, out: string) => ({ target: t, compiler: 'test', compile, run: { stdout: out, stderr: '', exit: 0 } });
  return {
    id, module: 'm', lesson: 'l', code: 'int main(void) { return 0; }\n', meta, hash: 'h', flagged: Boolean(over.flagged),
    results: { 'wasm32-clang22': target('wasm32-clang22', stdout), 'linux-x86_64-gcc13': target('linux-x86_64-gcc13', nativeStdout) },
    answer: { stdout, outcome: over.outcome ?? 'runs' },
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  replaceProgress(emptyProgress());
  bag.done.mockClear();
  bag.samples = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
async function fill(el: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}
function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(b => b.textContent === name);
  if (!found) throw new Error(`no button "${name}"`);
  return found as HTMLButtonElement;
}
const statuses = () => [...host.querySelectorAll('[role="status"]')] as HTMLElement[];
const icon = (el: Element) => el.querySelector('svg')?.getAttribute('data-icon');

async function remount() {
  await act(async () => { root.unmount(); });
  host.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  bag.done.mockClear();
  replaceProgress(emptyProgress());
}

async function show(s: SampleResult) {
  bag.samples = { module: 'm', generatedBy: 'test', samples: { [s.id]: s } };
  await act(async () => { root.render(createElement(CodeSample, { id: s.id, code: s.code, meta: JSON.stringify(s.meta) })); });
}

async function lockAndRun(text: string) {
  await fill(host.querySelector('textarea')!, text);
  await click(button('Lock in my prediction'));
  await click(button('Run'));
}

describe('<CodeSample> verdicts', () => {
  it('shows green with a check and no boxes, and stores exact', async () => {
    await show(result());
    await lockAndRun('3 -3 1\n3.5');
    expect(statuses()).toHaveLength(1);
    expect(statuses()[0].textContent).toContain('Your prediction was right.');
    expect(statuses()[0].className).toContain(styles.good);
    expect(icon(statuses()[0])).toBe('check');
    expect(host.querySelector('[data-compare]')).toBeNull();
    expect(host.textContent).not.toContain('You predicted');
    expect(getProgress().samples.s).toMatchObject({ verdict: 'exact', correct: true });
    expect(bag.done).toHaveBeenCalledTimes(1);
  });

  it('shows yellow for a close prediction, the two boxes outside the status, and completes the card on Run', async () => {
    await show(result());
    await fill(host.querySelector('textarea')!, '3, -3, 1\n3.5');
    await click(button('Lock in my prediction'));
    expect(bag.done).not.toHaveBeenCalled();
    expect(getProgress().samples.s).toMatchObject({ prediction: '3, -3, 1\n3.5', verdict: 'close', correct: true });
    expect(host.querySelector('[role="status"]')).toBeNull();
    await click(button('Run'));
    expect(bag.done).toHaveBeenCalledTimes(1);
    const status = statuses()[0];
    expect(status.textContent).toContain(CLOSE);
    expect(status.textContent).not.toContain('Not quite.');
    expect(status.className).toContain(styles.close);
    expect(icon(status)).toBe('almost');
    expect(status.querySelector('[data-compare]')).toBeNull();
    const predicted = host.querySelector('[data-compare="predicted"]')!;
    const actual = host.querySelector('[data-compare="actual"]')!;
    expect(predicted.closest('[role="status"]')).toBeNull();
    expect(predicted.previousElementSibling!.textContent).toBe('You predicted');
    expect(actual.previousElementSibling!.textContent).toBe('Actual output');
    expect([...predicted.querySelectorAll('[data-line]')].map(el => el.textContent)).toEqual(['3, -3, 1', '3.5']);
    expect([...actual.querySelectorAll('[data-line]')].map(el => el.textContent)).toEqual(['3 -3 1', '3.5']);
    expect([...predicted.querySelectorAll('[data-diff]')].map(el => el.textContent)).toEqual([',', ',']);
    expect(actual.querySelector('[data-diff]')).toBeNull();
    expect(predicted.querySelector('[data-line]')!.className).toContain(styles.compareLine);
  });

  it('match=exact turns that same prediction red', async () => {
    await show(result({ match: 'exact' }));
    await lockAndRun('3, -3, 1\n3.5');
    expect(statuses()[0].textContent).toContain('Not quite.');
    expect(statuses()[0].textContent).not.toContain('Almost');
    expect(statuses()[0].className).toContain(styles.bad);
    expect(icon(statuses()[0])).toBe('cross');
    expect(getProgress().samples.s).toMatchObject({ verdict: 'wrong', correct: false });
    expect(host.querySelectorAll('[data-compare]')).toHaveLength(2);
  });

  it('match=close keeps the yellow box', async () => {
    await show(result({ match: 'close' }));
    await lockAndRun('3, -3, 1\n3.5');
    expect(statuses()[0].textContent).toContain(CLOSE);
    expect(icon(statuses()[0])).toBe('almost');
    expect(getProgress().samples.s.verdict).toBe('close');
  });

  it('shows red with both boxes when the values differ', async () => {
    await show(result({ stdout: '3 1\n' }));
    await lockAndRun('31');
    expect(statuses()[0].textContent).toContain('Not quite.');
    expect(statuses()[0].textContent).not.toContain('Expected');
    expect(icon(statuses()[0])).toBe('cross');
    expect(host.querySelector('[data-compare="predicted"]')!.textContent).toContain('31');
    expect(host.querySelector('[data-compare="actual"]')!.textContent).toContain('3 1');
    expect(host.querySelectorAll('[data-diff]').length).toBeGreaterThan(0);
    expect(getProgress().samples.s).toMatchObject({ verdict: 'wrong', correct: false });
  });

  it('shows (nothing) for an empty prediction', async () => {
    await show(result());
    await lockAndRun(' \n');
    expect(host.querySelector('[data-compare="predicted"]')!.textContent).toBe('(nothing)');
    expect(statuses()[0].textContent).toContain('Not quite.');
    expect(getProgress().samples.s.verdict).toBe('wrong');
  });

  it('shows a missing line as a gap and an extra blank line as "empty line"', async () => {
    await show(result({ stdout: '3 -3 1\n' }));
    await lockAndRun('3 -3 1\n\n3.5');
    const predicted = [...host.querySelectorAll('[data-compare="predicted"] [data-line]')];
    const actual = [...host.querySelectorAll('[data-compare="actual"] [data-line]')];
    const blankPred = predicted.find(el => el.getAttribute('data-blank') !== null && el.getAttribute('data-gap') === null)!;
    const blankAct = actual.find(el => el.getAttribute('data-gap') !== null && el.getAttribute('data-blank') !== null)!;
    expect(blankPred.getAttribute('aria-label')).toBe('empty line');
    expect(blankPred.textContent).toBe('');
    expect(blankAct.getAttribute('aria-label')).toBe('empty line');
    expect(blankAct.textContent).toBe('');
    expect(predicted.some(el => el.textContent === '3.5')).toBe(true);
    expect(actual.some(el => el.getAttribute('data-gap') !== null && el.textContent === '')).toBe(true);
  });

  it('recomputes yellow from an old save that has no verdict, and does not rewrite it', async () => {
    const p = emptyProgress();
    p.samples.s = { prediction: '3, -3, 1\n3.5', correct: false, at: '2026-01-01T00:00:00.000Z' };
    replaceProgress(p);
    await show(result());
    expect(statuses()[0].textContent).toContain(CLOSE);
    expect(icon(statuses()[0])).toBe('almost');
    expect(getProgress().samples.s.verdict).toBeUndefined();
    expect(sampleVerdict(getProgress().samples.s)).toBe('wrong');
  });
});

describe('<CodeSample> predict64', () => {
  const wide = () => result({ flagged: true, predict64: 'What does the 64-bit run print?', stdout: '4\n', nativeStdout: '3 -3 1\n3.5\n' });

  async function mainThen64(p64: string, match?: 'exact' | 'close') {
    await show(result({ ...wide().meta, match, flagged: true, stdout: '4\n', nativeStdout: '3 -3 1\n3.5\n', predict64: wide().meta.predict64 }));
    await lockAndRun('4');
    expect(bag.done).not.toHaveBeenCalled();
    const at = getProgress().samples.s.at;
    await fill(host.querySelector('textarea')!, p64);
    await click(button('Check my 64-bit prediction'));
    expect(getProgress().samples.s.at).toBe(at);
    expect(bag.done).toHaveBeenCalledTimes(1);
  }

  it('is green, yellow and red, and match=exact turns the yellow case red', async () => {
    await mainThen64('3 -3 1\n3.5');
    const exact = statuses().find(s => s.textContent!.includes('64-bit'))!;
    expect(exact.textContent).toContain('Right for 64-bit too.');
    expect(icon(exact)).toBe('check');
    expect(host.querySelector('[data-compare]')).toBeNull();
    expect(getProgress().samples.s).toMatchObject({ predict64Verdict: 'exact', predict64Correct: true });

    await remount();
    await mainThen64('3, -3, 1\n3.5');
    const close = statuses().find(s => s.textContent!.includes('Almost'))!;
    expect(close.className).toContain(styles.close);
    expect(icon(close)).toBe('almost');
    expect(close.querySelector('[data-compare]')).toBeNull();
    expect([...host.querySelectorAll('[data-compare="predicted"] [data-diff]')].map(el => el.textContent)).toEqual([',', ',']);
    expect(getProgress().samples.s).toMatchObject({ predict64Verdict: 'close', predict64Correct: true });

    await remount();
    await mainThen64('nope');
    const wrong = statuses().filter(s => s.textContent!.includes('Not quite.'));
    expect(wrong).toHaveLength(1);
    expect(icon(wrong[0])).toBe('cross');
    expect(host.querySelectorAll('[data-compare]')).toHaveLength(2);
    expect(getProgress().samples.s).toMatchObject({ predict64: 'nope', predict64Verdict: 'wrong', predict64Correct: false });

    await remount();
    await mainThen64('3, -3, 1\n3.5', 'exact');
    expect(statuses().some(s => s.textContent!.includes('Almost'))).toBe(false);
    expect(statuses().some(s => s.textContent!.includes('Not quite.'))).toBe(true);
    expect(getProgress().samples.s.predict64Verdict).toBe('wrong');
  });

  it('does not count a whitespace-only 64-bit answer as right when the native run is missing', async () => {
    const s = wide();
    s.results['linux-x86_64-gcc13']!.run = undefined;
    await show(s);
    await lockAndRun('4');
    await fill(host.querySelector('textarea')!, '   \n');
    await click(button('Check my 64-bit prediction'));
    expect(host.textContent).not.toContain('Right for 64-bit too.');
    expect(host.textContent).not.toContain('Almost:');
    expect(getProgress().samples.s.predict64Correct).toBe(false);
    expect(getProgress().samples.s.predict64Verdict).toBe('wrong');
  });
});

describe('<CodeSample> outcome and choice', () => {
  it('never shows yellow for an outcome', async () => {
    await show(result({ predict: 'outcome', outcome: 'runs' }));
    await click(host.querySelector('input[value="runs"]')!);
    await click(button('Lock in my prediction'));
    await click(button('Run'));
    expect(statuses()[0].textContent).toContain('Your prediction was right.');
    expect(host.querySelector('[data-compare]')).toBeNull();
    expect(getProgress().samples.s.verdict).toBe('exact');

    await remount();
    await show(result({ predict: 'outcome', outcome: 'runs' }));
    await click(host.querySelector('input[value="compile-error"]')!);
    await click(button('Lock in my prediction'));
    await click(button('Run'));
    expect(statuses()[0].textContent).toContain('Not quite.');
    expect(statuses()[0].textContent).not.toContain('Almost');
    expect(host.querySelector('[data-compare]')).toBeNull();
    expect(getProgress().samples.s.verdict).toBe('wrong');
  });

  it('never shows yellow for a choice, including one that would be close as output', async () => {
    const choices = ['3 -3 1', '3, -3, 1'];
    await show(result({ predict: 'choice', choices, stdout: '3 -3 1\n' }));
    await click(host.querySelector('input[value="3, -3, 1"]')!);
    await click(button('Lock in my prediction'));
    await click(button('Run'));
    expect(statuses()[0].textContent).toContain('Not quite.');
    expect(statuses()[0].textContent).toContain('It prints');
    expect(statuses()[0].textContent).not.toContain('Almost');
    expect(host.querySelector('[data-compare]')).toBeNull();
    expect(getProgress().samples.s).toMatchObject({ verdict: 'wrong', correct: false });
  });
});
