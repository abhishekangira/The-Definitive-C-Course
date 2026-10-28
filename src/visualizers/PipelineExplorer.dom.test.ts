// @vitest-environment jsdom
// The V7 tab set and its stored native panes: lesson 1.1's <PipelineExplorer> with no props must stay exactly the
// three tabs it shipped with; the MDX `stages` attribute adds the live views; `session` adds a real machine's run
// with platform tabs, the "no stored run" message and two-way source-line highlighting. Only the lesson context is
// replaced, to hand it tools/verify's committed m97 output.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionsFile } from '../content-model/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
vi.mock('../lesson/LessonContext', () => ({ useSessions: () => m97 }));
const { PipelineExplorer } = await import('./PipelineExplorer');

const SOURCE = m97.sessions.pipeline.sources['main.c'];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (props: { code: string; stages?: string; session?: string }) => act(() => root.render(createElement(PipelineExplorer, props)));
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(t => t.textContent);
const tablist = (label: string) => host.querySelector<HTMLElement>(`[role="tablist"][aria-label="${label}"]`)!;
const click = (el: Element) => act(() => (el as HTMLButtonElement).click());

describe('<PipelineExplorer> tabs', () => {
  it('renders exactly the three lesson-1.1 tabs without a stages prop', () => {
    render({ code: SOURCE });
    expect(tabs()).toEqual(['1. Your source', '2. After the preprocessor', '3. Assembly (WebAssembly)']);
  });

  it('adds the object, nm and link tabs when the MDX asks for them, in the author’s order', () => {
    render({ code: SOURCE, stages: 'source,E,S,objdump-t,objdump-d,nm,link' });
    expect(tabs()).toEqual([
      '1. Your source', '2. After the preprocessor', '3. Assembly (WebAssembly)',
      '4. Object file: symbols', '5. Object file: instructions', '6. nm: defined and undefined', '7. Link',
    ]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('1. Your source');
  });

  it('keeps the source tab first and drops names it does not know', () => {
    render({ code: SOURCE, stages: 'E,no-such-tab,source,nm' });
    expect(tabs()).toEqual(['1. Your source', '2. After the preprocessor', '6. nm: defined and undefined']);
  });
});

describe('<PipelineExplorer session> native panes', () => {
  it('shows one tab per stored platform and says the macOS run is not stored', () => {
    render({ code: SOURCE, session: 'pipeline' });
    expect([...tablist('Platform for this stored run').querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual([
      'Linux/WSL · gcc 13', 'Linux/WSL · clang 22',
    ]);
    expect(host.querySelector('[data-pending]')!.textContent).toBe('No stored run for macOS · Apple clang.');
    // The pane on screen names the platform it is from; it is never passed off as macOS.
    expect(host.querySelector('[aria-label="Assembly (-S -g) for Linux/WSL · gcc 13"]')!.textContent).toContain('pushq');
    expect(host.querySelector('[aria-label="Assembly (-S -g) for macOS · Apple clang"]')).toBeNull();
  });

  it('switches the native view and the platform from the tab buttons', () => {
    render({ code: SOURCE, session: 'pipeline' });
    click([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(t => t.textContent === 'nm')!);
    expect(host.querySelector('[aria-label="nm for Linux/WSL · gcc 13"]')!.textContent).toContain('T main');
    expect(host.querySelector('[aria-label="Source lines"]')).toBeNull(); // nm has no line info
    click([...tablist('Platform for this stored run').querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(t => t.textContent!.includes('clang'))!);
    expect(host.querySelector('[aria-label="nm for Linux/WSL · clang 22"]')!.textContent).toContain('T main');
    click([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(t => t.textContent === 'objdump -d -l')!);
    expect(host.querySelector('[aria-label="objdump -d -l for Linux/WSL · clang 22"]')!.textContent).toContain('Disassembly of section .text:');
  });

  it('highlights a source line’s instructions, and selects the source line of an instruction', () => {
    render({ code: SOURCE, session: 'pipeline' });
    click(host.querySelector('button[aria-label^="Source line 8:"]')!);
    const pressed = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Text line"][aria-pressed="true"]')].map(b => b.getAttribute('aria-label')!);
    expect(pressed.some(l => l.includes('$5,'))).toBe(true);
    expect(pressed.some(l => l.includes('call\tsquare'))).toBe(false);

    const call = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Text line"]')].find(b => b.getAttribute('aria-label')!.includes('call\tsquare'))!;
    click(call);
    expect(host.querySelector('button[aria-label^="Source line 9:"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('button[aria-label^="Source line 8:"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('turns highlighting off when the fence is not the source the session ran', () => {
    render({ code: 'int main(void) { return 0; }\n', session: 'pipeline' });
    expect(host.textContent).toContain('different version of this source');
    expect(host.querySelector('button[aria-label^="Text line"]')).toBeNull();
    expect(host.querySelector('[aria-label="Assembly (-S -g) for Linux/WSL · gcc 13"]')!.textContent).toContain('pushq');
  });

  it('names a session it does not have instead of rendering nothing', () => {
    render({ code: SOURCE, session: 'no-such-session' });
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/session no-such-session hasn't been generated/);
  });
});
