// @vitest-environment jsdom
// LessonPage's load effect: it starts from nothing and ignores a load that finishes after the learner has moved to
// another lesson or module (a stale response). The loaders are replaced by promises the test resolves in any order;
// the lesson context is replaced by an element that shows which module's samples and sessions it was handed.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const pending = new Map<string, ReturnType<typeof deferred<unknown>>>();
const wait = (key: string) => { if (!pending.has(key)) pending.set(key, deferred()); return pending.get(key)!.promise; };
const resolve = async (key: string, value: unknown) => { await act(async () => { pending.get(key)!.resolve(value); await Promise.resolve(); }); };
const lessonModule = (text: string) => ({ default: () => createElement('p', { 'data-lesson': text }, text) });
const LESSONS = ['a', 'b'].map(stem => ({ stem, frontmatter: { id: `l-${stem}`, title: `Lesson ${stem}`, minutes: 5 } }));

vi.mock('../../content-runtime/course', () => ({
  moduleById: () => ({ meta: { number: 1 }, lessons: LESSONS }),
  lessonLoader: (m: string, stem: string) => () => wait(`lesson ${m}/${stem}`),
  samplesFor: (m: string) => wait(`samples ${m}`),
  sessionsFor: (m: string) => wait(`sessions ${m}`),
}));
vi.mock('../../content-runtime/mdx-components', () => ({ mdxComponents: {} }));
vi.mock('../../lesson/LessonContext', () => ({
  LessonProvider: ({ samples, sessions, children }: { samples: { module: string }; sessions: { module: string }; children: ReactNode }) =>
    createElement('div', { 'data-samples': samples.module, 'data-sessions': sessions.module }, children),
}));
vi.mock('../../progress/gating', () => ({ isModuleUnlocked: () => true, moduleStatus: () => ({ retrievalDone: true }) }));
vi.mock('../../progress/store', () => ({ useProgress: () => ({ settings: { storedOutputMode: true }, lessons: {} }) }));
vi.mock('../../components/CodeEditor', () => ({ preloadCodeEditor: () => {} }));
vi.mock('../../runtime/CRuntime', () => ({ getRuntime: () => ({ prefetch: () => {} }) }));
vi.mock('../../tutor/settings', () => ({ useTutorSettings: () => ({}) }));
vi.mock('../../tutor/LessonChat', () => ({ LESSON_CHAT_ID: 'chat', LessonChat: () => null }));
vi.mock('../../tutor/SelectionToolbar', () => ({ SelectionToolbar: () => null }));
const { LessonPage } = await import('./LessonPage');

let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(async () => {
  pending.clear();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  router = createMemoryRouter([{ path: '/m/:moduleId/:lessonStem', element: createElement(LessonPage) }], { initialEntries: ['/m/m1/a'] });
  await act(async () => root.render(createElement(RouterProvider, { router })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const go = (to: string) => act(async () => { await router.navigate(to); });
const shown = () => host.querySelector('[data-lesson]')?.textContent;
const data = () => { const d = host.querySelector('[data-samples]'); return d && [d.getAttribute('data-samples'), d.getAttribute('data-sessions')]; };

describe('LessonPage loads', () => {
  it('a lesson that finishes loading after the learner moved on does not replace the new one', async () => {
    await resolve('samples m1', { module: 'm1' });
    await resolve('sessions m1', { module: 'm1' });
    await go('/m/m1/b');
    await resolve('lesson m1/b', lessonModule('Lesson B text'));
    expect(shown()).toBe('Lesson B text');
    await resolve('lesson m1/a', lessonModule('Lesson A text')); // late
    expect(shown()).toBe('Lesson B text');
  });

  it('another module starts without the old samples and sessions, and ignores their late arrival', async () => {
    await resolve('lesson m1/a', lessonModule('m1 A'));
    await go('/m/m2/a');
    await resolve('lesson m2/a', lessonModule('m2 A'));
    await resolve('samples m2', { module: 'm2' });
    await resolve('sessions m2', { module: 'm2' });
    expect(data()).toEqual(['m2', 'm2']);
    await resolve('samples m1', { module: 'm1' }); // late
    await resolve('sessions m1', { module: 'm1' });
    expect(data()).toEqual(['m2', 'm2']);
  });

  it('does not show the previous module\'s samples and sessions while the new ones load', async () => {
    await resolve('lesson m1/a', lessonModule('m1 A'));
    await resolve('samples m1', { module: 'm1' });
    await resolve('sessions m1', { module: 'm1' });
    expect(data()).toEqual(['m1', 'm1']);
    await go('/m/m2/a');
    await resolve('lesson m2/a', lessonModule('m2 A'));
    expect(data()).toBeNull();
    expect(host.querySelector('[data-lesson]')).toBeNull();
    expect(host.textContent).toContain('Loading lesson…');
  });
});
