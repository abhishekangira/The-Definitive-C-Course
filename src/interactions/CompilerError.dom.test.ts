// @vitest-environment jsdom
// <CompilerError session="…"> mounted for real (react-dom + jsdom) on tools/verify's output for the m97 fixture sessions:
// the report tabs, and a wrong answer marked wrong on each grading path (line, kind, stage, fix). The expected line is
// never typed here: it is the source line that the fixture marks with its only comment (see report-questions.test.ts).
// Replaced: the lesson context (to hand it that file), the browser compiler and the code editor.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionsFile } from '../content-model/types';
import type { RunRequest, RunSummary } from '../runtime/useCRun';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
const done = vi.fn();
let nextRun: RunSummary;
const run = vi.fn(async (_req: RunRequest) => nextRun);
vi.mock('../lesson/LessonContext', () => ({ useSessions: () => m97, useSamples: () => null, useCardDone: () => done }));
vi.mock('../runtime/useCRun', () => ({ useCRun: () => ({ run, phase: 'idle', diagnostics: [], rawDiagnostics: '', segments: [], result: null, stop: () => {} }) }));
vi.mock('../components/CodeEditor', () => ({ CodeEditor: ({ value }: { value: string }) => createElement('pre', { 'data-editor': '' }, value) }));
const { CompilerError } = await import('./CompilerError');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); done.mockReset(); run.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
type Props = Parameters<typeof CompilerError>[0];
const base = { question: 'What is wrong?', options: ['A write past the end of an array', 'A leak'], answer: 0 };
const render = (props: Partial<Props> & { session: string }) => act(() => root.render(createElement(CompilerError, { ...base, ...props } as Props)));
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
const marked = (id: string, file: string) => m97.sessions[id].sources[file].split('\n').findIndex(l => l.includes('/*')) + 1;
const lineFeedback = () => host.querySelector('[data-line-right]');
const check = () => click(host.querySelector('button[type="submit"]'));
const status = () => host.querySelector('form + [role="status"]')?.textContent;

describe('<CompilerError session>', () => {
  it('shows the stored report in platform tabs labelled by tool, and the pending macOS run', () => {
    render({ session: 'valgrind-leak', fix: false });
    expect([...host.querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(['Linux/WSL · gcc 13 · Valgrind', 'Linux/WSL · clang 22 · Valgrind']);
    expect(host.querySelector('[role="tabpanel"]')!.textContent).toContain(m97.sessions['valgrind-leak'].runs['linux-gcc']!.at(-1)!.stderr.split('\n')[0]);
    expect(host.querySelector('[data-pending]')!.textContent).toBe('No stored run for macOS · Apple clang.');
    expect(host.querySelector('legend')!.textContent).toBe('1. Which line of l.c is the report pointing at? Click it.');
  });

  it('line: the first user frame of the stored report is right, any other line is wrong', () => {
    render({ session: 'asan', fix: false });
    const right = marked('asan', 'main.c');
    click(host.querySelector(`label[data-line="${right - 1}"] input`));
    expect(lineFeedback()!.getAttribute('data-line-right')).toBe('false');
    expect(lineFeedback()!.textContent).toContain('Look for the first line of the report that names your file, main.c');
    click(host.querySelector(`label[data-line="${right}"] input`));
    expect(lineFeedback()!.getAttribute('data-line-right')).toBe('true');
    // Same answer on the other compiler's tab: the frame comes from the report shown.
    click(host.querySelectorAll('[role="tab"]')[1]);
    expect(lineFeedback()!.getAttribute('data-line-right')).toBe('true');
  });

  it('kind: a wrong option is marked wrong and the card is still done (no fix step)', () => {
    render({ session: 'asan', fix: false });
    click(host.querySelector(`label[data-line="${marked('asan', 'main.c')}"] input`));
    click(host.querySelectorAll('form input[type="radio"]')[1]);
    check();
    expect(status()).toContain('Not quite.');
    expect(host.querySelector('[data-correct="false"] input:checked')).not.toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
    click(host.querySelectorAll('form input[type="radio"]')[0]);
    expect(status()).toContain('Correct.');
  });

  it('stage: the right kind with the wrong stage is not correct; a link error asks no line', () => {
    render({ session: 'link-undefined', step: 2, stage: 'link', fix: false, options: ['`area` is never defined', 'A typo'] });
    expect(host.querySelector('[data-line]')).toBeNull();
    expect([...host.querySelectorAll('legend')].map(l => l.textContent)).toEqual(['What is wrong?', '2. Which stage failed?']); // MiniMarkdown makes "1. …" a list item
    expect(host.querySelector('[role="tab"]')!.textContent).toBe('Linux/WSL · gcc 13 · ld');
    click(host.querySelectorAll('form input[type="radio"]')[0]);
    const stage = (s: string) => [...host.querySelectorAll('[data-question="stage"] label')].find(l => l.textContent === s)!.querySelector('input');
    click(stage('Compile'));
    check();
    expect(status()).toContain('Not quite: look again at which stage stopped.');
    expect(host.querySelector('[data-question="stage"] [data-correct="false"] input:checked')).not.toBeNull();
    click(stage('Link'));
    expect(status()).toContain('Correct.');
  });

  it('fix: runs the session source under the UBSan guardrail; a run that still reports is not fixed, a clean one is', async () => {
    render({ session: 'ubsan', stage: 'run', fix: 'ubsan', options: ['Signed overflow', 'A leak'] });
    click(host.querySelector(`label[data-line="${marked('ubsan', 'main.c')}"] input`));
    click(host.querySelectorAll('form input[type="radio"]')[0]);
    click([...host.querySelectorAll('[data-question="stage"] input')][4]);
    check();
    expect(done).not.toHaveBeenCalled();
    expect(host.querySelector('[data-editor]')!.textContent).toBe(m97.sessions.ubsan.sources['main.c']);
    const compile = { ok: true, diagnostics: [], raw: '', ms: 1 };
    nextRun = { compile, result: { kind: 'exit', exitCode: 1, ms: 1, wallMs: 1 }, stdout: '', stderr: m97.sessions.ubsan.runs['linux-clang']!.at(-1)!.stderr }; // as the guardrail runtime reports
    const fixButton = [...host.querySelectorAll('button')].find(b => b.textContent === 'Compile and check')!;
    await act(async () => { fixButton.click(); });
    expect(run.mock.calls[0][0]).toMatchObject({ files: { 'main.c': m97.sessions.ubsan.sources['main.c'] }, guardrail: true, leakcheck: false });
    expect(host.textContent).toContain('It still stops with an error');
    nextRun = { compile, result: { kind: 'exit', exitCode: 0, ms: 1, wallMs: 1 }, stdout: 'done\n', stderr: '' };
    await act(async () => { fixButton.click(); });
    expect(host.textContent).toContain('Fixed: it compiles cleanly and runs with no undefined behaviour.');
  });

  it('says on screen when a fix cannot be checked in the browser (more than one .c file)', () => {
    render({ session: 'link-multiple', stage: 'link', fix: 'compile' });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('give link-multiple fix={false}');
  });
});
