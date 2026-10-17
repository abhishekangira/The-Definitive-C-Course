// @vitest-environment jsdom
// Wiring of the untrusted-input fixes into the components (issue #7): reverting LocalTask, SettingsPage or
// YouTube to its old code makes a test here fail. The components are mounted for real (react-dom + jsdom);
// only things unrelated to the input path (course data, the C runtime) are mocked.
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMPORT_BYTES, emptyProgress, getProgress, replaceProgress } from './progress/store';
import { dayKey } from './progress/streak';
import { encodeCompletionToken, encodeProgressCode } from './testing/token';
import type { ExerciseEntry } from './content-runtime/course';
import type { VideoEntry } from './content-model/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const videos = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('./content-runtime/course', () => ({ videoByKey: (k: string) => (videos.list as { key: string }[]).find(v => v.key === k) }));
vi.mock('./interactions/Exercise', () => ({ useFolder: () => ({ 'starter.c': 'int main(void){}' }) }));
vi.mock('./lesson/LessonContext', () => ({ useCardDone: () => () => {} }));
vi.mock('./runtime/CRuntime', () => ({ detectStdinMode: () => 'preset' }));
vi.mock('./interactions/PlatformPicker', () => ({ PlatformPicker: () => null }));
vi.mock('./app/theme', () => ({ useTheme: () => ['system', () => {}] }));

const { LocalTask } = await import('./interactions/LocalTask');
const { SettingsPage } = await import('./app/pages/SettingsPage');
const { YouTube } = await import('./components/YouTube');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); replaceProgress(emptyProgress()); videos.list = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (el: Parameters<Root['render']>[0]) => act(() => root.render(el));
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)); });
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const button = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? ''))!;

describe('LocalTask stores the canonical code, not the pasted text', () => {
  const entry = { id: 'lt-demo', meta: { title: 'Demo', prompt: 'p', hints: ['a', 'b', 'c'], kind: 'lt' } } as unknown as ExerciseEntry;
  const paste = async (text: string) => {
    type(host.querySelector('input')!, text);
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
  };

  it('progress code: e.codes holds the canonical code even when the paste is wrapped in huge text', async () => {
    const seed = getProgress().seed;
    const code = await encodeProgressCode({ exercise: 'lt-demo', bits: '0101', run: 2, src: '1a2b3c4d' }, seed);
    render(createElement(LocalTask, { entry }));
    await paste(`Here: "${code.toUpperCase()}" ${'junk '.repeat(20000)}`);
    expect(getProgress().exercises['lt-demo'].codes).toEqual([code]);
    expect(getProgress().exercises['lt-demo'].passed).toBe(false);
    expect(getProgress().streak.days, 'a valid pasted code is a submission').toEqual([dayKey()]);
  });

  it('completion token: the project token is the canonical token', async () => {
    const seed = getProgress().seed;
    const token = await encodeCompletionToken({ exercise: 'lt-demo' }, seed);
    render(createElement(LocalTask, { entry, projectId: 'demo-project' }));
    await paste(`  ${token.toUpperCase()}\n(from my terminal) ${'x'.repeat(50000)}`);
    expect(getProgress().projects['demo-project']).toMatchObject({ passed: true, token });
    expect(getProgress().exercises['lt-demo'].codes).toEqual([token]);
  });

  it('a code for another learner is refused and nothing is stored', async () => {
    const code = await encodeProgressCode({ exercise: 'lt-demo', bits: '01', run: 1, src: '1a2b3c4d' }, 'fedcba9876543210');
    render(createElement(LocalTask, { entry }));
    await paste(code);
    expect(getProgress().exercises['lt-demo']).toBeUndefined();
    expect(getProgress().streak.days, 'a refused code is not a submission').toEqual([]);
  });
});

describe('SettingsPage import', () => {
  const fileInput = () => host.querySelector('input[type=file]') as HTMLInputElement;
  async function importFile(file: File) {
    Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true });
    await act(async () => { fileInput().dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
  }
  const SEED = '0123456789abcdef';
  const at = '2026-01-01T00:00:00.000Z';

  it('refuses a file over the size cap without reading it, and says why', async () => {
    render(createElement(SettingsPage));
    const big = new File(['{}'], 'p.json');
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 });
    const text = vi.spyOn(big, 'text');
    await importFile(big);
    expect(host.querySelector('p[role=status]')?.textContent).toMatch(/too large/);
    expect(text).not.toHaveBeenCalled();
  });

  it('reports invalid JSON and a bad version instead of throwing', async () => {
    render(createElement(SettingsPage));
    await importFile(new File(['{"version":1,'], 'p.json'));
    expect(host.querySelector('p[role=status]')?.textContent).toMatch(/not valid JSON/);
    await importFile(new File([JSON.stringify({ version: 2, seed: SEED })], 'p.json'));
    expect(host.querySelector('p[role=status]')?.textContent).toMatch(/Unsupported progress version: 2/);
  });

  it('merges a file whose keys are inherited names (constructor, toString, hasOwnProperty, __proto__)', async () => {
    render(createElement(SettingsPage));
    const doc = `{"version":1,"seed":"${SEED}","createdAt":"${at}","cards":{"constructor":[1],"toString":[2],"hasOwnProperty":[3],"__proto__":[4]},
      "exercises":{"toString":{"attempts":3,"passed":true},"constructor":{"attempts":1}},"lessons":{"valueOf":{"completedAt":"${at}"}}}`;
    await importFile(new File([doc], 'p.json'));
    expect(host.querySelector('[role=dialog]')).not.toBeNull();
    await act(async () => { button(/Merge with my progress/).click(); });
    expect(host.querySelector('p[role=status]')?.textContent).toMatch(/Merged/);
    const p = getProgress();
    expect(p.cards.constructor).toEqual([1]);
    expect(p.exercises.toString).toMatchObject({ attempts: 3, passed: true });
    expect(Object.keys(p.lessons)).toEqual(['valueOf']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('YouTube embed wiring', () => {
  const v = (patch: Partial<VideoEntry>) => ({ key: 'k', id: 'SlqjA04_dpk', title: 'T', channel: 'C', start: 10, end: 70, why: 'w', ...patch });

  it('shows the play facade for a valid segment and an alert for an invalid id or times', () => {
    videos.list = [v({}), v({ key: 'bad-id', id: 'x&autoplay=0' }), v({ key: 'bad-time', start: 90, end: 20 })];
    render(createElement(YouTube, { video: 'k' }));
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(button(/Watch a/)).toBeDefined();
    for (const key of ['bad-id', 'bad-time']) {
      render(createElement(YouTube, { video: key }));
      expect(host.querySelector('[role=alert]')?.textContent, key).toMatch(/invalid/);
      expect(host.querySelector('button')).toBeNull();
    }
  });

  it('the iframe it creates points at youtube-nocookie.com with the checked id', () => {
    videos.list = [v({})];
    render(createElement(YouTube, { video: 'k' }));
    act(() => button(/Watch a/).click());
    const src = new URL(host.querySelector('iframe')!.getAttribute('src')!);
    expect(src.origin + src.pathname).toBe('https://www.youtube-nocookie.com/embed/SlqjA04_dpk');
  });
});
