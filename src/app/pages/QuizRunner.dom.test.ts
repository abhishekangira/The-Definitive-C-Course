// @vitest-environment jsdom
// QuizRunner mounted for real (react-dom + jsdom) with sp and session-backed ce/order items, on generated data only:
// tools/verify's stored output for the m97 fixture sessions and tools/trace's add-frames trace. Each grading path
// (sp line, ce kind, ce stage, order) marks a wrong answer wrong. Replaced: the quiz loader (to hand it these items and
// files), the progress store, the code editor and the exercise runner (no exercise items here).
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionsFile, TraceFile } from '../../content-model/types';
import type { QuizItem } from '../../content-runtime/course';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const m97 = JSON.parse(read('tools/verify/fixtures/generated/sessions/m97.json')) as SessionsFile;
const trace = JSON.parse(read('src/generated/traces/add-frames.json')) as TraceFile;
let items: QuizItem[] = [];
vi.mock('../../content-runtime/course', () => ({
  quizFor: () => items, samplesFor: async () => null, sessionsFor: async () => m97,
  traceFor: async (id: string) => (id === 'add-frames' ? trace : null),
}));
vi.mock('../../progress/store', async orig => ({ ...await orig<typeof import('../../progress/store')>(), update: () => {}, noteActivity: () => {}, useProgress: () => ({ quizzes: {} }) }));
vi.mock('../../interactions/Exercise', () => ({ Exercise: () => null }));
vi.mock('../../components/CodeEditor', () => ({ CodeEditor: ({ value }: { value: string }) => createElement('pre', null, value), preloadCodeEditor: () => {} }));
const { QuizRunner } = await import('./QuizRunner');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (...list: QuizItem[]) => { items = list; await act(async () => root.render(createElement(QuizRunner, { moduleId: 'm97', kind: 'checkpoint' }))); };
const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click(); });
const submit = () => click(host.querySelector('button[type="submit"]'));
const verdict = () => host.querySelector('[role="status"] strong')?.textContent;
const srcLine = (text: string) => trace.source.split('\n').findIndex(l => l.includes(text)) + 1;
const lineButton = (n: number) => host.querySelector(`ol[aria-label^="Program"] li:nth-child(${n}) button`);

const sp: QuizItem = { id: 'q-sp', type: 'sp', prompt: 'The program is paused.', sample: 'add-frames', line: srcLine('int result = add(x, y);'), explain: 'step goes into add.' };
const ce: QuizItem = { id: 'q-ce', type: 'ce', prompt: 'Read the report.', session: 'link-undefined', step: 2, stage: 'link', choices: ['A function is declared but never defined', 'A semicolon is missing'], answer: 0, explain: 'x' };
const MAKE = m97.sessions.make.runs['linux-gcc']!.map(s => s.cmd);
const order: QuizItem = { id: 'q-order', type: 'order', prompt: 'Put the commands in the order the session runs them.', session: 'make', items: MAKE, explain: 'x' };

/** Puts the order list into `want` with the Move up buttons (as a keyboard user would). */
function arrange(want: string[]) {
  for (let i = 0; i < want.length; i++) {
    let at = [...host.querySelectorAll('ol li code')].map(c => c.textContent).indexOf(want[i]);
    while (at > i) { click(host.querySelector(`button[aria-label="Move up: ${want[i]}"]`)); at--; }
  }
}

// The three stacks, read from the trace here without quiz-answers.ts: paused at the call, one step later (inside add),
// and where `next` stops (the printf line, back in main).
const stackAt = (i: number) => [...trace.steps[i].stack].reverse();
const iNow = trace.steps.findIndex(s => s.line === srcLine('int result = add(x, y);'));
const STACK = { step: stackAt(iNow + 1), before: stackAt(iNow), next: stackAt(trace.steps.findIndex(s => s.line === srcLine('printf'))) };
const bt = (frames: Array<{ func: string; line: number }>) => frames.map((f, i) => `#${i} ${f.func}, line ${f.line}`).join('');
const stackOption = (which: keyof typeof STACK) => [...host.querySelectorAll('[data-question="stack"] label')].find(l => l.textContent!.startsWith(bt(STACK[which])));
const answerSp = (line: number, stack: keyof typeof STACK) => { click(lineButton(line)); click(stackOption(stack)!.querySelector('input')); submit(); };

