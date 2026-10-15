// A lesson is a sequence of cards; card N+1 appears once card N's interaction is done.
// The remark plugin wraps lesson content in <Card index gated total>; interactions call
// useCardDone() to report completion.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { markCard, update, useProgress } from '../progress/store';
import type { SamplesFile } from '../content-model/types';
import styles from './Lesson.module.css';

interface LessonState {
  lessonId: string;
  moduleId: string;
  samples: SamplesFile | null;
  completed: number[];
}

const LessonCtx = createContext<LessonState | null>(null);
const CardCtx = createContext<{ index: number; gated: boolean } | null>(null);

export function LessonProvider({ lessonId, moduleId, samples, children }: { lessonId: string; moduleId: string; samples: SamplesFile | null; children: ReactNode }) {
  const progress = useProgress();
  const completed = progress.cards[lessonId] ?? [];
  const value = useMemo(() => ({ lessonId, moduleId, samples, completed }), [lessonId, moduleId, samples, completed]);
  return <LessonCtx.Provider value={value}>{children}</LessonCtx.Provider>;
}

export function useLesson(): LessonState | null { return useContext(LessonCtx); }

/** Samples for the current lesson's module (null outside a lesson or before generation). */
export function useSamples(): SamplesFile | null { return useContext(LessonCtx)?.samples ?? null; }

/** Returns a function that marks the enclosing card complete (no-op outside lessons, e.g. quizzes). */
export function useCardDone(): () => void {
  const lesson = useContext(LessonCtx);
  const card = useContext(CardCtx);
  return useCallback(() => {
    if (lesson && card) markCard(lesson.lessonId, card.index);
  }, [lesson, card]);
}

export function useCardIsDone(): boolean {
  const lesson = useContext(LessonCtx);
  const card = useContext(CardCtx);
  return Boolean(lesson && card && lesson.completed.includes(card.index));
}

export function Card({ index, gated, total, children }: { index: string | number; gated: string | boolean; total: string | number; children: ReactNode }) {
  const lesson = useContext(LessonCtx);
  const i = Number(index);
  const isGated = gated === true || gated === 'true';
  const n = Number(total);
  const ref = useRef<HTMLElement>(null);
  const completed = lesson?.completed ?? [];
  // Visible when every earlier gated card is done (non-gated trailing cards follow the last gate).
  // Outside a lesson (project pages) nothing is gated.
  const visible = !lesson || i === 0 || completed.includes(i - 1);
  const wasVisible = useRef(visible);

  // Scroll newly revealed cards into view (but not on first render of an already-progressed lesson).
  useEffect(() => {
    if (visible && !wasVisible.current) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    wasVisible.current = visible;
  }, [visible]);

  // Non-gated cards count as complete as soon as they are shown.
  useEffect(() => {
    if (visible && !isGated && lesson && !completed.includes(i)) markCard(lesson.lessonId, i);
  }, [visible, isGated, lesson, completed, i]);

  // Lesson completion: every card done.
  useEffect(() => {
    if (!lesson || i !== n - 1) return;
    const allDone = Array.from({ length: n }, (_, k) => k).every(k => completed.includes(k));
    if (allDone) update(p => { p.lessons[lesson.lessonId] ??= { completedAt: new Date().toISOString() }; });
  }, [completed, lesson, i, n]);

  const card = useMemo(() => ({ index: i, gated: isGated }), [i, isGated]);
  if (!visible) return null;
  return (
    <CardCtx.Provider value={card}>
      <section ref={ref} className={styles.card} aria-label={`Part ${i + 1} of ${n}`} data-card={i}>
        {children}
      </section>
    </CardCtx.Provider>
  );
}
