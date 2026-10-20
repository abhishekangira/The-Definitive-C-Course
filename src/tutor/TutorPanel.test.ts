// @vitest-environment jsdom
// The reply is untrusted. This mounts the real panel and fails if the model text is parsed as HTML.
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyTutorSettings, replaceTutorSettings } from './settings';
import { TutorPanel } from './TutorPanel';
import realReplies from './fixtures/real-replies.json';

const consentGate = vi.hoisted(() => ({ covers: true }));

vi.mock('./settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./settings')>();
  return {
    ...actual,
    consentCovers: (s: Parameters<typeof actual.consentCovers>[0]) => consentGate.covers && actual.consentCovers(s),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'sk-panel-secret';

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

const baseProps = {
  title: 'hello, world',
  statement: 'Print hello, world and a newline.',
  hints: ['Open stdio.h.', 'A newline is \\n.', 'printf("hello, world\\n");'],
  hintsViewed: 0,
  solution: '#include <stdio.h>\nint main(void) {\n    printf("hello, world\\n");\n    return 0;\n}\n',
  checkedCode: 'int main(void) {\n    return 0;\n}\n',
  currentCode: 'int main(void) {\n    return 0;\n}\n',
  results: [{ status: 'fail', name: 'prints hello', expected: 'hello, world\n', actual: '', message: 'wrong output' }],
  diagnostics: '',
  onAsked: () => {},
};

describe('TutorPanel renders model output as text', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: 'tutor.test', lessonConsentedHost: '' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    replaceTutorSettings(emptyTutorSettings());
    consentGate.covers = true;
  });

  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); });
  const button = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? ''))!;

  it('shows a script and an img payload as text, not as elements', async () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    vi.stubGlobal('fetch', vi.fn(async () => reply(payload)));
    act(() => { root.render(createElement(TutorPanel, baseProps)); });
    await act(async () => { button(/Give me a nudge/).click(); });
    await flush();
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.textContent).not.toContain(KEY);
  });

  it('replaces a reply that contains a solution line the learner does not have', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('printf("hello, world\\n");')));
    let asks = 0;
    act(() => { root.render(createElement(TutorPanel, { ...baseProps, onAsked: () => { asks += 1; } })); });
    await act(async () => { button(/Give me a nudge/).click(); });
    await flush();
    expect(host.textContent).toContain("I can't show that reply");
    expect(host.textContent).toContain('Open hint 1');
    expect(host.textContent).not.toContain('printf("hello, world\\n")');
    expect(asks).toBe(1);
  });

  it('does not count a 401, and says the key was rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: KEY }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    let asks = 0;
    act(() => { root.render(createElement(TutorPanel, { ...baseProps, onAsked: () => { asks += 1; } })); });
    await act(async () => { button(/Give me a nudge/).click(); });
    await flush();
    expect(host.textContent).toContain('rejected (401)');
    expect(host.textContent).not.toContain(KEY);
    expect(asks).toBe(0);
  });

  it('does not send when ask() sees consent that no longer covers the host', async () => {
    const fetchImpl = vi.fn(async () => reply('a hint'));
    vi.stubGlobal('fetch', fetchImpl);
    act(() => { root.render(createElement(TutorPanel, baseProps)); });
    const nudge = button(/Give me a nudge/);
    expect(nudge).toBeTruthy();
    consentGate.covers = false;
    await act(async () => { nudge.click(); });
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('a hint');
  });

  it('disables both Ask buttons while a request is in flight', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => gate));
    act(() => { root.render(createElement(TutorPanel, baseProps)); });
    const askButtons = () => [...host.querySelectorAll('[data-tutor="ask"] button')];
    expect(askButtons().map(b => (b as HTMLButtonElement).disabled)).toEqual([false, false]);
    await act(async () => { button(/Give me a nudge/).click(); });
    expect(askButtons().map(b => (b as HTMLButtonElement).disabled)).toEqual([true, true]);
    expect(askButtons().every(b => b.textContent === 'Asking…')).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[data-tutor-reply]'));
    await act(async () => { release(reply('try a newline')); });
    await flush();
    expect(askButtons().map(b => (b as HTMLButtonElement).disabled)).toEqual([false, false]);
    expect(host.textContent).toContain('try a newline');
  });

  it('clears the reply when a new check replaces the results it was about, and keeps it across other re-renders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('look at the return value')));
    act(() => { root.render(createElement(TutorPanel, baseProps)); });
    await act(async () => { button(/Give me a nudge/).click(); });
    await flush();
    expect(host.textContent).toContain('look at the return value');
    act(() => { root.render(createElement(TutorPanel, { ...baseProps, currentCode: 'int main(void) { return 1; }' })); });
    expect(host.textContent).toContain('look at the return value');
    act(() => { root.render(createElement(TutorPanel, { ...baseProps, results: [{ ...baseProps.results[0], actual: 'hello' }] })); });
    expect(host.textContent).not.toContain('look at the return value');
  });

  it('drops an answer that arrives after a newer check, without counting it', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => gate));
    let asks = 0;
    const props = { ...baseProps, onAsked: () => { asks += 1; } };
    act(() => { root.render(createElement(TutorPanel, props)); });
    await act(async () => { button(/Give me a nudge/).click(); });
    act(() => { root.render(createElement(TutorPanel, { ...props, results: [{ ...baseProps.results[0], actual: 'hello' }] })); });
    expect((button(/Give me a nudge/) as HTMLButtonElement).disabled, 'the new check does not wait for the abandoned request').toBe(false);
    await act(async () => { release(reply('answer about the old check')); });
    await flush();
    expect(host.textContent).not.toContain('answer about the old check');
    expect(asks).toBe(0);
    expect((button(/Give me a nudge/) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a real reply that names lines of a Parsons bank, and refuses the same reply without the bank', async () => {
    const c = realReplies.cases.find(x => x.exercise === 'countdown-order')!;
    vi.stubGlobal('fetch', vi.fn(async () => reply(c.reply)));
    const props = {
      ...baseProps, statement: c.statement, solution: c.solution, checkedCode: c.learnerCode, currentCode: c.learnerCode,
      results: c.results, hints: [], hintsViewed: 0,
    };
    act(() => { root.render(createElement(TutorPanel, { ...props, bank: c.bank })); });
    await act(async () => { button(/Give me a nudge/).click(); });
    await flush();
    expect(host.textContent).toContain('Have you placed that');
    expect(host.textContent).not.toContain("I can't show that reply");

    act(() => { root.unmount(); });
    root = createRoot(host);
    act(() => { root.render(createElement(TutorPanel, props)); });
    await act(async () => { button(/Give me a nudge/).click(); });
    await flush();
    expect(host.textContent).toContain("I can't show that reply");
  });

  it('does not count or show an answer that arrives after the exercise went away', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => gate));
    let asks = 0;
    act(() => { root.render(createElement(TutorPanel, { ...baseProps, onAsked: () => { asks += 1; } })); });
    await act(async () => { button(/Give me a nudge/).click(); });
    act(() => { root.unmount(); });
    await act(async () => { release(reply('too late')); });
    await flush();
    expect(asks).toBe(0);
    root = createRoot(host);
  });

  it('says to choose a model, with a link to Settings, instead of offering Ask, when no model can be used', () => {
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: '', consentedHost: 'tutor.test', lessonConsentedHost: '' });
    act(() => { root.render(createElement(TutorPanel, baseProps)); });
    expect(host.textContent).toContain('Choose a model in Settings');
    expect(host.querySelector('a[href="#/settings"]')).not.toBeNull();
    expect(button(/Give me a nudge/)).toBeUndefined();
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: '', consentedHost: '', lessonConsentedHost: '' });
    expect(host.textContent, 'no consent notice for a request that cannot be made').not.toContain('The first request sends your API key');
  });

  it('moves focus to the nudge after accept and to the refusal after decline', () => {
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: '', lessonConsentedHost: '' });
    act(() => { root.render(createElement(TutorPanel, baseProps)); });
    act(() => { button(/Don't send/).click(); });
    const refused = [...host.querySelectorAll('p')].find(p => p.textContent?.includes('Nothing was sent.'));
    expect(document.activeElement).toBe(refused);
    act(() => { button(/Show the permission notice/).click(); });
    act(() => { button(/Send to tutor\.test/).click(); });
    expect(document.activeElement).toBe(button(/Give me a nudge/));
  });
});
