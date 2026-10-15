import { useRef, useState } from 'react';
import {
  daysSinceExport, emptyProgress, exportFileName, exportProgress, getProgress, mergeProgress, migrate, replaceProgress, summarise,
  update, useProgress, type ProgressV1,
} from '../../progress/store';
import { useTheme, type ThemeChoice } from '../theme';
import { PlatformPicker } from '../../interactions/PlatformPicker';
import { downloadBlob } from '../../interactions/zip';
import { detectStdinMode } from '../../runtime/CRuntime';
import styles from './Pages.module.css';

export function SettingsPage() {
  const progress = useProgress();
  const [theme, setTheme] = useTheme();
  const [pending, setPending] = useState<ProgressV1 | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const days = daysSinceExport(progress);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const next = migrate(JSON.parse(await f.text()));
      setPending(next);
      setMessage(null);
    } catch (e) {
      setMessage({ ok: false, text: `Couldn't read that file: ${(e as Error).message}` });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const summary = pending ? summarise(pending) : null;
  const mode = detectStdinMode();
  return (
    <div className={styles.narrow}>
      <h1>Progress &amp; settings</h1>

      <section className={styles.panel}>
        <h2>Back up your progress</h2>
        <p>Your progress is stored only in this browser ({Object.keys(progress.lessons).length} lessons done). Export it to a file to keep it safe or move to another computer.
          {' '}{days === null ? 'You haven’t exported yet.' : `Last export: ${days === 0 ? 'today' : `${days} days ago`}.`}</p>
        <p className={styles.muted}>Safari deletes a site's stored data after 7 days without a visit, so export regularly if you use Safari.</p>
        <div className={styles.row}>
          <button type="button" className="btn btn-primary" onClick={() => downloadBlob(exportProgress(), exportFileName())}>Export progress</button>
          <label className="btn">
            Import from file
            <input ref={fileRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={e => void onFile(e.target.files?.[0])} />
          </label>
        </div>
        {pending && summary && (
          <div className={styles.importBox} role="dialog" aria-label="Import progress">
            <p>This file has <strong>{summary.lessons}</strong> lessons complete, <strong>{summary.exercisesPassed}</strong> exercises passed
              {summary.modulesPassed.length ? <>, and checkpoints passed for <strong>{summary.modulesPassed.join(', ')}</strong></> : ''}.
              {!summary.seedMatches && ' It comes from a different browser profile (different learner seed).'}</p>
            <div className={styles.row}>
              <button type="button" className="btn btn-primary" onClick={() => { replaceProgress(mergeProgress(getProgress(), pending)); setPending(null); setMessage({ ok: true, text: 'Merged: you kept the furthest progress from both.' }); }}>Merge with my progress</button>
              <button type="button" className="btn" onClick={() => { replaceProgress(pending); setPending(null); setMessage({ ok: true, text: 'Replaced your progress with the file.' }); }}>Replace my progress</button>
              <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        {message && <p className={message.ok ? styles.okBox : styles.warnBox} role="status">{message.text}</p>}
      </section>

      <section className={styles.panel}>
        <h2>Your machine</h2>
        <p>Some programs behave differently on a 64-bit computer than in your browser. Pick the machine you'll use from Module 3 on, and lessons show the stored results for it.</p>
        <PlatformPicker />
      </section>

      <section className={styles.panel}>
        <h2>Appearance</h2>
        <fieldset className={styles.radioRow}>
          <legend className="visually-hidden">Theme</legend>
          {(['system', 'light', 'dark'] as ThemeChoice[]).map(t => (
            <label key={t}><input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} /> {t === 'system' ? 'Match my system' : t === 'light' ? 'Light' : 'Dark'}</label>
          ))}
        </fieldset>
      </section>

      <section className={styles.panel}>
        <h2>Running programs</h2>
        <p>Your browser supports {mode === 'jspi' ? 'interactive input: programs can wait for you to type, like a terminal.' : mode === 'sab' ? 'interactive input.' : 'pre-filled input only: type what the program should read before you press Run.'}</p>
        <label className={styles.check}>
          <input type="checkbox" checked={Boolean(progress.settings.storedOutputMode)} onChange={e => update(p => { p.settings.storedOutputMode = e.target.checked; })} />
          Low-memory mode: don't download the compiler (≈24 MB); show stored outputs instead.
        </label>
      </section>

      <section className={styles.panel}>
        <h2>Start over</h2>
        <p>Deletes all progress in this browser. Export first if you might want it back.</p>
        <button type="button" className="btn" onClick={() => { if (window.confirm('Delete all progress in this browser? This cannot be undone.')) { replaceProgress(emptyProgress()); setMessage({ ok: true, text: 'Progress reset.' }); } }}>Reset all progress</button>
      </section>
    </div>
  );
}
