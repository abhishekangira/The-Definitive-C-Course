// LT: work done on the learner's own machine (debugger, sanitizers, Make, POSIX, native projects).
// Download the starter (with the learner's seed), run `make test`, paste the code it prints.
import { useState } from 'react';
import type { ExerciseEntry } from '../content-runtime/course';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { useCardDone } from '../lesson/LessonContext';
import { update, useProgress } from '../progress/store';
import { parseCode, verifyCode } from '../testing/token';
import { useFolder } from './Exercise';
import { useExerciseProgress } from './useExerciseProgress';
import { Hints } from './ExerciseParts';
import { buildZip, downloadBlob } from './zip';
import styles from './Interaction.module.css';

export function LocalTask({ entry, onPassed, projectId }: { entry: ExerciseEntry; onPassed?: () => void; projectId?: string }) {
  const files = useFolder(entry);
  const progress = useProgress();
  const markDone = useCardDone();
  const { ep, viewHint, patch } = useExerciseProgress(entry.id);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const name = entry.id.split('/').pop() ?? entry.id;

  const download = async () => {
    if (!files) return;
    downloadBlob(await buildZip({ name, files, exerciseId: entry.id, seed: progress.seed }), `${name}.zip`);
  };

  const submit = async () => {
    const parsed = parseCode(code);
    if (!parsed) { setMsg({ ok: false, text: 'That doesn’t look like a code from check.mjs (it starts with TDCC).' }); return; }
    const v = await verifyCode(parsed, { seed: progress.seed, exercise: entry.id });
    if (!v.valid) { setMsg({ ok: false, text: v.reason ?? 'This code doesn’t match your progress file (was the project downloaded from this browser?).' }); return; }
    patch(e => {
      e.codes = [...new Set([...(e.codes ?? []), code.trim()])];
      e.attempts = Math.max(e.attempts, v.run ?? e.attempts + 1);
      e.substantive = Math.max(e.substantive, e.codes.length);
      if (v.complete) { e.passed = true; if (!e.solutionViewed) e.mastered = true; }
    });
    if (v.complete) {
      if (projectId) update(p => { p.projects[projectId] = { passed: true, at: new Date().toISOString(), token: code.trim() }; });
      setMsg({ ok: true, text: 'Completion token accepted: all checks passed on your machine.' });
      markDone();
      onPassed?.();
    } else {
      setMsg({ ok: false, text: `Progress code accepted (${v.passedCount ?? '?'} of ${v.total ?? '?'} checks passing). Keep going and paste the final token.` });
    }
  };

  return (
    <div className={styles.box} data-interaction="lt" data-exercise={entry.id}>
      <div className={styles.kicker}>On your machine</div>
      <h3 className={styles.heading}>{entry.meta.title}</h3>
      <MiniMarkdown text={entry.meta.prompt} className={styles.prompt} />
      <ol>
        <li><button type="button" className="btn btn-sm" onClick={download} disabled={!files}>Download {name}.zip</button> and unzip it.</li>
        <li>In a terminal in that folder run <code>make test</code> (or <code>node check.mjs</code>).</li>
        <li>Paste the code it prints at the end:</li>
      </ol>
      <form className={styles.actions} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label className="visually-hidden" htmlFor={`lt-${entry.id}`}>Code printed by check.mjs</label>
        <input id={`lt-${entry.id}`} className={styles.mono} value={code} onChange={e => setCode(e.target.value)} placeholder="TDCC1-…" spellCheck={false}
          style={{ flex: 1, minWidth: '16ch', padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)' }} />
        <button type="submit" className="btn btn-primary" disabled={!code.trim()}>Submit</button>
      </form>
      {msg && <div className={msg.ok ? styles.good : styles.note} role="status">{msg.text}</div>}
      {ep.passed && <span className="badge badge-ok">Done</span>}
      <Hints hints={entry.meta.hints} viewed={ep.hintsViewed} onView={viewHint} />
      <p className={styles.muted}>Codes are tamper-evident, not tamper-proof: there is no server, so this works on the honour system.</p>
    </div>
  );
}
