// Rio, the streak warrior (on the course map and in Settings). The form follows the current streak and the face follows
// today (src/progress/warrior.ts). The first time Rio is shown in a higher form than last time, a short frame sequence
// plays (stand, crouch, aura ramp, flash, new form; a plain swap under prefers-reduced-motion) and the new form is
// announced. The form last shown lives in its own localStorage key, outside the progress document, so export, import
// and "Reset all progress" leave it alone.
import { useEffect, useRef, useState, type AnimationEvent as ReactAnimationEvent } from 'react';
import { STORAGE_PREFIX, useProgress } from '../progress/store';
import { dayWord, MAX_BEANS, streakStatus } from '../progress/streak';
import {
  beansLine, FORMS, formById, formFor, isFormId, nextForm, reachedForms, transformationFrom, WARRIOR_NAME, warriorMessage, warriorMood,
  type FormId, type WarriorMood,
} from '../progress/warrior';
import { useNow } from './useNow';
import { BeanArt, HEAD_VIEWBOX, VIEWBOX, WarriorArt, type AuraStage } from './WarriorArt';
import styles from './StreakWarrior.module.css';

export const SEEN_KEY = `${STORAGE_PREFIX}warrior`;

function readSeen(): FormId | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return isFormId(v) ? v : null;
  } catch { return null; }
}

