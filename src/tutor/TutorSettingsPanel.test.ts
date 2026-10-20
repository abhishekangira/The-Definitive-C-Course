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
    // The form saves on blur, like a learner tabbing away.
    act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  }
  const radio = (label: RegExp) => [...host.querySelectorAll('label')].find(l => label.test(l.textContent ?? ''))!.querySelector('input') as HTMLInputElement;
  const chooseOwnModel = (id: string) => {
    act(() => { radio(/My own model id/).click(); });
    type('tutor-model', id);
  };
  const stored = () => JSON.parse(localStorage.getItem(TUTOR_STORAGE_KEY) ?? '{}') as { apiKey?: string; model?: string; consentedHost?: string };

  it('does not fetch before consent, fetches after the host is accepted, and Remove key clears the key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'bananas' } }] }));
    vi.stubGlobal('fetch', fetchImpl);
    render();
    type('tutor-key', KEY);
    type('tutor-base', 'https://tutor.test/v1');
    chooseOwnModel('test-model');

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
    await act(async () => { button(/Test connection/)!.click(); });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('That URL is not allowed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('starts on the course default for OpenRouter, and stores an empty model for it', () => {
    render();
    expect(radio(/Course default/).checked).toBe(true);
    expect(radio(/Course default/).disabled).toBe(false);
    expect(radio(/My own model id/).checked).toBe(false);
    expect(host.querySelector('#tutor-model'), 'no model box while the default is chosen').toBeNull();
    type('tutor-key', KEY);
    expect(stored().model).toBe('');
  });

  it('shows the model box with suggestions for "My own model id", saves the id, and can go back to the default', () => {
    render();
    type('tutor-key', KEY);
    act(() => { radio(/My own model id/).click(); });
    expect(host.querySelector('[role="alert"]'), 'no error before the learner has typed a model id').toBeNull();
    const input = host.querySelector('#tutor-model') as HTMLInputElement;
    expect(input.getAttribute('list')).toBe('tutor-model-suggestions');
    expect([...host.querySelectorAll('#tutor-model-suggestions option')].map(o => (o as HTMLOptionElement).value)).toContain('openai/gpt-oss-120b');
    type('tutor-model', 'openai/gpt-4o-mini');
    expect(stored().model).toBe('openai/gpt-4o-mini');
    expect(stored().apiKey).toBe(KEY);
    act(() => { radio(/Course default/).click(); });
    expect(stored().model).toBe('');
    expect(host.querySelector('#tutor-model')).toBeNull();
  });

  it('offers the course default only on OpenRouter, and asks for a model id on any other host', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchImpl);
    render();
    type('tutor-key', KEY);
    type('tutor-base', 'https://api.openai.com/v1');
    expect(radio(/Course default/).disabled).toBe(true);
    expect(radio(/My own model id/).checked).toBe(true);
    expect(host.textContent).toContain('It needs the OpenRouter base URL');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Type a model id');
    await act(async () => { button(/Test connection/)!.click(); });
    await flush();
    expect(fetchImpl, 'no model chosen: nothing is sent').not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('The first request sends your API key');
  });

  it('says what is really stored when a model id is rejected, never that the tutor is off when it is not', () => {
    render();
    type('tutor-key', KEY);
    chooseOwnModel('openai/gpt-4o-mini');
    type('tutor-model', 'two words');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('The previous model id (openai/gpt-4o-mini) is still used');
    expect(stored().model).toBe('openai/gpt-4o-mini');
    type('tutor-model', '');
    expect(stored().model, 'clearing the box does not switch to the course default').toBe('openai/gpt-4o-mini');
    act(() => { radio(/Course default/).click(); });
    act(() => { radio(/My own model id/).click(); });
    type('tutor-model', 'two words');
    expect(host.querySelector('[role="alert"]')?.textContent, 'the default is stored now, and the message says so').toContain('the course default models are used');
  });

  it('keeps the course default available while the URL is a typo that cannot be saved', () => {
    render();
    type('tutor-key', KEY);
    type('tutor-base', 'htp:/openrouter');
    expect(radio(/Course default/).disabled).toBe(false);
    expect(radio(/Course default/).checked).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('That URL is not allowed');
  });

  it('starts the form again from the store when another tab changes the settings, so a stale blur cannot undo Remove key', () => {
    render();
    type('tutor-key', KEY);
    expect(stored().apiKey).toBe(KEY);
    // Another tab clicked Remove key.
    const removed = JSON.stringify({ version: 1, apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', model: '', consentedHost: '', lessonConsentedHost: '' });
    localStorage.setItem(TUTOR_STORAGE_KEY, removed);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: TUTOR_STORAGE_KEY, newValue: removed })); });
    expect((host.querySelector('#tutor-key') as HTMLInputElement).value).toBe('');
    const base = host.querySelector('#tutor-base') as HTMLInputElement;
    act(() => { base.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(stored().apiKey, 'blurring a field in this tab does not bring the removed key back').toBe('');
  });

  it('Test connection sends the course default body to OpenRouter and a plain body for a chosen model', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }));
    render();
    type('tutor-key', KEY);
    await act(async () => { button(/Test connection/)!.click(); });
    await act(async () => { button(/Send to openrouter\.ai/)!.click(); });
    await flush();
    expect(Object.keys(bodies[0]).sort()).toEqual(['max_tokens', 'messages', 'models', 'provider']);

    chooseOwnModel('openai/gpt-4o-mini');
    await act(async () => { button(/Test connection/)!.click(); });
    await flush();
    expect(Object.keys(bodies[1]).sort()).toEqual(['max_tokens', 'messages', 'model']);
    expect(bodies[1].model).toBe('openai/gpt-4o-mini');
  });
});
