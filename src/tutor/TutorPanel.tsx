// "Ask the tutor" after a failed check. Model text is rendered as Markdown, never as HTML.
import { useEffect, useId, useRef, useState } from 'react';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { requestTutorReply } from './client';
import { ConsentNotice } from './ConsentNotice';
import { tutorEligible, type TutorCheckSnapshot } from './eligibility';
import { guardReply } from './leak';
import { buildTutorMessages, failingChecks, learnerVisibleText, openedHintTexts, skippedChecks, type TutorQuestion } from './prompt';
import { acceptTutorHost, consentCovers, getTutorSettings, isOpenRouter, tutorHost, useTutorSettings } from './settings';
import styles from './Tutor.module.css';

export function TutorPanel({ title, statement, hints, hintsViewed, solution, checkedCode, currentCode, results, diagnostics, bank, onAsked }: {
  title: string;
  statement: string;
  hints: readonly string[];
  hintsViewed: number;
  solution: string;
  checkedCode: string;
  currentCode: string;
  results: TutorCheckSnapshot['results'];
  diagnostics: string;
  /** Every line of a Parsons bank. The learner can see all of them, so repeating one is not a leak. */
  bank?: string;
  onAsked: () => void;
}) {
  const settings = useTutorSettings();
  const approachId = useId();
  const [approach, setApproach] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const nudgeRef = useRef<HTMLButtonElement>(null);
  const declinedRef = useRef<HTMLParagraphElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef<'nudge' | 'declined' | null>(null);
  // The results the visible reply is about. A new check replaces them, and the old reply goes with them.
  const checked = useRef(results);
  // A request belongs to one check. A newer check, or leaving the exercise, abandons it: its answer is neither
  // shown nor counted, and the buttons do not wait for it.
  const generation = useRef(0);
  const alive = useRef(true);
  const host = tutorHost(settings.baseUrl);
  // No model chosen and no course default for this host: asking cannot work, so do not offer it.
  const needsModel = Boolean(settings.apiKey) && !settings.model && !isOpenRouter(settings.baseUrl);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (checked.current === results) return;
    checked.current = results;
    generation.current += 1;
    setBusy(false);
    setReply(null);
    setError(null);
  }, [results]);

  useEffect(() => {
    const target = moveFocus.current;
    if (!target) return;
    const node = target === 'nudge' ? nudgeRef.current : declinedRef.current;
    if (!node) return;
    moveFocus.current = null;
    node.focus();
  }, [settings.consentedHost, declined]);

  useEffect(() => {
    if (busy) replyRef.current?.focus();
  }, [busy]);

  const ask = async (question: TutorQuestion) => {
    if (busy) return;
    const current = getTutorSettings();
    if (!consentCovers(current) || !host) return;
    if (question === 'why' && approach.trim() === '') {
      setError('Write one sentence about your approach first.');
      setReply(null);
      return;
    }
    setBusy(true);
    setError(null);
    setReply(null);
    const mine = generation.current;
    const messages = buildTutorMessages({
      title,
      statement,
      code: checkedCode,
      diagnostics,
      failing: failingChecks(results),
      skipped: skippedChecks(results),
      openedHints: openedHintTexts(hints, hintsViewed),
      solution,
      question,
      approach,
    });
    const result = await requestTutorReply({
      baseUrl: current.baseUrl, apiKey: current.apiKey, model: current.model, messages,
    });
    // A newer check arrived, or the exercise went away, while the provider was answering: this reply is about code that is gone.
    if (!alive.current || generation.current !== mine) return;
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    const knownText = learnerVisibleText({ statement, diagnostics, openedHints: openedHintTexts(hints, hintsViewed), results, bank });
    const guarded = guardReply({ reply: result.text, solution, learnerCode: checkedCode, hintsViewed, knownText, bankText: bank });
    setReply(guarded.show);
    onAsked();
  };

  const stale = currentCode !== checkedCode;
  return (
    <section className={styles.ask} aria-label="Ask the tutor" data-tutor="ask">
      <h4>Ask the tutor</h4>
      {!settings.apiKey && <p className={styles.muted}>Add an API key in <a href="#/settings">Settings</a> to ask the tutor.</p>}
      {needsModel && <p className={styles.muted}>Choose a model in <a href="#/settings">Settings</a> to ask the tutor. The course default models only work through OpenRouter.</p>}
      {settings.apiKey && !needsModel && !consentCovers(settings) && host && !declined && (
        <ConsentNotice host={host} scope="exercise" onAccept={() => { moveFocus.current = 'nudge'; acceptTutorHost(host, 'exercise'); setDeclined(false); }} onDecline={() => { moveFocus.current = 'declined'; setDeclined(true); }} />
      )}
      {settings.apiKey && !needsModel && !consentCovers(settings) && declined && (
        <p ref={declinedRef} tabIndex={-1} className={styles.muted}>Nothing was sent. <button type="button" className="btn btn-sm" onClick={() => setDeclined(false)}>Show the permission notice</button></p>
      )}
      {consentCovers(settings) && !needsModel && stale && <p>Check again before asking: the tutor uses the code you last checked.</p>}
      {consentCovers(settings) && !needsModel && !stale && (
        <>
          <div className={styles.actions}>
            <button type="button" ref={nudgeRef} className="btn" disabled={busy} onClick={() => void ask('nudge')}>{busy ? 'Asking…' : 'Give me a nudge'}</button>
          </div>
          <label className={styles.field} htmlFor={approachId}>What were you trying to do?
            <textarea id={approachId} rows={3} value={approach} onChange={e => setApproach(e.target.value)} />
          </label>
          <div className={styles.actions}>
            <button type="button" className="btn" disabled={busy} onClick={() => void ask('why')}>{busy ? 'Asking…' : 'Ask about my approach'}</button>
          </div>
        </>
      )}
      <div ref={replyRef} tabIndex={-1} role="status" aria-live="polite" data-tutor-reply>
        {error && <p className={styles.bad}>{error}</p>}
        {reply && <div className={styles.reply}><MiniMarkdown text={reply} /></div>}
      </div>
    </section>
  );
}

/** Mounts the panel only when this exercise is allowed to ask and the latest check failed. */
export function ExerciseTutor({ id, kind, runsIn, title, statement, hints, hintsViewed, solution, substantive, assessment, isVariant, allowTutor, currentCode, snapshot, bank, onAsked }: {
  id: string;
  kind: string;
  runsIn: string;
  title: string;
  statement: string;
  hints: readonly string[];
  hintsViewed: number;
  solution: string;
  substantive: number;
  assessment: boolean;
  isVariant: boolean;
  allowTutor: boolean;
  currentCode: string;
  snapshot: TutorCheckSnapshot | null;
  bank?: string;
  onAsked: () => void;
}) {
  if (!snapshot || !tutorEligible({
    kind, runsIn, substantive, latestFailed: snapshot.failed, assessment, isVariant, allowTutor, exerciseId: id,
  })) return null;
  return (
    <TutorPanel
      title={title} statement={statement} hints={hints} hintsViewed={hintsViewed} solution={solution}
      checkedCode={snapshot.code} currentCode={currentCode} results={snapshot.results} diagnostics={snapshot.diagnostics}
      bank={bank} onAsked={onAsked}
    />
  );
}
