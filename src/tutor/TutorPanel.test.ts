// @vitest-environment jsdom
// The reply is untrusted. This mounts the real panel and fails if the model text is parsed as HTML.
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyTutorSettings, replaceTutorSettings } from './settings';
import { TutorPanel } from './TutorPanel';

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
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: 'tutor.test' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    replaceTutorSettings(emptyTutorSettings());
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
});
