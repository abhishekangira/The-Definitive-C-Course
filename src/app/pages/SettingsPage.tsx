import { useRef, useState } from 'react';
import {
  daysSinceExport, emptyProgress, exportFileName, exportProgress, getProgress, MAX_IMPORT_BYTES, mergeProgress, parseProgressFile, replaceProgress, summarise,
  update, useProgress, type ProgressV1,
} from '../../progress/store';
import { useTheme, type ThemeChoice } from '../theme';
import { PlatformPicker } from '../../interactions/PlatformPicker';
import { downloadBlob } from '../../interactions/zip';
import { detectStdinMode } from '../../runtime/CRuntime';
import { Icon } from '../../components/Icon';
import { StreakPet } from '../../components/StreakPet';
import { useNow } from '../../components/StreakChip';
import { dayWord, recentDays, streakStatus } from '../../progress/streak';
import styles from './Pages.module.css';

export function SettingsPage() {
  const progress = useProgress();
  const [theme, setTheme] = useTheme();
  const [pending, setPending] = useState<ProgressV1 | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const days = daysSinceExport(progress);
  const now = useNow();
  const streak = streakStatus(progress.streak, now);
  const week = recentDays(progress.streak, 14, now);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a progress file.');
      const next = parseProgressFile(await f.text());
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

      <section className={styles.panel} id="streak" aria-labelledby="streak-title">
        <h2 id="streak-title">Your streak</h2>
        <StreakPet size={96} />
        <p>
          {streak.state === 'none'
            ? (streak.longest > 0
              ? <>No streak is running. Your longest was <strong>{dayWord(streak.longest)}</strong>. Submit a problem solution or a quiz answer today to start a new one.</>
              : <>It starts the first time you submit a problem solution or answer a quiz question, and grows by one for every day in a row you do it.</>)
            : <>
              <strong data-testid="streak-current">{dayWord(streak.current)}</strong> in a row; your longest is <strong>{dayWord(streak.longest)}</strong>.
              {streak.state === 'active' ? ' You have submitted something today.' : ' Submit a problem solution or a quiz answer today to keep it going.'}
            </>}
        </p>
        <ol className={styles.streakDays} aria-label="The last 14 days">
          {week.map(d => (
            <li key={d.key} className={d.done ? styles.dayDone : styles.dayEmpty}>
              <span className={styles.dayBox} aria-hidden="true">{d.done && <Icon name="flame" />}</span>
              <span className={styles.dayName} aria-hidden="true">{d.weekday.slice(0, 2)}</span>
              <span className="visually-hidden">{`${d.weekday} ${d.key}: ${d.done ? 'submitted' : 'nothing submitted'}`}</span>
            </li>
          ))}
        </ol>
        <p className={styles.muted}>
          A problem check (pass or fail), a quiz answer and a finished checkpoint count. Reading lessons, predictions and the playground don't.
          Days follow this computer's clock and time zone. Ember, the flame pet, is sad without a streak, worried until you submit today, and gets happier at 3, 7 and 30 days in a row.
        </p>
      </section>

      <section className={styles.panel}>
        <h2>Back up your progress</h2>
        <p>Your progress is stored only in this browser ({Object.keys(progress.lessons).length} lessons done). Export it to a file to keep it safe or move to another computer.
          {' '}{days === null ? 'You haven’t exported yet.' : `Last export: ${days === 0 ? 'today' : `${days} days ago`}.`}</p>
        <p className={styles.muted}>Clearing this site's data in your browser erases your progress, so export a backup now and then.</p>
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
