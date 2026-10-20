// @vitest-environment jsdom
// The lesson chat, mounted for real (react-dom + jsdom) with a provider that streams. What it must do: send the lesson
// and the whole conversation every time, show the reply as it arrives, keep the learner in control (Stop, New chat),
// stay quiet until they agree, and render model text as text.
import { createElement, createRef, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyTutorSettings, replaceTutorSettings } from './settings';
import { LessonChat, type LessonChatHandle } from './LessonChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'sk-lesson-chat-secret';
const enc = new TextEncoder();
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

/** A response the test feeds by hand, so it can look at the page between two chunks. */
function live() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (text: string) => controller.enqueue(enc.encode(text)),
    end: () => { controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close(); },
  };
}
const whole = (text: string) => new Response(delta(text) + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

interface Sent { messages: { role: string; content: string }[]; stream?: boolean; model?: string }

describe('LessonChat', () => {
  let host: HTMLDivElement;
  let root: Root;
  let lesson = '--- Part 1 of 4 ---\nA C program is compiled first.';
  const handle = createRef<LessonChatHandle>();
  const sent: Sent[] = [];

  beforeEach(() => {
    localStorage.clear();
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: 'tutor.test' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    sent.length = 0;
    lesson = '--- Part 1 of 4 ---\nA C program is compiled first.';
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    replaceTutorSettings(emptyTutorSettings());
  });

  const stubFetch = (...responses: Array<Response | (() => Response)>) => {
    const queue = [...responses];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Sent);
      const next = queue.shift();
      if (!next) throw new Error('unexpected extra request');
      return typeof next === 'function' ? next() : next;
    }));
  };
  const mount = (props: Partial<Parameters<typeof LessonChat>[0]> = {}) => act(() => {
    root.render(createElement(LessonChat, {
      ref: handle, open: true, onClose: () => {}, title: 'Hello, compiled world', moduleLabel: 'Module 1', readLesson: () => lesson, ...props,
    }));
  });
  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); });
  const button = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? b.getAttribute('aria-label') ?? '') || name.test(b.getAttribute('aria-label') ?? ''))!;
  const log = () => host.querySelector('[data-tutor="log"]')!.textContent ?? '';
  const box = () => host.querySelector('textarea')!;
  function type(text: string) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box(), text);
    act(() => { box().dispatchEvent(new Event('input', { bubbles: true })); });
  }
  const press = (key: string, init: KeyboardEventInit = {}) => act(() => { box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });

  it('Explain sends at once: the lesson, the passage and "Explain this.", as a streaming request', async () => {
    const feed = live();
    stubFetch(feed.response);
    mount();
    await act(async () => { handle.current!.ask('explain', 'return 0;'); });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].stream).toBe(true);
    expect(sent[0].messages.map(m => m.role)).toEqual(['system', 'user']);
    expect(sent[0].messages[0].content).toContain('A C program is compiled first.');
    expect(sent[0].messages[1].content).toContain('return 0;');
    expect(sent[0].messages[1].content).toContain('Explain this.');
    expect(JSON.stringify(sent[0])).not.toContain(KEY);

    await act(async () => { feed.push(delta('It ends ')); });
    await flush();
    expect(log()).toContain('It ends');
    expect(log()).not.toContain('the program');
    expect(button(/Stop/), 'while it streams there is a Stop').toBeTruthy();
    await act(async () => { feed.push(delta('the program.')); feed.end(); });
    await flush();
    expect(log()).toContain('It ends the program.');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('The tutor has answered.');
    expect(button(/Send/), 'Send is back').toBeTruthy();
  });

  it('every question carries the whole conversation and the lesson as it is now', async () => {
    stubFetch(whole('First answer.'), whole('Second answer.'));
    mount();
    await act(async () => { handle.current!.ask('explain', 'compiled first'); });
    await flush();
    lesson = '--- Part 1 of 4 ---\nA C program is compiled first.\n\n--- Part 2 of 4 ---\nThen it runs.';
    type('and then?');
    press('Enter');
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1].messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(sent[1].messages[1]).toEqual(sent[0].messages[1]);
    expect(sent[1].messages[2].content).toBe('First answer.');
    expect(sent[1].messages[3].content).toBe('and then?');
    expect(sent[1].messages[0].content, 'the lesson is read again for every request').toContain('Then it runs.');
    expect(sent[0].messages[0].content).not.toContain('Then it runs.');
    expect(log()).toContain('Second answer.');
  });

  it('Reply quotes the passage above the box and sends nothing until the learner asks', async () => {
    stubFetch(whole('Because the quote is attached.'));
    mount();
    await act(async () => { handle.current!.ask('reply', 'int main(void)'); });
    await flush();
    expect(sent).toHaveLength(0);
    expect(host.textContent).toContain('Replying to');
    expect(host.textContent).toContain('int main(void)');
    type('why void?');
    press('Enter', { shiftKey: true });
    expect(sent, 'Shift+Enter is a new line').toHaveLength(0);
    press('Enter');
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].messages[1].content).toContain('int main(void)');
    expect(sent[0].messages[1].content).toContain('why void?');
    expect(host.textContent, 'the chip is spent').not.toContain('Replying to');
    expect(log()).toContain('why void?');
  });

  it('the learner can remove the quoted text before asking', async () => {
    stubFetch(whole('ok'));
    mount();
    await act(async () => { handle.current!.ask('reply', 'int main(void)'); });
    act(() => { button(/Remove the quoted text/).click(); });
    expect(host.textContent).not.toContain('Replying to');
    type('hello');
    press('Enter');
    await flush();
    expect(sent[0].messages[1].content).toBe('hello');
  });

  it('Stop ends the answer and keeps what arrived; a late chunk does not come back', async () => {
    const feed = live();
    stubFetch(feed.response);
    mount();
    await act(async () => { handle.current!.ask('explain', 'x'); });
    await act(async () => { feed.push(delta('Partial answer')); });
    await flush();
    await act(async () => { button(/Stop/).click(); });
    await flush();
    expect(log()).toContain('Partial answer');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Stopped.');
    expect(button(/Send/)).toBeTruthy();
    await act(async () => { try { feed.push(delta(' and more')); } catch { /* the stream is already closed */ } });
    await flush();
    expect(log()).not.toContain('and more');
  });

  it('New chat clears the conversation and drops an answer that is still coming', async () => {
    const feed = live();
    stubFetch(feed.response, whole('Fresh answer.'));
    mount();
    await act(async () => { handle.current!.ask('explain', 'old passage'); });
    await act(async () => { feed.push(delta('Old answer')); });
    await flush();
    await act(async () => { button(/New chat/).click(); });
    await flush();
    expect(log()).not.toContain('Old answer');
    expect(log()).not.toContain('old passage');
    type('new question');
    press('Enter');
    await flush();
    expect(sent[1].messages.map(m => m.role), 'nothing of the old chat is sent').toEqual(['system', 'user']);
    expect(log()).toContain('Fresh answer.');
    expect(log()).not.toContain('Old answer');
  });

  it('shows model text as text, never as HTML', async () => {
    stubFetch(whole('<script>alert(1)</script><img src=x onerror=alert(1)>'));
    mount();
    await act(async () => { handle.current!.ask('explain', 'x'); });
    await flush();
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(log()).toContain('<script>alert(1)</script>');
  });

  it('names a failure without the key, and keeps the question', async () => {
    stubFetch(new Response(JSON.stringify({ error: KEY }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    mount();
    await act(async () => { handle.current!.ask('explain', 'x'); });
    await flush();
    expect(log()).toContain('rejected (401)');
    expect(log()).toContain('Explain this.');
    expect(host.textContent).not.toContain(KEY);
  });

  it('sends nothing until the learner agrees, then sends the Explain that was waiting', async () => {
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: '' });
    stubFetch(whole('Now it is allowed.'));
    mount();
    expect(host.textContent).toContain('The first request sends your API key to tutor.test.');
    expect(host.textContent).toContain('the text of the lesson parts you have reached');
    expect(host.querySelector('textarea'), 'no box before consent').toBeNull();
    await act(async () => { handle.current!.ask('explain', 'compiled first'); });
    await flush();
    expect(sent, 'asking does not send').toHaveLength(0);
    await act(async () => { button(/Send to tutor\.test/).click(); });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].messages[1].content).toContain('compiled first');
    expect(log()).toContain('Now it is allowed.');
  });

  it('declining sends nothing and drops what was waiting', async () => {
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: 'test-model', consentedHost: '' });
    stubFetch(whole('should not be asked'));
    mount();
    await act(async () => { handle.current!.ask('explain', 'x'); });
    await act(async () => { button(/Don't send/).click(); });
    await flush();
    expect(host.textContent).toContain('Nothing was sent.');
    await act(async () => { button(/Show the permission notice/).click(); });
    await act(async () => { button(/Send to tutor\.test/).click(); });
    await flush();
    expect(sent, 'the declined Explain is not sent later').toHaveLength(0);
  });

  it('says what is missing when there is no key, or no model off OpenRouter', () => {
    replaceTutorSettings(emptyTutorSettings());
    mount();
    expect(host.textContent).toContain('Add an API key');
    replaceTutorSettings({ apiKey: KEY, baseUrl: 'https://tutor.test/v1', model: '', consentedHost: 'tutor.test' });
    mount();
    expect(host.textContent).toContain('Choose a model');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('Escape asks to close, and a closed panel is hidden but keeps the conversation', async () => {
    stubFetch(whole('kept'));
    const onClose = vi.fn();
    mount({ onClose });
    await act(async () => { handle.current!.ask('explain', 'x'); });
    await flush();
    act(() => { box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalledOnce();
    mount({ open: false });
    expect(host.querySelector('aside')!.hasAttribute('hidden')).toBe(true);
    mount({ open: true });
    expect(log()).toContain('kept');
  });
});
