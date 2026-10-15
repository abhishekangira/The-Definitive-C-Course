// Attempt/hint/solution bookkeeping shared by every exercise kind (PLAN.md §2.5).
import { useCallback, useRef } from 'react';
import { exerciseProgress, update, useProgress, type ExerciseProgress } from '../progress/store';
import { fnv1a } from './hash';

export function useExerciseProgress(id: string, parentId?: string) {
  const progress = useProgress();
  const ep: ExerciseProgress = exerciseProgress(progress, id);
  const lastEdit = useRef<number | null>(null);

  const patch = useCallback((fn: (e: ExerciseProgress) => void) => {
    update(p => {
      const e = exerciseProgress(p, id);
      fn(e);
      p.exercises[id] = e;
    });
  }, [id]);

  /** Call on every edit: accumulates active time (gaps over a minute don't count). */
  const touch = useCallback((code?: string) => {
    const now = Date.now();
    const delta = lastEdit.current === null ? 0 : Math.min(now - lastEdit.current, 60_000);
    lastEdit.current = now;
    patch(e => { e.activeMs += delta; if (code !== undefined) e.code = code; });
  }, [patch]);

  /** Records a tested attempt; substantive when the code differs from the last tested code. */
  const recordAttempt = useCallback((code: string, passed: boolean) => {
    const h = fnv1a(code);
    patch(e => {
      e.attempts += 1;
      if (e.lastCodeHash !== h) e.substantive += 1;
      e.lastCodeHash = h;
      e.code = code;
      if (passed) {
        e.passed = true;
        if (!e.solutionViewed) e.mastered = true;
      }
    });
    if (passed && parentId) {
      // Passing the assigned variant masters the parent exercise.
      update(p => { const parent = exerciseProgress(p, parentId); parent.mastered = true; p.exercises[parentId] = parent; });
    }
  }, [patch, parentId]);

  const viewHint = useCallback((tier: number) => patch(e => { e.hintsViewed = Math.max(e.hintsViewed, tier); }), [patch]);
  const viewSolution = useCallback(() => patch(e => { e.solutionViewed = true; }), [patch]);
  const assignVariant = useCallback((variants: string[]) => {
    patch(e => {
      const tried = new Set(e.variantsTried ?? []);
      if (e.variant) tried.add(e.variant);
      const next = variants.find(v => !tried.has(v)) ?? variants[(tried.size) % Math.max(variants.length, 1)];
      e.variantsTried = [...tried];
      e.variant = next;
    });
  }, [patch]);

  return { ep, touch, recordAttempt, viewHint, viewSolution, assignVariant, patch };
}
