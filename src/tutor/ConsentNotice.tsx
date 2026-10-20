// Shown before the first request to a provider host, from Settings, an exercise and the lesson chat. Settings names every use.
// Each notice records consent only for what it named (acceptTutorHost scope): exercise, lesson, or both from Settings.
import styles from './Tutor.module.css';

const SENDS = {
  exercise: 'Asking the tutor also sends your code, the test results, and a hidden copy of the reference solution.',
  lesson: 'Asking the tutor also sends the text of the lesson parts you have reached (including your edits to its code samples and the transcripts of its videos), the passage you highlighted, and your conversation.',
  any: 'Asking the tutor also sends what it needs to answer. On a problem that is your code, the test results and a hidden copy of the reference solution. In a lesson it is the text of the parts you have reached (with video transcripts), the passage you highlighted, and your conversation.',
} as const;

export function ConsentNotice({ host, scope = 'any', onAccept, onDecline }: { host: string; scope?: keyof typeof SENDS; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className={styles.notice} role="region" aria-label={`Send requests to ${host}`}>
      <p><strong>The first request sends your API key to {host}.</strong></p>
      <p>{SENDS[scope]} The course never sees the request. Nothing is sent until you agree.</p>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={onAccept}>Send to {host}</button>
        <button type="button" className="btn" onClick={onDecline}>Don't send</button>
      </div>
    </div>
  );
}
