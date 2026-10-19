// "Ask the tutor" after a failed check. Model text is rendered as Markdown, never as HTML.
import { useEffect, useId, useRef, useState } from 'react';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { requestTutorReply } from './client';
import { ConsentNotice } from './ConsentNotice';
import { tutorEligible, type TutorCheckSnapshot } from './eligibility';
import { guardReply } from './leak';
import { buildTutorMessages, failingChecks, openedHintTexts, skippedChecks, type TutorQuestion } from './prompt';
import { acceptTutorHost, consentCovers, getTutorSettings, tutorHost, useTutorSettings } from './settings';
import styles from './Tutor.module.css';

export function TutorPanel({ title, statement, hints, hintsViewed, solution, checkedCode, currentCode, results, diagnostics, onAsked }: {
  title: string;
  statement: string;
  hints: readonly string[];
  hintsViewed: number;
  solution: string;
  checkedCode: string;
  currentCode: string;
  results: TutorCheckSnapshot['results'];
  diagnostics: string;
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
  const host = tutorHost(settings.baseUrl);

  useEffect(() => {
    if (checked.current === results) return;
    checked.current = results;
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
    const asked = checked.current;
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
      baseUrl: current.baseUrl, apiKey: current.apiKey, messages,
    });
    setBusy(false);
    // A newer check arrived while the provider was answering: this reply is about code that is gone.
    if (checked.current !== asked) return;
    if (!result.ok) { setError(result.message); return; }
    const guarded = guardReply({ reply: result.text, solution, learnerCode: checkedCode, hintsViewed });
    setReply(guarded.show);
    onAsked();
  };

  const stale = currentCode !== checkedCode;
  return (
    <section className={styles.ask} aria-label="Ask the tutor" data-tutor="ask">
      <h4>Ask the tutor</h4>
      {!settings.apiKey && <p className={styles.muted}>Add an API key in <a href="#/settings">Settings</a> to ask the tutor.</p>}
      {settings.apiKey && !consentCovers(settings) && host && !declined && (
        <ConsentNotice host={host} onAccept={() => { moveFocus.current = 'nudge'; acceptTutorHost(host); setDeclined(false); }} onDecline={() => { moveFocus.current = 'declined'; setDeclined(true); }} />
      )}
      {settings.apiKey && !consentCovers(settings) && declined && (
        <p ref={declinedRef} tabIndex={-1} className={styles.muted}>Nothing was sent. <button type="button" className="btn btn-sm" onClick={() => setDeclined(false)}>Show the permission notice</button></p>
      )}
      {consentCovers(settings) && stale && <p>Check again before asking: the tutor uses the code you last checked.</p>}
      {consentCovers(settings) && !stale && (
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
export function ExerciseTutor({ id, kind, runsIn, title, statement, hints, hintsViewed, solution, substantive, assessment, isVariant, allowTutor, currentCode, snapshot, onAsked }: {
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
  onAsked: () => void;
}) {
  if (!snapshot || !tutorEligible({
    kind, runsIn, substantive, latestFailed: snapshot.failed, assessment, isVariant, allowTutor, exerciseId: id,
  })) return null;
  return (
    <TutorPanel
      title={title} statement={statement} hints={hints} hintsViewed={hintsViewed} solution={solution}
      checkedCode={snapshot.code} currentCode={currentCode} results={snapshot.results} diagnostics={snapshot.diagnostics}
      onAsked={onAsked}
    />
  );
}
