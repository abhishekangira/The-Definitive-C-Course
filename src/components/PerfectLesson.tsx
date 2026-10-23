import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { STORAGE_PREFIX, useProgress } from '../progress/store';
import { streakStatus } from '../progress/streak';
import { formFor } from '../progress/warrior';
import { WarriorPortrait, warriorLabel } from './StreakWarrior';
import styles from './PerfectLesson.module.css';

export const PERFECT_SEEN_KEY = `${STORAGE_PREFIX}perfect-seen`;

/** This key deliberately survives progress replacement, imports and reset. */
export function claimPerfectLesson(id: string): boolean {
  let seen: string[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PERFECT_SEEN_KEY) ?? '[]');
    if (Array.isArray(value)) seen = value.filter((v): v is string => typeof v === 'string');
  } catch { /* malformed or blocked storage is empty */ }
  if (seen.includes(id)) return false;
  try { localStorage.setItem(PERFECT_SEEN_KEY, JSON.stringify([...seen, id])); } catch { /* may celebrate again next visit */ }
  return true;
}

export function PerfectLesson({ title, onClose, still = false }: { title: string; onClose: () => void; still?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const progress = useProgress();
  const form = formFor(streakStatus(progress.streak, new Date()).current);
  const [reduced, setReduced] = useState(() => still || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [stage, setStage] = useState<'none' | 'flicker' | 'blaze'>('none');
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(still || query.matches);
    change(); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [still]);
  useEffect(() => {
    const previous = document.activeElement;
    const el = dialog.current!;
    el.showModal(); el.focus();
    return () => { el.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const timers = reduced ? [] : [setTimeout(() => setStage('flicker'), 350), setTimeout(() => setStage('blaze'), 850)];
    timers.push(setTimeout(onClose, reduced ? 4000 : 2500));
    return () => timers.forEach(clearTimeout);
  }, [reduced, onClose]);
  return createPortal(
    <dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby="perfect-title" aria-describedby="perfect-lesson-title"
      tabIndex={-1} className={`${styles.dialog} ${reduced ? styles.still : ''}`} data-perfect-lesson=""
      onClick={onClose} onCancel={e => { e.preventDefault(); onClose(); }}
      onKeyDown={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}>
      <div className={styles.power} data-power="">
        <WarriorPortrait form={form.id} mood="ready" aura={reduced ? 'blaze' : stage} still={reduced} label={warriorLabel(form.id, 'ready')} />
      </div>
      {!reduced && <div className={styles.confetti} aria-hidden="true" data-confetti="">
        {Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--i': i, '--x': `${(i % 8) * 13}%`, '--drift': `${((i % 5) - 2) * 28}px` } as CSSProperties} />)}
      </div>}
      <h2 id="perfect-title">Perfect lesson!</h2>
      <p id="perfect-lesson-title">{title}</p>
      <p className={styles.hint}>Every prediction exact. Click or press any key to continue.</p>
    </dialog>, document.body,
  );
}
