// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimPerfectLesson, CONFETTI_CAP, CONFETTI_EVERY_MS, PERFECT_SEEN_KEY, PerfectLesson } from './PerfectLesson';
import { dayKey } from '../progress/streak';
import { emptyProgress, replaceProgress } from '../progress/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, trigger: HTMLButtonElement;
let reduced = false;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); replaceProgress(emptyProgress());
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
});
afterEach(() => { act(() => root.unmount()); host.remove(); trigger.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); reduced = false; });
async function mount(still = false, extra: Partial<Parameters<typeof PerfectLesson>[0]> = {}) {
  const close = vi.fn(() => root.render(null));
  await act(async () => root.render(createElement(PerfectLesson, { title: 'Hello C', onClose: close, returnFocus: trigger, still, ...extra })));
  return close;
}
/** The intervals started (the confetti loop is the only one) and those not cleared yet. */
function trackIntervals() {
  const started: unknown[] = []; const cleared = new Set<unknown>();
  const set = globalThis.setInterval; const clear = globalThis.clearInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => { const id = set(fn, ms); started.push(id); return id; }) as typeof setInterval);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: Parameters<typeof clearInterval>[0]) => { cleared.add(id); clear(id); }) as typeof clearInterval);
  return { started, running: () => started.filter(id => !cleared.has(id)) };
}
const closeButton = () => document.querySelector<HTMLButtonElement>('[data-perfect-close]')!;
it.each(['button', 'Escape'])('closes only on its %s and restores focus', async method => {
  const close = await mount(); const dialog = document.querySelector('dialog')!;
  expect(document.activeElement).toBe(closeButton());
  expect(closeButton().textContent).toBe('Close');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  await act(async () => (method === 'button' ? closeButton().click() : dialog.dispatchEvent(new Event('cancel', { cancelable: true }))));
  expect(close).toHaveBeenCalledOnce(); expect(document.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it.each([{ key: 'a' }, { key: 'Enter' }, { key: ' ' }, { key: 'Shift' }, { key: 'r', ctrlKey: true }])('stays open on any other key (%j), a click anywhere and with time', async init => {
  const close = await mount(); const dialog = document.querySelector('dialog')!;
  const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  await act(async () => dialog.dispatchEvent(event));
  await act(async () => dialog.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await act(async () => document.querySelector('h2')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  act(() => vi.advanceTimersByTime(60_000));
  expect(event.defaultPrevented).toBe(false); expect(close).not.toHaveBeenCalled(); expect(dialog.hasAttribute('open')).toBe(true);
  expect(document.querySelector('[data-perfect-lesson] p:not([id])')!.textContent).toBe('Every prediction and quiz question right on the first try. Press Esc or Close to continue.');
});
it('falls back to the interaction box, then the lesson container, never <body>, when the return target is gone', async () => {
  const lesson = document.createElement('div'); const box = document.createElement('div'); box.dataset.interaction = 'choice'; box.tabIndex = -1;
  const button = document.createElement('button'); box.appendChild(button); lesson.appendChild(box); document.body.appendChild(lesson);
  await mount(false, { returnFocus: button, fallbackFocus: { current: lesson } });
  button.remove();
  await act(async () => closeButton().click());
  expect(document.activeElement).toBe(box);
  await mount(false, { returnFocus: button, fallbackFocus: { current: lesson } });
  box.remove();
  await act(async () => closeButton().click());
  expect(document.activeElement).toBe(lesson); expect(lesson.getAttribute('tabindex')).toBe('-1');
  lesson.remove();
});
it('reads the title as one phrase, each letter its own colour', async () => {
  await mount();
  const h2 = document.querySelector('h2')!;
  expect(h2.querySelector('.visually-hidden')!.textContent).toBe('Perfect lesson!');
  const letters = h2.querySelector('[aria-hidden="true"]')!;
  expect(letters.textContent!.replace(/\s/g, ' ')).toBe('Perfect lesson!');
  expect(new Set([...letters.querySelectorAll('[data-c]')].map(l => l.getAttribute('data-c'))).size).toBe(6);
  expect(document.querySelector('dialog')!.getAttribute('aria-labelledby')).toBe(h2.id);
});
it('ramps the current form in ready mood, dabbing, and stays open', async () => {
  const p = emptyProgress();
  p.streak.days = [new Date().getFullYear() + '-01-01']; // a broken streak still celebrates as the ready kid
  replaceProgress(p);
  const close = await mount();
  expect(document.querySelector('[data-form="kid"][data-mood="ready"] [data-dab]')).not.toBeNull();
  expect(document.querySelectorAll('[data-dab-frame]')).toHaveLength(4);
  expect(document.querySelector('[data-aura]')).toBeNull();
  act(() => vi.advanceTimersByTime(350)); expect(document.querySelector('[data-aura="flicker"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(500)); expect(document.querySelector('[data-aura="blaze"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(10_000)); expect(close).not.toHaveBeenCalled();
});
it('keeps confetti falling below the cap, pauses while the tab is hidden, and stops the confetti and the dab on close', async () => {
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const loops = trackIntervals();
  await mount();
  const layer = document.querySelector('[data-confetti]')!;
  expect(layer.childElementCount).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(CONFETTI_EVERY_MS * 3));
  const growing = layer.childElementCount;
  expect(growing).toBeGreaterThan(3);
  // A finished piece removes itself; new ones keep coming.
  act(() => layer.firstElementChild!.dispatchEvent(new Event('animationend')));
  expect(layer.childElementCount).toBe(growing - 1);
  act(() => vi.advanceTimersByTime(CONFETTI_EVERY_MS * 100));
  expect(layer.childElementCount).toBe(CONFETTI_CAP);
  [...layer.children].slice(0, 10).forEach(i => i.dispatchEvent(new Event('animationend')));
  hidden = true; act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => vi.advanceTimersByTime(CONFETTI_EVERY_MS * 10));
  expect(layer.childElementCount).toBe(CONFETTI_CAP - 10);
  hidden = false; act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => vi.advanceTimersByTime(CONFETTI_EVERY_MS * 10));
  expect(layer.childElementCount).toBe(CONFETTI_CAP);
  expect(document.querySelector('[data-dab]')).not.toBeNull();
  await act(async () => closeButton().click());
  expect(layer.childElementCount).toBe(0);
  expect(document.querySelector('[data-confetti]')).toBeNull();
  expect(document.querySelector('[data-dab]')).toBeNull();
  expect(loops.started.length).toBeGreaterThan(1); // stopped while hidden, started again
  expect(loops.running()).toEqual([]);
  act(() => vi.advanceTimersByTime(CONFETTI_EVERY_MS * 10));
  expect(document.querySelectorAll('i[data-c]')).toHaveLength(0);
  vi.restoreAllMocks();
});
it('stops the confetti loop on unmount too', async () => {
  const loops = trackIntervals();
  await mount();
  expect(loops.running()).toHaveLength(1);
  act(() => root.render(null));
  expect(loops.running()).toEqual([]);
  vi.restoreAllMocks();
});
it.each([true, false])('reduced motion or explicit still: no confetti, the dab hold only, static title (%s)', async still => {
  reduced = !still;
  const close = await mount(still);
  expect(document.querySelector('[data-confetti]')).toBeNull();
  expect(document.querySelector('[data-perfect-lesson]')!.className).toMatch(/still/);
  expect(document.querySelector('[data-aura="blaze"]')).not.toBeNull();
  const loops = trackIntervals();
  act(() => vi.advanceTimersByTime(60_000)); expect(close).not.toHaveBeenCalled();
  expect(loops.started).toEqual([]); expect(document.querySelectorAll('i[data-c]')).toHaveLength(0);
  vi.restoreAllMocks();
});
it('claims each lesson once and reads seen storage defensively', () => {
  for (const junk of ['broken', '{}', '42', 'null']) {
    localStorage.setItem(PERFECT_SEEN_KEY, junk);
    expect(claimPerfectLesson('l')).toBe(true); expect(claimPerfectLesson('l')).toBe(false);
  }
  localStorage.setItem(PERFECT_SEEN_KEY, '[1,"old",null]');
  expect(claimPerfectLesson('old')).toBe(false); expect(claimPerfectLesson('new')).toBe(true);
  expect(JSON.parse(localStorage.getItem(PERFECT_SEEN_KEY)!)).toEqual(['old', 'new']);
  replaceProgress(emptyProgress()); expect(claimPerfectLesson('new')).toBe(false);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(claimPerfectLesson('blocked')).toBe(true); vi.restoreAllMocks();
});

it('uses the current streak form even when the learner is worried', async () => {
  const p = emptyProgress();
  p.streak.days = Array.from({ length: 7 }, (_, i) => { const date = new Date(); date.setDate(date.getDate() - (7 - i)); return dayKey(date); });
  p.streak.longest = 7; replaceProgress(p);
  await mount(); expect(document.querySelector('[data-form="golden"][data-mood="ready"]')).not.toBeNull();
});

it('announces inside the modal after it opens', async () => {
  await mount(); const live = document.querySelector('dialog [role="status"]')!;
  expect(live.textContent).toBe('');
  act(() => vi.advanceTimersByTime(0)); expect(live.textContent).toBe('Perfect lesson: Hello C.');
});