function writeSeen(id: FormId): void {
  try { localStorage.setItem(SEEN_KEY, id); } catch { /* storage blocked: the transformation may play again next time */ }
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const MOOD_WORD: Record<WarriorMood, string> = { defeated: 'defeated', worried: 'worried', ready: 'fired up' };

export function warriorLabel(form: FormId, mood: WarriorMood): string {
  return `${WARRIOR_NAME}, your streak warrior, in the ${formById(form).name} form, looks ${MOOD_WORD[mood]}.`;
}

interface PortraitProps {
  form: FormId;
  mood?: WarriorMood;
  /** No motion (gallery, header). */
  still?: boolean;
  /** No aura or night sky (silhouettes, header). Wins over `aura`. */
  bare?: boolean;
  /** Power-up stage. Omit it and the form keeps its default: flicker for golden, mane and crimson, none otherwise. */
  aura?: AuraStage;
  /** Just the head. */
  head?: boolean;
  /** An accessible name; without one the art is hidden from assistive technology. */
  label?: string;
  className?: string;
  /** Draw the crouch pose (`crouchSprite`): head and torso lowered on bent knees, feet planted. */
  crouch?: boolean;
  /** The transformation's flash: the silhouette only (WarriorArt `flash`). */
  flash?: boolean;
  onAnimationEnd?: (e: ReactAnimationEvent<HTMLSpanElement>) => void;
}

/** The art in its own SVG, inside the element the CSS animations key on. */
export function WarriorPortrait({ form, mood = 'ready', still = false, bare = false, aura, head = false, label, className, crouch = false, flash = false, onAnimationEnd }: PortraitProps) {
  return (
    <span className={[styles.art, still ? styles.still : '', className ?? ''].join(' ').trim()} data-form={form} data-mood={mood} onAnimationEnd={onAnimationEnd}>
      <svg className={styles.svg} viewBox={head ? HEAD_VIEWBOX[form] : VIEWBOX} focusable="false" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
        <WarriorArt form={form} mood={mood} bare={bare} aura={aura} crouch={crouch} flash={flash} />
      </svg>
    </span>
  );
}

/** One-shot transformation. Stand, the crouch drawn from the standing frame (`crouchSprite`), the charge as the aura ramps, the crouch white-hot (a flash in Rio's shape), the new form. */
export type TransformBeat =
  | { kind: 'pose'; who: 'from' | 'to'; aura: AuraStage; crouch: boolean }
  | { kind: 'flash' };

export const TRANSFORM_BEATS: readonly TransformBeat[] = [
  { kind: 'pose', who: 'from', aura: 'none', crouch: false },
  { kind: 'pose', who: 'from', aura: 'none', crouch: true },
  { kind: 'pose', who: 'from', aura: 'flicker', crouch: true },
  { kind: 'pose', who: 'from', aura: 'blaze', crouch: true },
  { kind: 'flash' },
  { kind: 'pose', who: 'to', aura: 'blaze', crouch: false },
];

/** One beat. Matches `--beat: 0.4s` in the CSS. */
export const TRANSFORM_BEAT_MS = 400;
/** The run, plus one beat, if the last beat's animation never ends or is cancelled without a listener. */
export const TRANSFORM_CLEAR_MS = TRANSFORM_BEATS.length * TRANSFORM_BEAT_MS + TRANSFORM_BEAT_MS;

type BeatEvent = { target: EventTarget | null; currentTarget: EventTarget | null };

/** The beats stacked in one box. CSS shows one at a time. The last beat ends the sequence, on `animationend` or `animationcancel`. */
export function TransformationSequence({ from, to, mood, onDone }: {
  from: FormId;
  to: FormId;
  mood: WarriorMood;
  onDone?: (e: BeatEvent) => void;
}) {
  const lastRef = useRef<HTMLSpanElement>(null);
  // Native listeners. React's event map has no animationcancel, and both events share one end path.
  useEffect(() => {
    const el = lastRef.current;
    if (!el || !onDone) return;
    const onEnd = (e: Event) => { onDone(e); };
    const onCancel = (e: Event) => { onDone(e); };
    el.addEventListener('animationend', onEnd);
    el.addEventListener('animationcancel', onCancel);
    return () => {
      el.removeEventListener('animationend', onEnd);
      el.removeEventListener('animationcancel', onCancel);
    };
  }, [onDone]);
  return (
    <span className={styles.sequence} data-transform-sequence="" data-transform-to={to}>
      {TRANSFORM_BEATS.map((beat, i) => {
        const last = i === TRANSFORM_BEATS.length - 1;
        // The crouched figure goes white-hot: its own pixels, nothing around them.
        if (beat.kind === 'flash') {
          return (
            <span key={i} data-transform-step={i} data-flash="" data-form={from} aria-hidden="true">
              <WarriorPortrait form={from} mood={mood} crouch flash />
            </span>
          );
        }
        const form = beat.who === 'to' ? to : from;
        return (
          <span key={i} ref={last ? lastRef : undefined} data-transform-step={i} data-form={form} data-aura={beat.aura} data-crouch={beat.crouch ? '' : undefined}>
            <WarriorPortrait form={form} mood={mood} aura={beat.aura} crouch={beat.crouch} label={last ? warriorLabel(to, mood) : undefined} />
          </span>
        );
      })}
    </span>
  );
}

/** Rio with a caption: the form, a line in the mood's voice and the days to the next form. */
export function StreakWarrior({ size = 120, caption = true, className }: { size?: number; caption?: boolean; className?: string }) {
  const st = streakStatus(useProgress().streak, useNow());
  const form = formFor(st.current);
  const mood = warriorMood(st);
  const message = warriorMessage(st);
  const next = mood === 'defeated' ? null : nextForm(st.current);
  const [transform, setTransform] = useState<{ from: FormId; to: FormId } | null>(null);
  const [unlocked, setUnlocked] = useState<FormId | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const seen = readSeen();
    const from = transformationFrom(seen, form.id);
    if (seen !== form.id) writeSeen(form.id);
    if (!from) {
      // A form that dropped (or an import) clears the news. A second run for the same form, as StrictMode does, keeps it.
      setUnlocked(u => (u === form.id ? u : null));
      setTransform(t => (t?.to === form.id ? t : null));
      return;
    }
    setUnlocked(form.id);
    setTransform(prefersReducedMotion() ? null : { from, to: form.id });
  }, [form.id]);

  // Fallback when the last beat is cancelled or never ends. Cleared on unmount and when `transform` changes,
  // so a sequence for the previous form cannot clear the next one.
  useEffect(() => {
    if (!transform) return;
    const to = transform.to;
    const timer = window.setTimeout(() => {
      if (!alive.current) return;
      setTransform(t => (t?.to === to ? null : t));
    }, TRANSFORM_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [transform]);

  // Child loops bubble animationend. Only the last beat's own clip counts, and only while that sequence is still
  // the one on screen. Removal fires animationcancel after the node is disconnected: ignore it, so unmount does not setState.
  const done = (e: BeatEvent) => {
    if (e.target !== e.currentTarget) return;
    const node = e.currentTarget;
    if (!(node instanceof Element) || !node.isConnected || !alive.current) return;
    const ended = node.closest('[data-transform-to]')?.getAttribute('data-transform-to');
    setTransform(t => (t?.to === ended ? null : t));
  };
  const span = next ? next.form.at - form.at : 1;
  return (
    <figure className={`${styles.warrior} ${className ?? ''}`.trim()} data-warrior data-form={form.id} data-mood={mood} data-transforming={transform ? '' : undefined}>
      <div className={styles.stage} style={{ ['--warrior-size' as string]: `${size}px` }}>
        {transform
          ? <TransformationSequence key={transform.to} from={transform.from} to={transform.to} mood={mood} onDone={done} />
          : <WarriorPortrait form={form.id} mood={mood} label={warriorLabel(form.id, mood)} />}
      </div>
      <figcaption className={caption ? styles.caption : 'visually-hidden'}>
        <span className={styles.formName}>{form.name}{st.current > 0 ? ` · ${dayWord(st.current)}` : ''}</span>
        {unlocked && <span className={styles.news} data-new-form={unlocked}>New form unlocked: {formById(unlocked).name}</span>}
        <span className={styles.message}>{message}</span>
        {!next && mood !== 'defeated' && <span className={styles.next}>{WARRIOR_NAME}'s final form. Keep the streak going to stay here.</span>}
        {next && (
          <span className={styles.next}>
            <span>Next form: <strong>{next.form.name}</strong> in {dayWord(next.in)}.</span>
            <span className={styles.nextBar} aria-hidden="true"><span style={{ width: `${Math.round(((st.current - form.at) / span) * 100)}%` }} /></span>
          </span>
        )}
      </figcaption>
      {/* The live region is in the tree before its text arrives, so the new form is announced. */}
      <span className="visually-hidden" role="status">{unlocked ? `Transformation! ${WARRIOR_NAME} reached a new form: ${formById(unlocked).name}.` : ''}</span>
    </figure>
  );
}

/** Every form: the ones the longest streak reached in colour, the others as silhouettes with the day that unlocks them. */
export function WarriorGallery({ current, longest }: { current: number; longest: number }) {
  const reached = new Set(reachedForms(longest));
  const now = current > 0 ? formFor(current).id : null;
  return (
    <ol className={styles.gallery} aria-label={`${WARRIOR_NAME}'s forms`}>
      {FORMS.map(f => {
        const state = f.id === now ? 'current' : reached.has(f.id) ? 'reached' : 'locked';
        return (
          <li key={f.id} data-state={state} data-gallery-form={f.id}>
            <WarriorPortrait form={f.id} still bare={state === 'locked'} className={state === 'locked' ? styles.locked : undefined} />
            <span className={styles.galleryName}>{f.name}</span>
            <span className={styles.galleryDay} aria-hidden="true">{state === 'current' ? 'Now' : `Day ${f.at}`}</span>
            <span className="visually-hidden">
              {state === 'locked' ? `, locked: a ${f.at}-day streak unlocks it.` : state === 'current' ? `, ${WARRIOR_NAME}'s form now.` : `, reached with a ${f.at}-day streak.`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The spirit beans on hand out of MAX_BEANS, and how many are saving the streak right now. */
export function SpiritBeans({ count, saving }: { count: number; saving: number }) {
  return (
    <p className={styles.beans} data-testid="spirit-beans">
      <span className={styles.beanRow} aria-hidden="true">
        {Array.from({ length: MAX_BEANS }, (_, i) => <BeanArt key={i} className={`${styles.bean} ${i < count ? '' : styles.beanEmpty}`} />)}
      </span>
      <span>
        <strong>{beansLine(count)}</strong>
        {saving > 0 && <> · {saving === 1 ? 'one is' : `${saving} are`} saving your streak right now</>}
      </span>
    </p>
  );
}

/** The head for the header chip; it pops when the form changes while the page is open. */
export function WarriorHead({ form, mood, pop }: { form: FormId; mood: WarriorMood; pop: boolean }) {
  return <WarriorPortrait key={form} form={form} mood={mood} still bare head className={`${styles.head} ${pop ? styles.pop : ''}`} />;
}
