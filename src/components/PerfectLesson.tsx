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

export function PerfectLesson({ title, onClose, returnFocus, still = false }: { title: string; onClose: () => void; returnFocus?: HTMLElement; still?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const progress = useProgress();
  const form = formFor(streakStatus(progress.streak, new Date()).current);
  const [reduced, setReduced] = useState(() => still || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [announcement, setAnnouncement] = useState('');
  const [stage, setStage] = useState<'none' | 'flicker' | 'blaze'>('none');
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(still || query.matches);
    change(); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [still]);
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement;
    const el = dialog.current!;
    el.showModal(); el.focus();
    const announce = setTimeout(() => setAnnouncement(`Perfect lesson: ${title}.`), 0);
    return () => { clearTimeout(announce); el.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [returnFocus, title]);
  useEffect(() => {
    const timers = reduced ? [] : [setTimeout(() => setStage('flicker'), 350), setTimeout(() => setStage('blaze'), 850)];
    // Explicit browser-test hold: keep just this dialog open for axe/screenshots, without changing global timers.
    timers.push(setTimeout(() => { if (!dialog.current?.hasAttribute('data-hold')) onClose(); }, reduced ? 4000 : 2500));
    return () => timers.forEach(clearTimeout);
  }, [reduced, onClose]);
  return createPortal(
    <dialog ref={dialog} aria-modal="true" aria-labelledby="perfect-title" aria-describedby="perfect-lesson-title"
      tabIndex={-1} className={`${styles.dialog} ${reduced ? styles.still : ''}`} data-perfect-lesson=""
      onClick={onClose} onCancel={e => { e.preventDefault(); onClose(); }}
      onKeyDown={e => {
        if (e.ctrlKey || e.metaKey || e.altKey || ['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation(); onClose();
      }}>
      <div className={styles.power} data-power="">
        <WarriorPortrait form={form.id} mood="ready" aura={reduced ? 'blaze' : stage} still={reduced} label={warriorLabel(form.id, 'ready')} />
      </div>
      {!reduced && <div className={styles.confetti} aria-hidden="true" data-confetti="">
        {Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--i': i, '--x': `${(i % 8) * 13}%`, '--drift': `${((i % 5) - 2) * 36}px` } as CSSProperties} />)}
      </div>}
      <span className="visually-hidden" role="status">{announcement}</span>
      <h2 id="perfect-title">Perfect lesson!</h2>
      <p id="perfect-lesson-title">{title}</p>
      <p className={styles.hint}>Every prediction exact. Click or press any key to continue.</p>
    </dialog>, document.body,
  );
}
