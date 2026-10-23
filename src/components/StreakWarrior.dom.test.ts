// @vitest-environment jsdom
// The transformation sequence clears without a finished animation: on a timeout, on animationcancel, on unmount,
// and when the form changes. jsdom does not run CSS animations, so the end is the timer or a dispatched event.
import { act, createElement, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProgress, replaceProgress } from '../progress/store';
import { SEEN_KEY, StreakWarrior } from './StreakWarrior';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Six beats of 0.4s plus one beat. Hardcoded so it is not the component's own constant. */
const CLEAR_MS = 2800;

function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `n` local days ending today. */
function run(n: number): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(n - 1 - i));
}

function setDays(n: number) {
  const current = getProgress();
  replaceProgress({ ...current, streak: { days: run(n), longest: Math.max(n, current.streak.longest) } });
}

const media = (reduced: boolean) => ((query: string) => ({
  matches: reduced && query === '(prefers-reduced-motion: reduce)',
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false; },
})) as unknown as typeof window.matchMedia;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  window.matchMedia = media(false);
  localStorage.setItem(SEEN_KEY, 'kid');
  setDays(3);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  localStorage.removeItem(SEEN_KEY);
  vi.useRealTimers();
});

const show = (node: ReactNode = createElement(StreakWarrior)) => act(async () => { root.render(node); });
const steps = () => host.querySelectorAll('[data-transform-step]');
const transforming = () => host.querySelector('[data-transforming]');
const beat = (n: number) => host.querySelector(`[data-transform-step="${n}"]`);
// This jsdom build has no AnimationEvent. A bubbling Event is enough: the handlers only read target and currentTarget.
const beatEvent = (type: 'animationend' | 'animationcancel') => new Event(type, { bubbles: true });

describe('transformation sequence clearing', () => {
  it('a timeout clears the sequence when the animation never ends', async () => {
    await show();
    expect(steps()).toHaveLength(6);
    expect(localStorage.getItem(SEEN_KEY)).toBe('warrior');
    await act(async () => { await vi.advanceTimersByTimeAsync(CLEAR_MS - 1); });
    expect(transforming()).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(transforming()).toBeNull();
    expect(steps()).toHaveLength(0);
    expect(host.querySelector('[data-warrior]')?.getAttribute('data-form')).toBe('warrior');
  });

  it('animationend on the last beat clears it', async () => {
    await show();
    await act(async () => {
      beat(5)!.dispatchEvent(beatEvent('animationend'));
    });
    expect(transforming()).toBeNull();
  });

  it('animationcancel on the last beat clears it', async () => {
    await show();
    const last = beat(5)!;
    await act(async () => {
      last.dispatchEvent(beatEvent('animationcancel'));
    });
    expect(transforming()).toBeNull();
    expect(steps()).toHaveLength(0);
  });

  it('a child loop\'s animationend or animationcancel bubbling to the last beat does not clear it', async () => {
    await show();
    const child = beat(5)!.querySelector('svg g')!;
    expect(child).not.toBeNull();
    await act(async () => {
      child.dispatchEvent(beatEvent('animationcancel'));
      child.dispatchEvent(beatEvent('animationend'));
    });
    expect(transforming()).not.toBeNull();
    expect(steps()).toHaveLength(6);
  });

  it('a cancel for a sequence that is no longer the current one does not clear the new one', async () => {
    await show();
    const last = beat(5)!;
    const sequence = host.querySelector('[data-transform-to]')!;
    sequence.setAttribute('data-transform-to', 'kid');
    await act(async () => {
      last.dispatchEvent(beatEvent('animationcancel'));
    });
    expect(transforming()).not.toBeNull();
    expect(beat(5)?.getAttribute('data-form')).toBe('warrior');
  });

  it('unmount clears the fallback timer and does not setState afterwards', async () => {
    await show();
    expect(steps()).toHaveLength(6);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: unknown, ...rest: unknown[]) => {
      errors.push([msg, ...rest].map(String).join(' '));
    });
    await act(async () => { root.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(errors.filter(e => /unmounted|state update/i.test(e))).toEqual([]);
    spy.mockRestore();
  });

  it('a higher form mid-sequence starts that form\'s sequence, and the old timer does not clear it', async () => {
    await show();
    expect(beat(0)?.getAttribute('data-form')).toBe('kid');
    expect(beat(5)?.getAttribute('data-form')).toBe('warrior');
    const sequenceBefore = host.querySelector('[data-transform-sequence]')!;
    const lastBefore = beat(5)!;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await act(async () => { setDays(7); });
    expect(localStorage.getItem(SEEN_KEY)).toBe('golden');
    expect(beat(0)?.getAttribute('data-form')).toBe('warrior');
    expect(beat(5)?.getAttribute('data-form')).toBe('golden');
    expect(host.querySelector('[data-transform-to]')?.getAttribute('data-transform-to')).toBe('golden');
    // Keyed on the target form: new nodes, so the browser restarts every beat's CSS animation from beat 0.
    expect(sequenceBefore.isConnected).toBe(false);
    expect(host.querySelector('[data-transform-sequence]')).not.toBe(sequenceBefore);
    expect(lastBefore.isConnected).toBe(false);
    // The old fallback was due at 2800. A restarted one is due 2800 after the change.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(transforming()).not.toBeNull();
    expect(beat(5)?.getAttribute('data-form')).toBe('golden');
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(transforming()).toBeNull();
    expect(host.querySelector('[data-warrior]')?.getAttribute('data-form')).toBe('golden');
  });

  it('a form that drops mid-sequence clears it, and the seen key still runs once per new form', async () => {
    await show();
    expect(localStorage.getItem(SEEN_KEY)).toBe('warrior');
    await act(async () => { setDays(0); });
    expect(transforming()).toBeNull();
    expect(steps()).toHaveLength(0);
    expect(host.querySelector('[data-warrior]')?.getAttribute('data-form')).toBe('kid');
    expect(host.querySelector('[data-new-form]')).toBeNull();

    localStorage.setItem(SEEN_KEY, 'kid');
    await act(async () => { setDays(3); });
    expect(steps()).toHaveLength(6);
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await show();
    expect(steps()).toHaveLength(0);
    expect(host.querySelector('[data-warrior]')?.getAttribute('data-form')).toBe('warrior');
    expect(localStorage.getItem(SEEN_KEY)).toBe('warrior');
  });

  it('reduced motion shows the new form with no sequence, and StrictMode does not drop one that should play', async () => {
    window.matchMedia = media(true);
    await show();
    expect(steps()).toHaveLength(0);
    expect(transforming()).toBeNull();
    expect(host.querySelector('[data-new-form]')?.getAttribute('data-new-form')).toBe('warrior');
    expect(localStorage.getItem(SEEN_KEY)).toBe('warrior');

    window.matchMedia = media(false);
    localStorage.setItem(SEEN_KEY, 'kid');
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await show(createElement(StrictMode, null, createElement(StreakWarrior)));
    expect(steps()).toHaveLength(6);
    expect(beat(5)?.getAttribute('data-form')).toBe('warrior');
    expect(localStorage.getItem(SEEN_KEY)).toBe('warrior');
  });
});
