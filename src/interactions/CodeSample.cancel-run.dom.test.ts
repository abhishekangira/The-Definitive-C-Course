// @vitest-environment jsdom
// CodeSample with the real useCRun and a compile promise the test holds. Predict again during compilation
// must leave Run enabled after the learner locks a new prediction, and must not start the program.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleMeta, SampleResult, SamplesFile, TargetId } from '../content-model/types';
import { emptyProgress, replaceProgress } from '../progress/store';
import type { CompileResult } from '../runtime/CRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bag = vi.hoisted(() => ({ done: vi.fn(), samples: null as SamplesFile | null }));
const gate = vi.hoisted(() => {
  const compiles: Array<(r: CompileResult) => void> = [];
  return {
    compiles,
    compile: vi.fn(() => new Promise<CompileResult>(resolve => { compiles.push(resolve); })),
    run: vi.fn(() => ({ done: new Promise(() => {}), provideInput() {}, sendEOF() {}, kill() {} })),
  };
});

vi.mock('../lesson/LessonContext', () => ({
  useSamples: () => bag.samples,
  useCardDone: () => bag.done,
  useSessions: () => null,
}));
vi.mock('../runtime/CRuntime', () => ({
  getRuntime: () => gate,
  detectStdinMode: () => 'preset' as const,
}));
vi.mock('../components/CodeEditor', () => ({
  preloadCodeEditor: () => {},
  CodeEditor: ({ value }: { value: string }) => createElement('pre', { 'data-editor': '' }, value),
}));
vi.mock('../components/Terminal', () => ({ Terminal: () => null, exitLine: () => null }));

const { CodeSample } = await import('./CodeSample');

const ready: CompileResult = {
  ok: true,
  wasm: new Uint8Array([1]),
  diagnostics: [{ file: 'main.c', line: 1, col: 1, severity: 'warning', message: 'noise' }],
  raw: 'warning: noise',
  ms: 1,
};

function result(): SampleResult {
  const meta: SampleMeta = { id: 's', predict: 'output' };
  const stdout = '3 -3 1\n3.5\n';
  const compile = { ok: true, diagnostics: [], raw: '' };
  const target = (t: TargetId) => ({ target: t, compiler: 'test', compile, run: { stdout, stderr: '', exit: 0 } });
  return {
    id: 's', module: 'm', lesson: 'l', code: 'int main(void) { return 0; }\n', meta, hash: 'h', flagged: false,
    results: { 'wasm32-clang22': target('wasm32-clang22'), 'linux-x86_64-gcc13': target('linux-x86_64-gcc13') },
    answer: { stdout, outcome: 'runs' },
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  replaceProgress(emptyProgress());
  bag.done.mockClear();
  bag.samples = null;
  gate.compile.mockClear();
  gate.run.mockClear();
  gate.compiles.length = 0;
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

describe('<CodeSample> Predict again during compilation', () => {
  it('leaves Run enabled and starts no program', async () => {
    const s = result();
    bag.samples = { module: 'm', generatedBy: 'test', samples: { [s.id]: s } };
    await act(async () => { root.render(createElement(CodeSample, { id: s.id, code: s.code, meta: JSON.stringify(s.meta) })); });
    await fill(host.querySelector('textarea')!, '3 -3 1\n3.5');
    await click(button('Lock in my prediction'));
    await click(button('Run'));
    expect(button('Run again').disabled).toBe(true);
    expect(gate.compile).toHaveBeenCalledTimes(1);
    expect(gate.run).not.toHaveBeenCalled();

    await click(button('Predict again'));
    await fill(host.querySelector('textarea')!, '3 -3 1\n3.5');
    await click(button('Lock in my prediction'));
    expect(button('Run').disabled).toBe(false);

    await act(async () => {
      gate.compiles[0](ready);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gate.run).not.toHaveBeenCalled();
    expect(button('Run').disabled).toBe(false);
  });
});
