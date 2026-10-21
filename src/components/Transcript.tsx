// <Transcript session="id" step={2} beside="other" besideStep={2}>: stored terminal output of a native session in prose
// (docs/adr/0005-native-sessions.md), one tab per platform. `beside` puts a second session next to it (gdb and lldb).
// Nothing here is typed by hand: every line comes from src/generated/sessions, written by tools/verify.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { SessionsFile, SessionStepResult } from '../content-model/types';
import { useSessions } from '../lesson/LessonContext';
import { PLACEHOLDER_HELP, placeholderKinds, SESSION_PLATFORM_LABEL, splitPlaceholders, transcriptTabs } from './transcript-tabs';
import ix from '../interactions/Interaction.module.css';
import styles from './Transcript.module.css';

type StepProp = number | string | undefined;

export function Transcript({ session, step, beside, besideStep }: { session: string; step?: StepProp; beside?: string; besideStep?: StepProp }) {
  const file = useSessions();
  const pane = (id: string, s: StepProp) => <TranscriptPane key={id} file={file} id={id} step={s === undefined ? undefined : Number(s)} />;
  if (!beside) return pane(session, step);
  return <div className={styles.pair}>{pane(session, step)}{pane(beside, besideStep)}</div>;
}

function Placeholders({ text }: { text: string }) {
  return <>{splitPlaceholders(text).map((p, i) => (p.placeholder ? <span key={i} className={styles.placeholder} data-placeholder={p.placeholder}>{p.text}</span> : p.text))}</>;
}

/** One block per line (its newline kept, so copying gives the text back), so a wrapped line can hang under its start. */
function Output({ text }: { text: string }) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return <>{lines.map((l, i) => <span key={i} className={styles.ln}><Placeholders text={l} />{i < lines.length - 1 || text.endsWith('\n') ? '\n' : ''}</span>)}</>;
}

/** Which sides of a sideways-scrolling box hide text, kept up to date as it scrolls or resizes. */
function useHiddenSides(ref: RefObject<HTMLDivElement | null>, deps: unknown[]): { left: boolean; right: boolean } {
  const [sides, setSides] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setSides(s => (s.left === left && s.right === right ? s : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, deps);
  return sides;
}

function Step({ s }: { s: SessionStepResult }) {
  return (
    <div className={styles.step}>
      <div className={styles.cmd}><span className={styles.prompt} aria-hidden="true">$ </span><Placeholders text={s.cmd} /></div>
      {s.stdout && <div className={styles.stream}>{s.stderr && <span className={styles.label}>stdout</span>}<Output text={s.stdout} /></div>}
      {s.stderr && <div className={`${styles.stream} ${styles.err}`}><span className={styles.label}>stderr</span><Output text={s.stderr} /></div>}
      <div className={styles.exit}>exit status {s.exit}</div>
    </div>
  );
}

/** One session's output with its platform tabs. <CompilerError session> controls the selected tab to grade against it. */
export function TranscriptPane({ file, id, step, selected: controlled, onSelect }: {
  file: SessionsFile | null; id: string; step?: number | 'last'; selected?: number; onSelect?: (i: number) => void;
}) {
  const name = useId();
  const [own, setOwn] = useState(0);
  const selected = controlled ?? own;
  const setSelected = onSelect ?? setOwn;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const screenRef = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState(false);
  const result = file?.sessions[id];
  const hidden = useHiddenSides(screenRef, [result, selected, wrap, step]);
  if (!result) return <p className={ix.warn} role="alert">The output of session <code>{id}</code> hasn't been generated yet (run <code>npm run verify</code>).</p>;
  if (step !== undefined && step !== 'last' && !(Number.isInteger(step) && step > 0)) return <p className={ix.warn} role="alert">Transcript <code>{id}</code>: <code>step</code> must be a whole number from 1.</p>;
  const { tabs, pending, linuxOnly } = transcriptTabs(result, step);
  if (!tabs.length) return <p className={ix.warn} role="alert">Session <code>{id}</code> stored no step {step}{pending.length ? ` (no stored run for ${pending.map(p => SESSION_PLATFORM_LABEL[p]).join(' or ')})` : ''}.</p>;
  const sel = Math.min(selected, tabs.length - 1);
  const current = tabs[sel];
  const kinds = placeholderKinds(current.steps);

  // The tab pattern: arrow keys move between the platforms (and select), Home and End jump; Tab leaves the tab list.
  const onKeyDown = (e: KeyboardEvent) => {
    const n = tabs.length;
    const next = ({ ArrowRight: (sel + 1) % n, ArrowLeft: (sel - 1 + n) % n, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSelected(next);
    tabRefs.current[next]?.focus();
  };

  const steps = current.steps.map((s, i) => <Step key={i} s={s} />);
  // Long lines keep their columns and scroll sideways (a faded edge shows which side hides text), or wrap on request with
  // a hanging indent. The box takes focus so the arrow keys scroll it.
  const screen = (props: Record<string, unknown>) => (
    <div className={styles.frame} data-hidden-left={hidden.left || undefined} data-hidden-right={hidden.right || undefined}>
      <div ref={screenRef} tabIndex={0} className={styles.screen} data-wrap={wrap || undefined} {...props}>{steps}</div>
    </div>
  );
  return (
    <figure className={styles.transcript} data-transcript={id}>
      <figcaption className={ix.kicker}>Terminal output, recorded by running these commands</figcaption>
      {tabs.length === 1 ? (
        <>
          <p className={styles.platform}>{current.label}</p>
          {screen({ role: 'region', 'aria-label': `${current.label}: terminal output` })}
        </>
      ) : (
        <>
          <div role="tablist" className={ix.tabs} aria-label={`Platform for ${id}`} onKeyDown={onKeyDown}>
            {tabs.map((t, i) => (
              <button
                key={t.platform} ref={el => { tabRefs.current[i] = el; }} type="button" role="tab" id={`${name}-tab-${i}`} aria-controls={`${name}-panel`}
                aria-selected={i === sel} tabIndex={i === sel ? 0 : -1} className={ix.tab} data-platform={t.platform} onClick={() => setSelected(i)}
              >{t.label}</button>
            ))}
          </div>
          {screen({ role: 'tabpanel', id: `${name}-panel`, 'aria-labelledby': `${name}-tab-${sel}` })}
        </>
      )}
      <div className={styles.tools}>
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={wrap} onClick={() => setWrap(w => !w)}>Wrap lines</button>
      </div>
      {linuxOnly && <p className={styles.note} data-by-design="">{linuxOnly}</p>}
      {pending.length > 0 && <p className={styles.note} data-pending={pending.join(' ')}>No stored run for {pending.map(p => SESSION_PLATFORM_LABEL[p]).join(' or ')}.</p>}
      {kinds.length > 0 && (
        <dl className={styles.key} aria-label="Placeholders in this output">
          {kinds.map(k => <div key={k}><dt><code>{PLACEHOLDER_HELP[k].token}</code></dt><dd>{PLACEHOLDER_HELP[k].help}</dd></div>)}
        </dl>
      )}
    </figure>
  );
}
