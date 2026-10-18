// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorSettingsPanel } from './TutorSettingsPanel';
import { TUTOR_STORAGE_KEY, emptyTutorSettings, replaceTutorSettings } from './settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'sk-test-super-secret-value';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('TutorSettingsPanel', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    replaceTutorSettings(emptyTutorSettings());
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

  const render = () => act(() => { root.render(createElement(TutorSettingsPanel)); });
  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); });
  const button = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? ''));
  function type(id: string, value: string) {
    const input = host.querySelector(`#${id}`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  it('does not fetch before consent, fetches after the host is accepted, and Remove key clears the key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'bananas' } }] }));
    vi.stubGlobal('fetch', fetchImpl);
    render();
    type('tutor-key', KEY);
    type('tutor-base', 'https://tutor.test/v1');
    type('tutor-model', 'test-model');

    await act(async () => { button(/Test connection/)!.click(); });
    await flush();
    expect(fetchImpl, 'Test connection waits for consent').not.toHaveBeenCalled();
    expect(host.textContent).toContain('The first request sends your API key to tutor.test');
    expect(host.textContent).not.toContain(KEY);

    await act(async () => { button(/Don't send/)!.click(); });
    await flush();
    expect(fetchImpl, 'declining sends nothing').not.toHaveBeenCalled();
    expect(host.textContent).toContain('Nothing was sent.');
    expect(document.activeElement?.textContent).toContain('Nothing was sent.');

    await act(async () => { button(/Test connection/)!.click(); });
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    await act(async () => { button(/Send to tutor\.test/)!.click(); });
    await flush();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://tutor.test/v1/chat/completions');
    expect(String(init.body)).not.toContain(KEY);
    expect(host.textContent).toContain('Connected. The key works.');
    expect(document.activeElement?.textContent).toContain('Connected. The key works.');
    expect(host.textContent, 'the model reply is not shown').not.toContain('bananas');
    expect(host.textContent).not.toContain(KEY);

    await act(async () => { button(/Remove key/)!.click(); });
    const stored = JSON.parse(localStorage.getItem(TUTOR_STORAGE_KEY) ?? '{}') as { apiKey: string; consentedHost: string };
    expect(stored.apiKey).toBe('');
    expect(stored.consentedHost).toBe('');
    expect(JSON.stringify(stored)).not.toContain(KEY);
  });

  it('keeps the API key field as a password with autocomplete off', () => {
    render();
    const input = host.querySelector('#tutor-key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
  });

  it('announces a rejected URL in an alert', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'nope' } }] }));
    vi.stubGlobal('fetch', fetchImpl);
    render();
    type('tutor-key', KEY);
    type('tutor-base', 'http://localhost.evil.com/v1');
    type('tutor-model', 'test-model');
    await act(async () => { button(/Test connection/)!.click(); });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('That URL is not allowed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});