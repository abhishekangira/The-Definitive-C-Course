// @vitest-environment jsdom
// The real Settings page: "Reset all progress" clears the perfect-lesson marks with the document, while replacing
// the document (import or "Replace my progress") keeps them. window.confirm is stubbed.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimPerfectLesson, PERFECT_SEEN_KEY } from '../../components/PerfectLesson';
import { emptyProgress, getProgress, replaceProgress } from '../../progress/store';
import { SettingsPage } from './SettingsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear(); replaceProgress(emptyProgress());
  // The warrior art asks for reduced motion; the theme radios do not need a real matchMedia.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('Reset all progress clears the perfect-lesson marks too; replacing progress keeps them', async () => {
  // A lesson already celebrated in this browser.
  expect(claimPerfectLesson('m01-l1')).toBe(true);
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).not.toBeNull();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => root.render(createElement(SettingsPage)));
  const reset = [...host.querySelectorAll('button')].find(b => b.textContent === 'Reset all progress')!;
  await act(async () => reset.click());
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('perfect-lesson'));
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).toBeNull();
  expect(getProgress().lessons).toEqual({});
  expect(host.textContent).toContain('Progress reset.');
  // Import (merge) and "Replace my progress" call replaceProgress: the marks stay, so an imported perfect lesson
  // already celebrated here does not celebrate again.
  expect(claimPerfectLesson('m01-l1')).toBe(true);
  await act(async () => replaceProgress(emptyProgress()));
  expect(localStorage.getItem(PERFECT_SEEN_KEY)).not.toBeNull();
  expect(claimPerfectLesson('m01-l1')).toBe(false);
});
