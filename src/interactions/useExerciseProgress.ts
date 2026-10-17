// Attempt/hint/solution bookkeeping shared by every exercise kind (PLAN.md §2.5).
import { useCallback, useRef } from 'react';
import { exerciseProgress, noteActivity, update, useProgress, type ExerciseProgress } from '../progress/store';
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
    update(p => noteActivity(p)); // a submitted solution counts for the streak, passing or not
    if (passed && parentId) {
      // Passing the assigned variant masters the parent exercise.
      update(p => { const parent = exerciseProgress(p, parentId); parent.mastered = true; p.exercises[parentId] = parent; });
    }
  }, [patch, parentId]);

  const viewHint = useCallback((tier: number) => patch(e => { e.hintsViewed = Math.max(e.hintsViewed, tier); }), [patch]);
  const viewSolution = useCallback(() => patch(e => { e.solutionViewed = true; }), [patch]);

  /**
   * A pasted local-task code. Distinct codes are the substantive attempts `solutionGate` counts
   * (a local task has no editor, so it does not add active time). A completion token masters this
   * exercise unless its solution was viewed, and masters the parent when this is the assigned variant.
   */
  const recordLocalCode = useCallback((canonical: string, info: { complete: boolean; run?: number }) => {
    update(p => {
      noteActivity(p);
      const e = exerciseProgress(p, id);
      e.codes = [...new Set([...(e.codes ?? []), canonical])];
      e.attempts = Math.max(e.attempts, info.run ?? e.attempts + 1);
      e.substantive = Math.max(e.substantive, e.codes.length);
      if (info.complete) {
        e.passed = true;
        if (!e.solutionViewed) e.mastered = true;
      }
      p.exercises[id] = e;
      if (info.complete && parentId) {
        const parent = exerciseProgress(p, parentId);
        parent.mastered = true;
        p.exercises[parentId] = parent;
      }
    });
  }, [id, parentId]);

  const assignVariant = useCallback((variants: string[]) => {
    patch(e => {
      const tried = new Set(e.variantsTried ?? []);
      if (e.variant) tried.add(e.variant);
      const next = variants.find(v => !tried.has(v)) ?? variants[(tried.size) % Math.max(variants.length, 1)];
      e.variantsTried = [...tried];
      e.variant = next;
    });
  }, [patch]);

  return { ep, touch, recordAttempt, recordLocalCode, viewHint, viewSolution, assignVariant, patch };
}
