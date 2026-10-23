import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { STORAGE_PREFIX, useProgress } from '../progress/store';
import { streakStatus } from '../progress/streak';
import { formFor } from '../progress/warrior';
import { WarriorPortrait, warriorLabel } from './StreakWarrior';
import styles from './PerfectLesson.module.css';

export const PERFECT_SEEN_KEY = `${STORAGE_PREFIX}perfect-seen`;
export const PERFECT_TITLE = 'Perfect lesson!';
/** Live confetti pieces at most. A piece removes itself when its fall ends. */
export const CONFETTI_CAP = 40;
/** One spawn tick. Each tick adds up to CONFETTI_PER_TICK pieces below the cap. */
export const CONFETTI_EVERY_MS = 300;
const CONFETTI_PER_TICK = 3;
const CONFETTI_COLOURS = 6;

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

function spawnPiece(layer: HTMLElement) {
  const piece = document.createElement('i');
  const r = Math.random();
  piece.dataset.c = String(Math.floor(Math.random() * CONFETTI_COLOURS));
  piece.style.setProperty('--x', `${(r * 100).toFixed(1)}vw`);
  piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 160)}px`);
  piece.style.setProperty('--spin', `${Math.round(180 + Math.random() * 540)}deg`);
  piece.style.setProperty('--fall', `${Math.round(2600 + Math.random() * 2200)}ms`);
  piece.addEventListener('animationend', () => piece.remove(), { once: true });
  piece.addEventListener('animationcancel', () => piece.remove(), { once: true });
  layer.append(piece);
}

/**
 * The celebration. A full-viewport modal: confetti falls over the whole page behind the panel, Rio dabs in a loop,
 * and it stays until the learner closes it (the Close button or Esc). No auto-close, no click-anywhere.
 * Reduced motion (or `still`): no confetti, the dab hold only, the title in its colours without the pop.
 */
export function PerfectLesson({ title, onClose, returnFocus, fallbackFocus, still = false }: {
  title: string;
  onClose: () => void;
  /** Where focus goes back on close. If it is gone by then: its interaction box, then `fallbackFocus`. */
  returnFocus?: HTMLElement;
  /** The lesson container: the last resort, so focus never drops to <body>. */
  fallbackFocus?: RefObject<HTMLElement | null>;
  still?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confetti = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
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
    const active = document.activeElement;
    const previous = returnFocus ?? (active instanceof HTMLElement && active !== document.body ? active : undefined);
    const box = previous?.closest<HTMLElement>('[data-interaction]') ?? undefined;
    const el = dialog.current!;
    el.showModal(); closeButton.current?.focus();
    const announce = setTimeout(() => setAnnouncement(`Perfect lesson: ${title}.`), 0);
    return () => {
      clearTimeout(announce); el.close();
      const target = [previous, box, fallbackFocus?.current ?? undefined].find(t => t?.isConnected);
      if (!target) return;
      if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
    };
  }, [returnFocus, fallbackFocus, title]);
  useEffect(() => {
    if (reduced) return;
    const timers = [setTimeout(() => setStage('flicker'), 350), setTimeout(() => setStage('blaze'), 850)];
    return () => timers.forEach(clearTimeout);
  }, [reduced]);
  // Confetti keeps falling while the dialog is open: a spawn tick below the cap, paused while the tab is hidden.
  useEffect(() => {
    const layer = confetti.current;
    if (reduced || !layer) return;
    let tick: ReturnType<typeof setInterval> | undefined;
    const spawn = () => {
      for (let k = 0; k < CONFETTI_PER_TICK && layer.childElementCount < CONFETTI_CAP; k++) spawnPiece(layer);
    };
    const start = () => { if (tick === undefined && !document.hidden) { spawn(); tick = setInterval(spawn, CONFETTI_EVERY_MS); } };
    const stop = () => { if (tick !== undefined) { clearInterval(tick); tick = undefined; } };
    const visibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', visibility);
    return () => { stop(); document.removeEventListener('visibilitychange', visibility); layer.replaceChildren(); };
  }, [reduced]);
  return createPortal(
    <dialog ref={dialog} aria-modal="true" aria-labelledby="perfect-title" aria-describedby="perfect-lesson-title"
      className={`${styles.dialog} ${reduced ? styles.still : ''}`} data-perfect-lesson=""
      onCancel={e => { e.preventDefault(); onClose(); }}>
      {!reduced && <div ref={confetti} className={styles.confetti} aria-hidden="true" data-confetti="" />}
      <div className={styles.panel}>
        <div className={styles.power} data-power="">
          <WarriorPortrait form={form.id} mood="ready" aura={reduced ? 'blaze' : stage} still={reduced} dab label={`${warriorLabel(form.id, 'ready')}, dabbing`} />
        </div>
        <span className="visually-hidden" role="status">{announcement}</span>
        <h2 id="perfect-title" className={styles.title}>
          <span className="visually-hidden">{PERFECT_TITLE}</span>
          <span aria-hidden="true" data-title-letters="">
            {[...PERFECT_TITLE].map((ch, i) => ch === ' '
              ? <span key={i} className={styles.space}> </span>
              : <span key={i} className={styles.letter} data-c={i % CONFETTI_COLOURS} style={{ '--i': i } as CSSProperties}>{ch}</span>)}
          </span>
        </h2>
        <p id="perfect-lesson-title">{title}</p>
        <p className={styles.hint}>Every prediction and quiz question right on the first try. Press Esc or Close to continue.</p>
        <button ref={closeButton} type="button" className="btn btn-primary" data-perfect-close="" onClick={onClose}>Close</button>
      </div>
    </dialog>, document.body,
  );
}