describe('QuizRunner sp items', () => {
  it('shows the paused line and its call stack, and asks two numbered parts: the next line and the stack', async () => {
    await render(sp);
    expect(host.querySelector('[aria-current="step"]')!.textContent).toContain('int result = add(x, y);');
    expect(host.textContent).toContain(`Paused before line ${srcLine('int result = add(x, y);')}`);
    expect(host.querySelector('[data-question="line"]')!.textContent).toMatch(/^1\. After one step, which line/);
    expect(host.querySelector('[data-question="stack"] legend')!.textContent).toBe('2. After that step, what does bt show?');
    expect(host.querySelector('[data-question="stack"] ol, [data-question="stack"] ul')).toBeNull(); // no Markdown list numbers
    // Three options, all from the trace, and none marked before submitting.
    expect([...host.querySelectorAll('[data-question="stack"] label')].map(l => l.textContent).sort()).toEqual([bt(STACK.step), bt(STACK.before), bt(STACK.next)].sort());
    expect(host.querySelector('[data-stack]')).toBeNull();
    expect(host.querySelector('button[type="submit"]')!.hasAttribute('disabled')).toBe(true);
    click(lineButton(STACK.step[0].line));
    expect(host.querySelector('button[type="submit"]')!.hasAttribute('disabled')).toBe(true); // both parts needed
  });

  it('is right only with the right line and the stack after step', async () => {
    await render(sp);
    answerSp(STACK.step[0].line, 'step');
    expect(verdict()).toContain('Correct.');
    expect(host.querySelector('[data-line-right]')!.getAttribute('data-line-right')).toBe('true');
    expect(host.querySelector('[data-stack-right]')!.getAttribute('data-stack-right')).toBe('true');
  });

  it('marks a wrong line wrong: `step` does not go over the call', async () => {
    await render(sp);
    answerSp(srcLine('printf'), 'step');
    expect(verdict()).toContain('Not quite.');
    expect(lineButton(srcLine('printf'))).toBeNull(); // locked: lines are no longer buttons
    expect(host.querySelector('ol[aria-label^="Program"] li[class*="wrong"]')!.textContent).toContain('printf');
    expect(host.querySelector('[data-line-right]')!.getAttribute('data-line-right')).toBe('false');
  });

  for (const wrong of ['next', 'before'] as const) {
    it(`marks a wrong stack wrong (the stack ${wrong === 'next' ? 'after next' : 'before the step'}), with the right line`, async () => {
      await render(sp);
      answerSp(STACK.step[0].line, wrong);
      expect(verdict()).toContain('Not quite.');
      expect(host.querySelector('[data-line-right]')!.getAttribute('data-line-right')).toBe('true');
      expect(host.querySelector('[data-stack-right]')!.getAttribute('data-stack-right')).toBe('false');
      expect(stackOption(wrong)!.getAttribute('data-stack')).toBe('wrong');
      expect(stackOption('step')!.getAttribute('data-stack')).toBe('right');
    });
  }

  it('cannot ask about a line that calls nothing: the three stacks would not all differ', async () => {
    await render({ ...sp, line: srcLine('int x = 3;') });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('calls no function');
    expect(host.querySelector('[data-question="stack"]')).toBeNull();
  });
});

describe('QuizRunner ce items with a session', () => {
  it('shows the stored report of the step in platform tabs', async () => {
    await render(ce);
    expect([...host.querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(['Linux/WSL · gcc 13 · ld', 'Linux/WSL · clang 22 · ld']);
    expect(host.querySelector('[role="tabpanel"]')!.textContent).toContain(m97.sessions['link-undefined'].runs['linux-gcc']![1].stderr.split('\n')[0]);
    expect(host.querySelector('[role="tabpanel"]')!.textContent).not.toContain('nm main.o');
  });

  const answer = async (kind: number, stage: string) => {
    await render(ce);
    click(host.querySelectorAll('input[name="q-ce"]')[kind]);
    click([...host.querySelectorAll('input[name="q-ce-stage"]')].find(i => i.parentElement!.textContent === stage));
    submit();
  };
  it('is right with the right kind and stage', async () => { await answer(0, 'Link'); expect(verdict()).toContain('Correct.'); });
  it('marks a wrong kind wrong', async () => { await answer(1, 'Link'); expect(verdict()).toContain('Not quite.'); });
  it('marks a wrong stage wrong, and says which stage failed', async () => {
    await answer(0, 'Compile');
    expect(verdict()).toContain('Not quite.');
    expect(host.querySelector('[data-stage-right]')!.getAttribute('data-stage-right')).toBe('false');
    expect(host.querySelector('[data-stage-right]')!.textContent).toContain('Link');
  });
  it('keeps the options and the answer when the platform tab changes', async () => {
    await render(ce);
    const options = () => [...host.querySelectorAll('fieldset label')].map(l => l.textContent);
    const before = options();
    click(host.querySelectorAll('[role="tab"]')[1]);
    expect(options()).toEqual(before);
    click(host.querySelectorAll('input[name="q-ce"]')[0]);
    click([...host.querySelectorAll('input[name="q-ce-stage"]')].find(i => i.parentElement!.textContent === 'Link'));
    submit();
    expect(verdict()).toContain('Correct.');
  });
});

describe('QuizRunner order items with a session', () => {
  it('grades against the stored run\'s commands, then shows the run', async () => {
    await render(order);
    expect(host.querySelector('[role="tabpanel"]')).toBeNull(); // the run would give the order away
    arrange(MAKE);
    submit();
    expect(verdict()).toContain('Correct.');
    expect([...host.querySelectorAll('[data-place-right]')].map(l => l.getAttribute('data-place-right'))).toEqual(MAKE.map(() => 'true'));
    expect(host.querySelector('[role="tabpanel"]')!.textContent).toContain('make -f spaces.mk');
  });

  it('marks a swapped order wrong, and each misplaced command', async () => {
    await render(order);
    arrange([MAKE[1], MAKE[0], ...MAKE.slice(2)]);
    submit();
    expect(verdict()).toContain('Not quite.');
    expect([...host.querySelectorAll('[data-place-right]')].map(l => l.getAttribute('data-place-right'))).toEqual(['false', 'false', 'true', 'true']);
  });

  it('is graded against the stored run, not the YAML items: a stale item list cannot pass', async () => {
    await render({ ...order, items: [MAKE[1], MAKE[0], ...MAKE.slice(2)] });
    arrange([MAKE[1], MAKE[0], ...MAKE.slice(2)]);
    submit();
    expect(verdict()).toContain('Not quite.');
  });
});
