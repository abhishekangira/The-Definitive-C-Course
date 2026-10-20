// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyProgress, getProgress, replaceProgress } from '../progress/store';
import { useExerciseProgress } from './useExerciseProgress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ id, slot }: { id: string; slot: { api: ReturnType<typeof useExerciseProgress> | null } }) {
  slot.api = useExerciseProgress(id);
  return null;
}

describe('recordTutorAsk', () => {
  let host: HTMLDivElement;
  let root: Root;
  const slot: { api: ReturnType<typeof useExerciseProgress> | null } = { api: null };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    replaceProgress(emptyProgress());
    slot.api = null;
    act(() => { root.render(createElement(Probe, { id: 'hello-world', slot })); });
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('counts an answered tutor question and does not touch the streak or the attempt counters', () => {
    act(() => { slot.api!.recordTutorAsk(); });
    const ep = getProgress().exercises['hello-world'];
    expect(ep.tutorAsks).toBe(1);
    expect(ep.substantive).toBe(0);
    expect(ep.attempts).toBe(0);
    expect(getProgress().streak.days).toEqual([]);
  });

  it('a checked attempt still counts for the streak and leaves tutorAsks at 0', () => {
    act(() => { slot.api!.recordAttempt('int main(void) { return 0; }', false); });
    const ep = getProgress().exercises['hello-world'];
    expect(ep.tutorAsks).toBe(0);
    expect(ep.substantive).toBe(1);
    expect(ep.attempts).toBe(1);
    expect(getProgress().streak.days).toHaveLength(1);
  });
});