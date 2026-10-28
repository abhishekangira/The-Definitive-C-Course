// @vitest-environment jsdom
// The V7 tab set, its keyboard/reporting behaviour and its stored native panes: lesson 1.1's <PipelineExplorer> with
// no props stays exactly the three tabs it shipped with; `stages` adds the live views (tab pattern, focusable output,
// a failed link printed once); `session` adds a real machine's run with platform tabs, the "no stored run" message and
// two-way source-line highlighting. Only CRuntime and the lesson context are replaced, to hand it the m97 fixture.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionsFile, SessionResult } from '../content-model/types';
import { update } from '../progress/store';

const { stageMock } = vi.hoisted(() => ({ stageMock: vi.fn() }));
vi.mock('../runtime/CRuntime', () => ({
  getRuntime: () => ({ stage: stageMock, state: { status: 'ready', ms: 0, fromCache: true }, subscribe: () => () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
let sessionsFile: SessionsFile = m97;
vi.mock('../lesson/LessonContext', () => ({ useSessions: () => sessionsFile }));
const { PipelineExplorer } = await import('./PipelineExplorer');

const SOURCE = m97.sessions.pipeline.sources['main.c'];
const code = 'int main(void) {\n    return 0;\n}\n';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  sessionsFile = m97;
  act(() => update(p => { delete p.settings.platform; }));
  stageMock.mockReset();
  stageMock.mockResolvedValue({ ok: true, text: 'expanded by the preprocessor', diagnostics: [], raw: '', ms: 1 });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (props: { code: string; stages?: string; session?: string }) => act(() => root.render(createElement(PipelineExplorer, props)));
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const labels = () => tabs().map(t => t.textContent);
const tablist = (label: string) => host.querySelector<HTMLElement>(`[role="tablist"][aria-label="${label}"]`)!;
const click = async (el: Element) => { await act(async () => { (el as HTMLButtonElement).click(); }); };
const key = async (k: string) => { await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };

describe('<PipelineExplorer> tabs', () => {
  it('renders exactly the three lesson-1.1 tabs without a stages prop', () => {
    render({ code });
    expect(labels()).toEqual(['1. Your source', '2. After the preprocessor', '3. Assembly (WebAssembly)']);
  });

  it('adds the object, nm and link tabs when the MDX asks for them, in the author’s order', () => {
    render({ code, stages: 'source,E,S,objdump-t,objdump-d,nm,link' });
    expect(labels()).toEqual([
      '1. Your source', '2. After the preprocessor', '3. Assembly (WebAssembly)',
      '4. Object file: symbols', '5. Object file: instructions', '6. nm: defined and undefined', '7. Link',
    ]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('1. Your source');
  });

  it('numbers the tabs by their position on screen, not by the stage name', () => {
    render({ code, stages: 'E,no-such-tab,source,nm' });
    expect(labels()).toEqual(['1. Your source', '2. After the preprocessor', '3. nm: defined and undefined']);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('1. Your source');
  });

  it('follows the tab pattern: one tab stop, arrow keys move selection and focus, Home and End jump', async () => {
    render({ code, stages: 'source,E,S,nm' });
    expect(tabs().map(t => t.tabIndex)).toEqual([0, -1, -1, -1]);
    tabs()[0].focus();
    await key('ArrowRight');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs().map(t => t.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(stageMock).toHaveBeenCalledWith({ 'main.c': code }, 'E');
    await key('End');
    expect(document.activeElement).toBe(tabs()[3]);
    await key('Home');
    expect(document.activeElement).toBe(tabs()[0]);
    await key('ArrowLeft'); // wraps to the last tab
    expect(document.activeElement).toBe(tabs()[3]);
    // Arrows follow the focused tab, not the selected one (focus-relative, as the pattern expects).
    tabs()[1].focus();
    await key('ArrowRight');
    expect(document.activeElement).toBe(tabs()[2]);
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    const panel = host.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[2].id);
  });

  it('makes the output scroll box a named, focusable region', async () => {
    render({ code, stages: 'source,E' });
    const sourceBox = host.querySelector('[role="region"]')!;
    expect(sourceBox.getAttribute('aria-label')).toBe('1. Your source output');
    expect(sourceBox.getAttribute('tabindex')).toBe('0');
    await click(tabs()[1]);
    const box = host.querySelector('[role="region"]')!;
    expect(box.getAttribute('aria-label')).toBe('2. After the preprocessor output');
    expect(box.textContent).toContain('expanded by the preprocessor');
  });
});

describe('<PipelineExplorer> reporting', () => {
  it('prints a failed link once, in Linker messages, not again as a listing', async () => {
    const message = 'wasm-ld: error: <tmp1>: undefined symbol: f\n';
    stageMock.mockResolvedValueOnce({ ok: false, text: message, diagnostics: [], raw: message, ms: 1 });
    render({ code, stages: 'source,link' });
    await click(tabs()[1]);
    expect((host.textContent!.match(/undefined symbol: f/g) ?? []).length).toBe(1);
    expect(host.textContent).toContain('Linker messages');
    expect(host.querySelector('[role="region"]')).toBeNull();
  });

  it('says "1 line" for a one-line stage and "3 lines" for three', () => {
    render({ code: 'int main(void) { return 0; }', stages: 'source' });
    expect(host.textContent).toContain('1 line.');
    expect(host.textContent).not.toContain('1 lines.');
    render({ code, stages: 'source' });
    expect(host.textContent).toContain('3 lines.');
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

  it('switches the native view and the platform from the tab buttons', async () => {
    render({ code: SOURCE, session: 'pipeline' });
    await click(tabs().find(t => t.textContent === 'nm')!);
    expect(host.querySelector('[aria-label="nm for Linux/WSL · gcc 13"]')!.textContent).toContain('T main');
    expect(host.querySelector('[aria-label="Source lines"]')).toBeNull(); // nm has no line info
    await click([...tablist('Platform for this stored run').querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(t => t.textContent!.includes('clang'))!);
    expect(host.querySelector('[aria-label="nm for Linux/WSL · clang 22"]')!.textContent).toContain('T main');
    await click(tabs().find(t => t.textContent === 'objdump -d -l')!);
    expect(host.querySelector('[aria-label="objdump -d -l for Linux/WSL · clang 22"]')!.textContent).toContain('Disassembly of section .text:');
  });

  it('highlights a source line’s instructions, and selects the source line of an instruction', async () => {
    render({ code: SOURCE, session: 'pipeline' });
    await click(host.querySelector('button[aria-label^="Source line 8:"]')!);
    const pressed = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Text line"][aria-pressed="true"]')].map(b => b.getAttribute('aria-label')!);
    expect(pressed.some(l => l.includes('$5,'))).toBe(true);
    expect(pressed.some(l => l.includes('call\tsquare'))).toBe(false);

    const call = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Text line"]')].find(b => b.getAttribute('aria-label')!.includes('call\tsquare'))!;
    await click(call);
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

  it('shows the compile command above the assembly, not the cleanup step', () => {
    render({ code: SOURCE, session: 'pipeline' });
    const pane = host.querySelector('[data-native="pipeline"]')!;
    expect(pane.textContent).toContain('-S main.c');
    expect(pane.textContent).not.toContain('sed');
  });

  it('shows stderr once when stdout is empty, with the exit status', () => {
    const stderrOnly = {
      id: 'stderr-only', dir: 'sessions/stderr-only', hash: '0', platforms: ['linux-gcc'],
      sources: { 'main.c': SOURCE },
      runs: { 'linux-gcc': [{ cmd: 'cc x.c', as: 'asm', stdout: '', stderr: 'warning: only stderr here\n', exit: 1 }] },
    } satisfies SessionResult;
    sessionsFile = { ...m97, sessions: { ...m97.sessions, 'stderr-only': stderrOnly } };
    render({ code: SOURCE, session: 'stderr-only' });
    expect((host.textContent!.match(/warning: only stderr here/g) ?? []).length).toBe(1);
    expect(host.textContent).toContain('Exit status 1.');
  });

  it('gives both native tablists the tab pattern (one tab stop, arrow keys move selection and focus)', async () => {
    render({ code: SOURCE, session: 'pipeline' });
    const views = [...tablist('Native view').querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(views.map(t => t.tabIndex)).toEqual([0, -1, -1]);
    views[0].focus();
    await key('ArrowRight');
    expect(document.activeElement).toBe(views[1]);
    expect(views[1].getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector(`[role="tabpanel"][aria-labelledby="${views[1].id}"]`)).not.toBeNull();
    const platforms = [...tablist('Platform for this stored run').querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(platforms.map(t => t.tabIndex)).toEqual([0, -1]);
    platforms[0].focus();
    await key('ArrowRight');
    expect(document.activeElement).toBe(platforms[1]);
    expect(platforms[1].getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector(`[role="tabpanel"][aria-labelledby="${platforms[1].id}"]`)).not.toBeNull();
    // Arrows are focus-relative: focus a non-selected view tab, then move from there.
    views[0].focus();
    await key('ArrowRight');
    expect(document.activeElement).toBe(views[1]);
    expect(views[1].getAttribute('aria-selected')).toBe('true');
    platforms[0].focus();
    await key('ArrowRight');
    expect(document.activeElement).toBe(platforms[1]);
    expect(platforms[1].getAttribute('aria-selected')).toBe('true');
  });

  it('uses one tab stop per listing and arrows + Enter to select a line', async () => {
    render({ code: SOURCE, session: 'pipeline' });
    const output = host.querySelector<HTMLElement>('[aria-label="Assembly (-S -g) for Linux/WSL · gcc 13"]')!;
    const source = host.querySelector<HTMLElement>('[aria-label="Source lines"]')!;
    expect(output.tabIndex).toBe(0);
    expect(source.tabIndex).toBe(0);
    expect(host.querySelectorAll('button[data-line][tabindex="0"]').length).toBe(0);
    output.focus();
    await key('ArrowDown');
    const first = document.activeElement as HTMLButtonElement;
    expect(first.tagName).toBe('BUTTON');
    expect(first.getAttribute('aria-label')).toMatch(/^Text line \d+ \(source line \d+\):/);
    await key('ArrowDown');
    const second = document.activeElement as HTMLButtonElement;
    expect(second).not.toBe(first);
    const line = Number(/source line (\d+)/.exec(second.getAttribute('aria-label')!)![1]);
    await act(async () => { second.click(); });
    expect(host.querySelector(`button[aria-label^="Source line ${line}:"]`)!.getAttribute('aria-pressed')).toBe('true');
    source.focus();
    await key('ArrowDown');
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toMatch(/^Source line 1:/);
  });

  it('announces the highlighted count and scrolls the first instruction inside the listing', async () => {
    render({ code: SOURCE, session: 'pipeline' });
    const output = host.querySelector<HTMLElement>('[aria-label="Assembly (-S -g) for Linux/WSL · gcc 13"]')!;
    const firstMapped = [...output.querySelectorAll<HTMLButtonElement>('button[data-line]')].find(b => b.getAttribute('aria-label')!.includes('(source line 8)'))!;
    output.getBoundingClientRect = () => ({ top: 100, bottom: 300 } as DOMRect);
    firstMapped.getBoundingClientRect = () => ({ top: 320, bottom: 340 } as DOMRect);
    await click(host.querySelector('button[aria-label^="Source line 8:"]')!);
    const pressed = host.querySelectorAll('button[aria-label^="Text line"][aria-pressed="true"]').length;
    expect(host.querySelector('[data-announce]')!.textContent).toBe(`Line 8: ${pressed} assembly line${pressed === 1 ? '' : 's'} highlighted.`);
    expect(pressed).toBeGreaterThan(0);
    expect(output.scrollTop).toBe(44); // 340 - 300 + 4
    expect(window.scrollY).toBe(0);
  });

  it('puts the missing-platform note before the panes', () => {
    render({ code: SOURCE, session: 'pipeline' });
    const pending = host.querySelector('[data-pending]')!;
    const listing = host.querySelector('[aria-label="Assembly (-S -g) for Linux/WSL · gcc 13"]')!;
    expect(pending.compareDocumentPosition(listing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the whole stored nm output, from the fixture’s own lines', async () => {
    render({ code: SOURCE, session: 'pipeline' });
    await click(tabs().find(t => t.textContent === 'nm')!);
    const pane = host.querySelector('[aria-label="nm for Linux/WSL · gcc 13"]')!;
    const stored = m97.sessions.pipeline.runs['linux-gcc']![3].stdout.trimEnd().split('\n');
    expect(pane.querySelectorAll('li')).toHaveLength(stored.length);
    for (const line of stored) expect(pane.textContent).toContain(line);
  });

  it('picks the stored pane that matches the my-machine setting', () => {
    const both = {
      id: 'both', dir: 'sessions/both', hash: '0', platforms: ['linux-gcc', 'macos'],
      sources: { 'main.c': SOURCE },
      runs: { 'linux-gcc': m97.sessions.pipeline.runs['linux-gcc'], macos: m97.sessions.pipeline.runs['linux-gcc'] },
    } satisfies SessionResult;
    sessionsFile = { ...m97, sessions: { ...m97.sessions, both } };
    act(() => update(p => { p.settings.platform = 'mac-arm'; }));
    render({ code: SOURCE, session: 'both' });
    const selected = () => [...tablist('Platform for this stored run').querySelectorAll('[role="tab"]')].find(t => t.getAttribute('aria-selected') === 'true')!.textContent;
    expect(selected()).toBe('macOS · Apple clang');
    expect(host.querySelector('[aria-label="Assembly (-S -g) for macOS · Apple clang"]')).not.toBeNull();
    act(() => update(p => { p.settings.platform = 'linux-x86'; }));
    expect(selected()).toBe('Linux/WSL · gcc 13');
  });
});
