// Settings → Back up your progress → Google Drive. Hidden when the build has no OAuth client id.
// The sign-in script loads only when the learner points at or focuses a sign-in button (src/progress/drive.ts).
import { useState } from 'react';
import { connectDrive, disconnectDrive, driveClientId, loadGoogleSignIn, syncNow, useDrive } from '../progress/drive';
import { previewing } from '../progress/store';
import styles from '../app/pages/Pages.module.css';

function when(iso: string | undefined): string {
  if (!iso) return 'not yet';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? `today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString();
}

export function DriveSyncPanel() {
  const { settings, status } = useDrive();
  const [problem, setProblem] = useState<string | null>(null);
  if (!driveClientId()) return null;
  // The sign-in, "Sync now" and autosave are all off in a preview (progress/drive.ts), so no buttons that would do nothing.
  if (previewing) {
    return (
      <div aria-labelledby="drive-title" role="group">
        <h3 id="drive-title" className={styles.streakSub}>Google Drive</h3>
        <p>Google Drive sync is off while you preview an unreleased module: it would upload that module's progress with your real progress.</p>
      </div>
    );
  }

  const preload = () => { loadGoogleSignIn().catch(() => { /* the click reports it */ }); };
  const signIn = () => {
    setProblem(null);
    connectDrive().catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'Google sign-in failed.'));
  };
  const signInButton = (label: string) => (
    <button type="button" className="btn btn-primary" onPointerEnter={preload} onFocus={preload} onClick={signIn}>{label}</button>
  );

  return (
    <div aria-labelledby="drive-title" role="group">
      <h3 id="drive-title" className={styles.streakSub}>Google Drive</h3>
      {status.state === 'off' ? (
        <>
          <p>Save your progress to your Google Drive automatically and pick it up on any computer you sign in on. It goes to a hidden app folder
            that only this course can read; the course cannot see your other files.</p>
          <div className={styles.row2}>{signInButton('Connect Google Drive')}</div>
        </>
      ) : (
        <>
          <p role="status">
            {status.state === 'syncing' ? 'Syncing with Google Drive…'
              : status.state === 'signed-out' ? 'Your Google sign-in has expired. Progress is still saved in this browser; sign in again to sync it.'
                : `Your progress saves to Google Drive automatically. Last sync: ${when(settings.lastSyncAt)}.`}
          </p>
          <div className={styles.row2}>
            {status.state === 'signed-out' ? signInButton('Sign in again')
              : <button type="button" className="btn" disabled={status.state === 'syncing'} onClick={() => void syncNow()}>Sync now</button>}
            <button type="button" className="btn btn-ghost" onClick={() => { disconnectDrive(); setProblem(null); }}>Disconnect</button>
          </div>
          {status.state === 'error' && <p className={styles.warnBox} role="alert">{status.message}</p>}
        </>
      )}
      {problem && <p className={styles.warnBox} role="alert">{problem}</p>}
    </div>
  );
}
