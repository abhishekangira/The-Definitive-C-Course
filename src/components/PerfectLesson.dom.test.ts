// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimPerfectLesson, PERFECT_SEEN_KEY, PerfectLesson } from './PerfectLesson';
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
async function mount(still = false) {
  const close = vi.fn(() => root.render(null));
  await act(async () => root.render(createElement(PerfectLesson, { title: 'Hello C', onClose: close, still })));
  return close;
}
it.each(['click', 'Escape', 'a'])('closes on %s and restores focus', async method => {
  const close = await mount(); const dialog = document.querySelector('dialog')!;
  expect(document.activeElement).toBe(dialog);
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.textContent).toContain('Perfect lesson!');
  await act(async () => dialog.dispatchEvent(method === 'click' ? new MouseEvent('click', { bubbles: true }) : new KeyboardEvent('keydown', { key: method, bubbles: true })));
  expect(close).toHaveBeenCalledOnce(); expect(document.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('ramps the current form in ready mood, then closes after 2.5 seconds', async () => {
  const p = emptyProgress();
  p.streak.days = [new Date().getFullYear() + '-01-01']; // a broken streak still celebrates as the ready kid
  replaceProgress(p);
  const close = await mount();
  expect(document.querySelector('[data-form="kid"][data-mood="ready"]')).not.toBeNull();
  expect(document.querySelector('[data-aura]')).toBeNull();
  act(() => vi.advanceTimersByTime(350)); expect(document.querySelector('[data-aura="flicker"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(500)); expect(document.querySelector('[data-aura="blaze"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(1650)); expect(close).toHaveBeenCalledOnce();
});
it.each([true, false])('reduced motion or explicit still shows powered-up Rio without confetti for 4 seconds (%s)', async still => {
  reduced = !still;
  const close = await mount(still);
  expect(document.querySelector('[data-confetti]')).toBeNull();
  expect(document.querySelector('[data-aura="blaze"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(3999)); expect(close).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(close).toHaveBeenCalledOnce();
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
