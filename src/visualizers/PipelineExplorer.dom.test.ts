// @vitest-environment jsdom
// The V7 tab set and its keyboard/reporting behaviour: lesson 1.1's <PipelineExplorer> with no props stays exactly the
// three tabs it shipped with, `stages` adds the live views, the stage tabs follow the tab pattern (arrow keys, roving
// tabindex), the scroll box is focusable, a failed link is printed once, and the line count pluralises.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stageMock } = vi.hoisted(() => ({ stageMock: vi.fn() }));
vi.mock('../runtime/CRuntime', () => ({
  getRuntime: () => ({ stage: stageMock, state: { status: 'ready', ms: 0, fromCache: true }, subscribe: () => () => {} }),
}));
import { PipelineExplorer } from './PipelineExplorer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  stageMock.mockReset();
  stageMock.mockResolvedValue({ ok: true, text: 'expanded by the preprocessor', diagnostics: [], raw: '', ms: 1 });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const code = 'int main(void) {\n    return 0;\n}\n';
const render = (props: { code: string; stages?: string }) => act(() => root.render(createElement(PipelineExplorer, props)));
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const labels = () => tabs().map(t => t.textContent);
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
    const panel = host.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[3].id);
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

  it('says "1 line" for a one-line stage and "2 lines" for two', async () => {
    render({ code: 'int main(void) { return 0; }', stages: 'source' });
    expect(host.textContent).toContain('1 line.');
    expect(host.textContent).not.toContain('1 lines.');
    render({ code, stages: 'source' });
    expect(host.textContent).toContain('3 lines.');
  });
});
