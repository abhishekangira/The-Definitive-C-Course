// @vitest-environment jsdom
// <Transcript> mounted for real (react-dom + jsdom) on tools/verify's output for the m97 fixture sessions: what it shows,
// what it says is missing, and the keyboard tab pattern. Only the lesson context is replaced, to hand it that file.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionsFile } from '../content-model/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
vi.mock('../lesson/LessonContext', () => ({ useSessions: () => m97 }));
const { Transcript } = await import('./Transcript');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (props: Parameters<typeof Transcript>[0]) => act(() => root.render(createElement(Transcript, props)));
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const panel = () => host.querySelector<HTMLElement>('[role="tabpanel"]')!;
const key = (k: string) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
const run = (id: string, p: 'linux-gcc' | 'linux-clang', i: number) => m97.sessions[id].runs[p]![i];

describe('<Transcript>', () => {
  it('shows the stored command, output and exit status, and says that no macOS run is stored', () => {
    render({ session: 'link-undefined', step: '2' });
    const s = run('link-undefined', 'linux-gcc', 1);
    expect(tabs().map(t => t.textContent)).toEqual(['Linux/WSL · gcc 13 · ld', 'Linux/WSL · clang 22 · ld']);
    expect(panel().textContent).toBe(`$ ${s.cmd}stderr${s.stderr}exit status ${s.exit}`);
    expect(host.querySelector('[data-missing]')!.textContent).toBe('No stored run for macOS · Apple clang.');
  });

  it('draws placeholders as placeholders and explains each kind it shows', () => {
    render({ session: 'lldb', step: 2 });
    const marked = [...panel().querySelectorAll('[data-placeholder]')].map(e => e.textContent);
    expect(marked).toContain('<addr1>');
    expect(marked).toContain('<pid>');
    expect(marked).toContain('<dir>');
    expect([...host.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['<addrN>', '<pid>, ==PID==', '<dir>']);
    expect(host.querySelector('[data-missing]')!.textContent).toBe('No stored run for Linux/WSL · gcc 13 or macOS · Apple clang.');
  });

  it('moves between platforms with the arrow keys, Home and End, focus following the selection', () => {
    render({ session: 'link-undefined', step: 2 });
    const [gcc, clang] = tabs();
    expect([gcc.tabIndex, clang.tabIndex]).toEqual([0, -1]);
    act(() => gcc.focus());
    key('ArrowRight');
    expect(clang.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(clang);
    expect([gcc.tabIndex, clang.tabIndex]).toEqual([-1, 0]);
    expect(panel().textContent).toContain(run('link-undefined', 'linux-clang', 1).stderr);
    expect(panel().getAttribute('aria-labelledby')).toBe(clang.id);
    key('ArrowRight'); // wraps
    expect(document.activeElement).toBe(gcc);
    key('End');
    expect(document.activeElement).toBe(clang);
    key('Home');
    expect(gcc.getAttribute('aria-selected')).toBe('true');
    key('ArrowLeft'); // wraps backwards
    expect(clang.getAttribute('aria-selected')).toBe('true');
    expect(panel().tabIndex).toBe(0); // the output scrolls, so it is reachable with Tab
  });

  it('puts a second session beside the first (gdb and lldb)', () => {
    render({ session: 'gdb', step: 2, beside: 'lldb', besideStep: 2 });
    expect([...host.querySelectorAll('figure')].map(f => f.getAttribute('data-transcript'))).toEqual(['gdb', 'lldb']);
    expect(tabs().map(t => t.textContent)).toEqual(['Linux/WSL · gcc 13 · gdb', 'Linux/WSL · clang 22 · lldb']);
  });

  it('says when a session or step is not stored instead of showing nothing', () => {
    render({ session: 'no-such-session' });
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/session no-such-session hasn't been generated/);
    render({ session: 'gdb', step: 99 });
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Session gdb stored no step 99.');
  });
});
