// @vitest-environment jsdom
// <CompilerError session="…"> mounted for real (react-dom + jsdom) on tools/verify's output for the m97 fixture sessions:
// the report tabs, and a wrong answer marked wrong on each grading path (line, kind, stage, fix). The expected line is
// never typed here: it is the `bug:` line of the fixture session.yaml (see report-questions.test.ts).
// Replaced: the lesson context (to hand it that file), the browser compiler and the code editor.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionsFile } from '../content-model/types';
import type { RunRequest, RunSummary } from '../runtime/useCRun';
import { emptyProgress, getProgress, replaceProgress, subscribeProgress } from '../progress/store';
import styles from './Interaction.module.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
const done = vi.fn();
/** The perfect-lesson report: fired only when an answer newly saves a right first try. */
const scored = vi.fn();
let nextRun: RunSummary;
const run = vi.fn(async (_req: RunRequest) => nextRun);
vi.mock('../lesson/LessonContext', () => ({
  useSessions: () => m97, useSamples: () => null, useCardDone: () => done,
  useLesson: () => ({ lessonId: 'm97-l1' }),
  // A new identity on every render, as a progress update could hand the component: only a new tick may report.
  usePredictionShown: () => () => { scored(); },
}));
vi.mock('../runtime/useCRun', () => ({ useCRun: () => ({ run, phase: 'idle', diagnostics: [], rawDiagnostics: '', segments: [], result: null, stop: () => {} }) }));
vi.mock('../components/CodeEditor', () => ({ CodeEditor: ({ value }: { value: string }) => createElement('pre', { 'data-editor': '' }, value) }));
const { CompilerError } = await import('./CompilerError');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  done.mockReset(); scored.mockReset(); run.mockClear();
  localStorage.clear(); replaceProgress(emptyProgress());
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
type Props = Parameters<typeof CompilerError>[0];
const base = { question: 'What is wrong?', options: ['A write past the end of an array', 'A leak'], answer: 0 };
// `ceid` is what remark-course assigns (the session id here); pass one explicitly to test a duplicate's `-2` id.
const render = (props: Partial<Props> & { session: string }) =>
  act(() => root.render(createElement(CompilerError, { ...base, ...props, ceid: props.ceid ?? props.session } as Props)));
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
// The oracle: the `bug: <file>:<line>` key in the fixture session's session.yaml, never a comment in the C file.
const bug = (id: string) => {
  const doc = parseYaml(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/content/modules/m97-sessions/sessions', id, 'session.yaml'), 'utf8')) as { bug: string };
  const [file, line] = doc.bug.split(':');
  return { file, line: Number(line) };
};
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

  it('line: the verdict waits for Check, then the first user frame is right and any other line is wrong', () => {
    render({ session: 'asan', fix: false });
    const right = bug('asan').line;
    const pick = (n: number) => click(host.querySelector(`label[data-line="${n}"] input`));
    // The lines wearing each highlight: picked (before Check), right or wrong (after it).
    const marked = (cls: string) => [...host.querySelectorAll('label[data-line]')].filter(l => l.classList.contains(cls)).map(l => Number(l.getAttribute('data-line')));
    pick(right);
    expect(marked(styles.linePicked)).toEqual([right]);
    pick(right - 1);
    // Choosing a line does not grade it: arrow keys check a radio as they move through the group.
    expect(lineFeedback()).toBeNull();
    // The picked highlight moves with the choice, and no right/wrong colour shows before Check.
    expect(marked(styles.linePicked)).toEqual([right - 1]);
    expect([...marked(styles.choiceRight), ...marked(styles.choiceWrong)]).toEqual([]);
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    check();
    expect(lineFeedback()!.getAttribute('data-line-right')).toBe('false');
    // After Check the verdict colour replaces the picked highlight.
    expect(marked(styles.choiceWrong)).toEqual([right - 1]);
    expect(marked(styles.linePicked)).toEqual([]);
    expect(lineFeedback()!.textContent).toContain('Look for the first line of the report that names your file, main.c');
    // The line counts in the verdict too: a right option alone is not "Correct.".
    expect(status()).toContain('Not quite: look again at which line the report points at.');
    pick(right);
    expect(lineFeedback()!.getAttribute('data-line-right')).toBe('true');
    // Same answer on the other compiler's tab: the frame comes from the report shown.
    click(host.querySelectorAll('[role="tab"]')[1]);
    expect(lineFeedback()!.getAttribute('data-line-right')).toBe('true');
  });

  it('line: a line any platform\'s report names is right, whichever tab is on screen', () => {
    // Two real reports that disagree: ASan's gcc run (main.c:5) and UBSan's clang run (main.c:6), over ASan's main.c.
    const asan = m97.sessions.asan;
    m97.sessions['asan-ubsan'] = { ...asan, id: 'asan-ubsan', runs: { 'linux-gcc': asan.runs['linux-gcc'], 'linux-clang': m97.sessions.ubsan.runs['linux-clang'] } };
    try {
      render({ session: 'asan-ubsan', fix: false });
      const pick = (n: number) => click(host.querySelector(`label[data-line="${n}"] input`));
      pick(bug('ubsan').line); // clang's frame, while the gcc tab is on screen
      click(host.querySelectorAll('[data-question="kind"] input')[0]);
      check();
      expect(lineFeedback()!.getAttribute('data-line-right')).toBe('true');
      click(host.querySelectorAll('[role="tab"]')[1]);
      expect(lineFeedback()!.getAttribute('data-line-right')).toBe('true');
      pick(bug('asan').line); // gcc's frame, while the clang tab is on screen
      expect(lineFeedback()!.getAttribute('data-line-right')).toBe('true');
      pick(bug('asan').line - 1);
      expect(lineFeedback()!.getAttribute('data-line-right')).toBe('false');
    } finally { delete m97.sessions['asan-ubsan']; }
  });

  it('kind: a wrong option is marked wrong and the card is still done (no fix step)', () => {
    render({ session: 'asan', fix: false });
    click(host.querySelector(`label[data-line="${bug('asan').line}"] input`));
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
    expect([...host.querySelectorAll('legend')].map(l => l.textContent)).toEqual(['1. What is wrong?', '2. Which stage failed?']);
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
    click(host.querySelector(`label[data-line="${bug('ubsan').line}"] input`));
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

  it('numbers the questions it shows 1, 2, 3 in plain legend text, never as a list (which read 1, 1, 3)', () => {
    render({ session: 'asan', stage: 'run', fix: false, question: 'What does `ASan` report?' });
    const legends = [...host.querySelectorAll('legend')];
    expect(legends.map(l => l.textContent)).toEqual(['1. Which line of main.c is the report pointing at? Click it.', '2. What does ASan report?', '3. Which stage failed?']);
    // A list inside a legend restarts at 1 and indents its question unlike the others.
    expect(host.querySelector('legend ol, legend ul, legend p')).toBeNull();
    expect(legends[1].querySelector('code')!.textContent).toBe('ASan');
  });

  it('shows the session source as stored, and the bug line explains nothing (no comment gives the answer away)', () => {
    for (const id of ['asan', 'ubsan', 'compile-error', 'valgrind-leak']) {
      const { file, line } = bug(id);
      render({ session: id, stage: 'run', fix: false });
      const shown = [...host.querySelectorAll('label[data-line] code')].map(c => c.textContent);
      const disk = readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/content/modules/m97-sessions/sessions', id, file), 'utf8');
      expect(shown, `${id}: the displayed ${file} is the file on disk`).toEqual(disk.split('\n').map(l => l || ' '));
      expect(shown[line - 1], `${id}: ${file}:${line}`).not.toMatch(/\/\*|\/\//);
    }
  });

  it('says on screen when a fix cannot be checked in the browser (more than one .c file)', () => {
    render({ session: 'link-multiple', stage: 'link', fix: 'compile' });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('give link-multiple fix={false}');
  });
});

// The scored first answers (perfect lessons). The ids are the lesson id and `<instance>:<kind>`, as remark-course and
// the `?frontmatter` loader assign them. `scored` stands in for LessonPage's perfect check.
const answer = (qid: string) => getProgress().compilerErrors[`m97-l1#${qid}`];
const seedAnswer = (...qids: string[]) => {
  const p = emptyProgress();
  for (const qid of qids) p.compilerErrors[`m97-l1#${qid}`] = { correct: true, at: new Date().toISOString() };
  replaceProgress(p);
};
describe('<CompilerError> scored questions', () => {
  it('line: selecting a line saves nothing; a wrong line on Check stays the first answer and a retry never celebrates', () => {
    seedAnswer('asan:kind'); // the kind is already answered, so only the line can report here
    render({ session: 'asan', fix: false });
    const right = bug('asan').line;
    click(host.querySelector(`label[data-line="${right === 1 ? 2 : 1}"] input`));
    expect(answer('asan:line')).toBeUndefined(); // not saved on selection (arrow keys fire onChange too)
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    check();
    expect(answer('asan:line')).toMatchObject({ correct: false });
    click(host.querySelector(`label[data-line="${right}"] input`));
    check();
    expect(answer('asan:line')).toMatchObject({ correct: false });
    expect(scored).not.toHaveBeenCalled();
  });

  it('line: a right line on the first Check is saved once and reports to the perfect check', () => {
    seedAnswer('asan:kind');
    render({ session: 'asan', fix: false });
    click(host.querySelector(`label[data-line="${bug('asan').line}"] input`));
    expect(answer('asan:line')).toBeUndefined();
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    check();
    expect(answer('asan:line')).toMatchObject({ correct: true });
    expect(scored).toHaveBeenCalledTimes(1);
    check();
    expect(scored).toHaveBeenCalledTimes(1);
  });

  it('kind: a wrong first option stays wrong after a right retry; the retry never celebrates', () => {
    seedAnswer('asan:line'); // the line is already answered, so only the kind answer can report here
    render({ session: 'asan', fix: false });
    click(host.querySelector(`label[data-line="${bug('asan').line}"] input`));
    expect(scored).not.toHaveBeenCalled();
    click(host.querySelectorAll('[data-question="kind"] input')[1]);
    check();
    expect(answer('asan:kind')).toMatchObject({ correct: false });
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    check();
    expect(answer('asan:kind')).toMatchObject({ correct: false });
    expect(scored).not.toHaveBeenCalled();
  });

  it('kind: a right first option saves on Check and reports once', () => {
    seedAnswer('asan:line');
    render({ session: 'asan', fix: false });
    click(host.querySelector(`label[data-line="${bug('asan').line}"] input`));
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    check();
    expect(answer('asan:kind')).toMatchObject({ correct: true });
    expect(scored).toHaveBeenCalledTimes(1);
  });

  it('stage: stage="link" asks no line; the first stage answer is kept and a right kind still reports', () => {
    render({ session: 'link-undefined', step: 2, stage: 'link', fix: false, options: ['`area` is never defined', 'A typo'] });
    expect(host.querySelector('[data-line]')).toBeNull();
    const stage = (s: string) => [...host.querySelectorAll('[data-question="stage"] label')].find(l => l.textContent === s)!.querySelector('input');
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    click(stage('Compile'));
    check();
    expect(answer('link-undefined:kind')).toMatchObject({ correct: true });
    expect(answer('link-undefined:stage')).toMatchObject({ correct: false });
    expect(answer('link-undefined:line')).toBeUndefined();
    expect(scored).toHaveBeenCalledTimes(1);
    scored.mockClear();
    click(stage('Link'));
    check();
    expect(answer('link-undefined:stage')).toMatchObject({ correct: false });
    expect(scored).not.toHaveBeenCalled();
  });

  it('one Check saves the line, kind and stage first answers in a single update and reports once', () => {
    render({ session: 'ubsan', stage: 'run', fix: false });
    const changes = vi.fn();
    const stop = subscribeProgress(changes);
    try {
      click(host.querySelector(`label[data-line="${bug('ubsan').line}"] input`));
      click(host.querySelectorAll('[data-question="kind"] input')[0]);
      click([...host.querySelectorAll('[data-question="stage"] input')][4]); // run
      expect(host.querySelectorAll('legend')).toHaveLength(3);
      check();
      // One update for the three answers, not one per question: the perfect-lesson check sees them together.
      expect(changes).toHaveBeenCalledTimes(1);
      expect(answer('ubsan:line')).toMatchObject({ correct: true });
      expect(answer('ubsan:kind')).toMatchObject({ correct: true });
      expect(answer('ubsan:stage')).toMatchObject({ correct: true });
      expect(scored).toHaveBeenCalledTimes(1);
      // A retried Check rewrites nothing, so it is a no-op update (and never reports again).
      changes.mockClear();
      check();
      expect(changes).not.toHaveBeenCalled();
      expect(scored).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it('a new report callback identity on a later render does not report the old tick again', () => {
    seedAnswer('asan:line'); // only the kind can report
    render({ session: 'asan', fix: false });
    click(host.querySelector(`label[data-line="${bug('asan').line}"] input`));
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    check();
    expect(scored).toHaveBeenCalledTimes(1);
    // A later render (the learner changes the line) with a fresh callback must not replay the old tick.
    click(host.querySelector(`label[data-line="${bug('asan').line === 1 ? 2 : 1}"] input`));
    expect(scored).toHaveBeenCalledTimes(1);
  });

  it('a Check over answers already in imported progress never reports', () => {
    seedAnswer('asan:line', 'asan:kind');
    render({ session: 'asan', fix: false });
    click(host.querySelector(`label[data-line="${bug('asan').line}"] input`));
    click(host.querySelectorAll('[data-question="kind"] input')[0]);
    check();
    expect(scored).not.toHaveBeenCalled();
  });
});
