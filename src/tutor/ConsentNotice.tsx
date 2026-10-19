// Shown before the first request to a provider host, from Settings and from an exercise.
import styles from './Tutor.module.css';

export function ConsentNotice({ host, onAccept, onDecline }: { host: string; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className={styles.notice} role="region" aria-label={`Send requests to ${host}`}>
      <p><strong>The first request sends your API key to {host}.</strong></p>
      <p>Asking the tutor also sends your code, the test results, and a hidden copy of the reference solution. The course never sees the request. Nothing is sent until you agree.</p>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={onAccept}>Send to {host}</button>
        <button type="button" className="btn" onClick={onDecline}>Don't send</button>
      </div>
    </div>
  );
}
