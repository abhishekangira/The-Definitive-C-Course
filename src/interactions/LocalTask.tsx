// LT: work done on the learner's own machine. Download the starter (with the learner's seed),
// run `make test`, paste the code it prints. The solution gate is the same as a browser exercise.
// Attempts are distinct pasted progress codes. Viewing the solution assigns a variant: a second
// zip and a second code, with hints 1–2 only and no solution.
import { useState } from 'react';
import { exercises, type ExerciseEntry } from '../content-runtime/course';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { useCardDone } from '../lesson/LessonContext';
import { update, useProgress } from '../progress/store';
import { formatCode, verifyCode } from '../testing/token';
import { useFolder } from './Exercise';
import { useExerciseProgress } from './useExerciseProgress';
import { GiveUp, Hints, SolutionGatePanel } from './ExerciseParts';
import { buildZip, downloadBlob } from './zip';
import styles from './Interaction.module.css';

export function LocalTask({ entry, onPassed, projectId, assessment, onGiveUp, parentId }: {
  entry: ExerciseEntry;
  onPassed?: () => void;
  projectId?: string;
  assessment?: boolean;
  onGiveUp?: () => void;
  /** Set when this task is the variant assigned after the parent solution was viewed. */
  parentId?: string;
}) {
  const files = useFolder(entry);
  const progress = useProgress();
  const markDone = useCardDone();
  const { ep, viewHint, viewSolution, assignVariant, recordLocalCode } = useExerciseProgress(entry.id, parentId);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isVariant = Boolean(parentId);
  const name = entry.id.split('/').pop() ?? entry.id;
  const variants = entry.meta.variants ?? [];
  // Native projects keep today's download-and-paste flow. Only an LT exercise reveals a solution.
  const offerSolution = entry.meta.kind === 'lt' && !projectId;
  const variantEntry = !isVariant && ep.solutionViewed && ep.variant ? exercises[`${entry.id}/variants/${ep.variant}`] : undefined;

  const download = async () => {
    if (!files) return;
    downloadBlob(await buildZip({ exerciseId: entry.id, title: entry.meta.title, prompt: entry.meta.prompt, files, seed: progress.seed }), `${name}.zip`);
  };

  const submit = async () => {
    const v = await verifyCode(code, progress.seed, { exercise: entry.id });
    if (!v.ok) { setMsg({ ok: false, text: v.message }); return; }
    const canonical = formatCode(v.code); // never store the pasted text: it may be huge or carry other content
    const complete = v.code.type === 'completion';
    const run = v.code.type === 'progress' ? v.code.run : undefined;
    recordLocalCode(canonical, { complete, run });
    if (complete) {
      if (projectId) update(p => { p.projects[projectId] = { passed: true, at: new Date().toISOString(), token: canonical }; });
      setMsg({ ok: true, text: 'Completion token accepted: all checks passed on your machine.' });
      markDone();
      onPassed?.();
    } else {
      setMsg({ ok: false, text: `Progress code accepted (${v.passed ?? '?'} of ${v.total ?? '?'} checks passing). Keep going and paste the final token.` });
    }
  };

  return (
    <>
      <div className={styles.box} data-interaction="lt" data-exercise={entry.id}>
        <div className={styles.kicker}>On your machine{isVariant ? ' · variant' : ''}</div>
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
        {assessment ? <GiveUp onGiveUp={onGiveUp} disabled={ep.passed} /> : ep.passed && <span className="badge badge-ok">Done</span>}
        {!assessment && <Hints hints={entry.meta.hints} viewed={ep.hintsViewed} onView={viewHint} maxTier={isVariant ? 2 : 3} />}
        {!assessment && offerSolution && (
          <SolutionGatePanel ep={ep} isVariant={isVariant} solution={files?.['solution.c']} fileName={entry.meta.file ?? 'main.c'}
            onView={viewSolution} onVariant={() => assignVariant(variants)} hasVariants={variants.length > 0} attempts="codes" />
        )}
        <p className={styles.muted}>Codes are tamper-evident, not tamper-proof: there is no server, so this works on the honour system.</p>
      </div>
      {variantEntry && (
        <div className={styles.note}>
          <strong>Variant: solve this one on your own.</strong>
          <LocalTask key={variantEntry.id} entry={variantEntry} parentId={entry.id} />
        </div>
      )}
    </>
  );
}
