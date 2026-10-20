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
import { SpiritBeans, StreakWarrior, WarriorGallery } from '../../components/StreakWarrior';
import { TutorSettingsPanel } from '../../tutor/TutorSettingsPanel';
import { BeanArt } from '../../components/WarriorArt';
import { useNow } from '../../components/useNow';
import { BEAN_EVERY, dayWord, MAX_BEANS, recentDays, START_BEANS, streakStatus } from '../../progress/streak';
import { FORMS, WARRIOR_NAME } from '../../progress/warrior';
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
  const thresholds = FORMS.slice(1).map(f => f.at);
  const formDays = `${thresholds.slice(0, -1).join(', ')} and ${thresholds[thresholds.length - 1]}`;

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
    <div>
      <header className={styles.pageHead}>
        <h1>Progress &amp; settings</h1>
        <p className={styles.lede}>Your streak, a backup of your progress, and how programs run on this machine. Everything is stored in this browser.</p>
      </header>

      <section className="setting" id="streak" aria-labelledby="streak-title">
        <div className="setting-head">
          <h2 id="streak-title">Your streak</h2>
          <p>
            A problem check (pass or fail), a quiz answer and a finished checkpoint count. Reading lessons, predictions and the playground don't.
            Days follow this computer's clock and time zone. {WARRIOR_NAME} transforms at {formDays} days in a row. A streak that ends sends {WARRIOR_NAME} back
            to the kid, but every form you have reached stays in the gallery.
          </p>
          <p>
            Spirit beans: you start with {START_BEANS === 1 ? 'one' : START_BEANS} and earn one on every {BEAN_EVERY}th day of a streak, up to {MAX_BEANS}.
            A missed day uses a bean instead of ending your streak. A bean is only used up when it saves the streak, and a saved day doesn't add to it.
          </p>
        </div>
        <div className="setting-body">
          <StreakWarrior size={224} />
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
          <SpiritBeans count={streak.beans} saving={streak.gapSaved} />
          <ol className={styles.streakDays} aria-label="The last 14 days">
            {week.map(d => (
              <li key={d.key} className={d.mark === 'done' ? styles.dayDone : d.mark === 'saved' ? styles.daySaved : styles.dayEmpty}>
                <span className={styles.dayBox} aria-hidden="true">{d.mark === 'done' ? <Icon name="flame" /> : d.mark === 'saved' ? <BeanArt className={styles.dayBean} /> : null}</span>
                <span className={styles.dayName} aria-hidden="true">{d.weekday.slice(0, 2)}</span>
                <span className="visually-hidden">{`${d.weekday} ${d.key}: ${d.mark === 'done' ? 'submitted' : d.mark === 'saved' ? 'missed, saved by a spirit bean' : 'nothing submitted'}`}</span>
              </li>
            ))}
          </ol>
          <h3 className={styles.streakSub}>{WARRIOR_NAME}'s forms</h3>
          <WarriorGallery current={streak.current} longest={streak.longest} />
        </div>
      </section>

      <section className="setting" aria-labelledby="backup-title">
        <div className="setting-head">
          <h2 id="backup-title">Back up your progress</h2>
          <p>Clearing this site's data in your browser erases your progress, so export a backup now and then.</p>
        </div>
        <div className="setting-body">
          <p>Your progress is stored only in this browser ({Object.keys(progress.lessons).length} lessons done). Export it to a file to keep it safe or move to another computer.
            {' '}{days === null ? 'You haven’t exported yet.' : `Last export: ${days === 0 ? 'today' : `${days} days ago`}.`}</p>
          <div className={styles.row2}>
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
              <div className={styles.row2}>
                <button type="button" className="btn btn-primary" onClick={() => { replaceProgress(mergeProgress(getProgress(), pending)); setPending(null); setMessage({ ok: true, text: 'Merged: you kept the furthest progress from both.' }); }}>Merge with my progress</button>
                <button type="button" className="btn" onClick={() => { replaceProgress(pending); setPending(null); setMessage({ ok: true, text: 'Replaced your progress with the file.' }); }}>Replace my progress</button>
                <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          )}
          {message && <p className={message.ok ? styles.okBox : styles.warnBox} role="status">{message.text}</p>}
        </div>
      </section>

      <section className="setting" aria-labelledby="machine-title">
        <div className="setting-head">
          <h2 id="machine-title">Your machine</h2>
          <p>Some programs behave differently on a 64-bit computer than in your browser. Pick the machine you'll use from Module 3 on, and lessons show the stored results for it.</p>
        </div>
        <div className="setting-body"><PlatformPicker /></div>
      </section>

      <section className="setting" aria-labelledby="appearance-title">
        <div className="setting-head"><h2 id="appearance-title">Appearance</h2></div>
        <div className="setting-body">
          <fieldset className={styles.radioRow}>
            <legend className="visually-hidden">Theme</legend>
            {(['system', 'light', 'dark'] as ThemeChoice[]).map(t => (
              <label key={t} className={styles.check}><input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} /> {t === 'system' ? 'Match my system' : t === 'light' ? 'Light' : 'Dark'}</label>
            ))}
          </fieldset>
        </div>
      </section>

      <section className="setting" aria-labelledby="running-title">
        <div className="setting-head">
          <h2 id="running-title">Running programs</h2>
          <p>Your browser supports {mode === 'jspi' ? 'interactive input: programs can wait for you to type, like a terminal.' : mode === 'sab' ? 'interactive input.' : 'pre-filled input only: type what the program should read before you press Run.'}</p>
        </div>
        <div className="setting-body">
          <label className={styles.check}>
            <input type="checkbox" checked={Boolean(progress.settings.storedOutputMode)} onChange={e => update(p => { p.settings.storedOutputMode = e.target.checked; })} />
            Low-memory mode: don't download the compiler (≈24 MB); show stored outputs instead.
          </label>
        </div>
      </section>

      <TutorSettingsPanel />

      <section className="setting" aria-labelledby="reset-title">
        <div className="setting-head">
          <h2 id="reset-title">Start over</h2>
          <p>Deletes all progress in this browser. Export first if you might want it back.</p>
        </div>
        <div className="setting-body">
          <div><button type="button" className={`btn ${styles.danger}`} onClick={() => { if (window.confirm('Delete all progress in this browser? This cannot be undone.')) { replaceProgress(emptyProgress()); setMessage({ ok: true, text: 'Progress reset.' }); } }}>Reset all progress</button></div>
        </div>
      </section>
    </div>
  );
}
