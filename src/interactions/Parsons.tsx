// PA: Parsons problem. Build the program from scrambled lines (some are distractors), then the
// assembled program is compiled and tested, so any correct ordering passes.
import { useMemo, useState } from 'react';
import type { ExerciseEntry } from '../content-runtime/course';
import type { TestsSpec } from '../content-model/types';
import { runTests, type TestResult } from '../testing/runner';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { useProgress } from '../progress/store';
import { browserExec } from './exec-browser';
import { seededShuffle } from './hash';
import { useExerciseProgress } from './useExerciseProgress';
import { GiveUp, Hints, TestResults, type AssessmentProps } from './ExerciseParts';
import { ExerciseTutor } from '../tutor/TutorPanel';
import type { TutorCheckSnapshot } from '../tutor/eligibility';
import { Icon } from '../components/Icon';
import styles from './Interaction.module.css';
import ps from './Parsons.module.css';

interface Block { key: string; text: string; indent: number }

export function Parsons({ entry, files, spec, fileName, isVariant, parentId, onPassed, assessment, onGiveUp, allowTutor = true }: {
  entry: ExerciseEntry; files: Record<string, string>; spec: TestsSpec; fileName: string; isVariant: boolean; parentId?: string; onPassed: () => void; allowTutor?: boolean;
} & AssessmentProps) {
  const progress = useProgress();
  const indentMode = entry.meta.parsons?.indent ?? false;
  const pool = useMemo<Block[]>(() => {
    const lines = (files['solution.c'] ?? '').split('\n').filter(l => l.trim() !== '');
    const all = [...lines, ...(entry.meta.parsons?.distractors ?? [])];
    const blocks = all.map((l, i) => ({ key: `b${i}`, text: indentMode ? l.trim() : l, indent: 0 }));
    return seededShuffle(blocks, `${progress.seed}:${entry.id}`);
  }, [files, entry, indentMode, progress.seed]);
  const [placed, setPlaced] = useState<Block[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [diag, setDiag] = useState<{ raw: string } | null>(null);
  const [snapshot, setSnapshot] = useState<TutorCheckSnapshot | null>(null);
  const [checking, setChecking] = useState(false);
  const [passedNow, setPassedNow] = useState(false);
  const { ep, recordAttempt, recordTutorAsk, viewHint } = useExerciseProgress(entry.id, parentId);
  const bank = pool.filter(b => !placed.some(p => p.key === b.key));

  const move = (i: number, d: -1 | 1) => setPlaced(p => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const indent = (i: number, d: -1 | 1) => setPlaced(p => p.map((b, k) => (k === i ? { ...b, indent: Math.max(0, Math.min(6, b.indent + d)) } : b)));
  const program = placed.map(b => (indentMode ? '    '.repeat(b.indent) : '') + b.text).join('\n') + '\n';

  const check = async () => {
    setChecking(true);
    const report = await runTests(spec, { [fileName]: program }, {}, browserExec);
    setChecking(false);
    setResults(report.results);
    setDiag(report.compile.ok ? null : { raw: report.compile.raw });
    const passed = report.allPassed;
    setSnapshot({ code: program, results: report.results, diagnostics: report.compile.raw, failed: !passed });
    recordAttempt(program, passed);
    if (passed) { setPassedNow(true); onPassed(); }
  };

  return (
    <div className={styles.box} data-interaction="parsons" data-exercise={entry.id}>
      <div className={styles.kicker}>Put the lines in order{isVariant ? ' · variant' : ''}</div>
      <h3 className={styles.heading}>{entry.meta.title}</h3>
      <MiniMarkdown text={entry.meta.prompt} className={styles.prompt} />
      <p className={styles.muted}>Some lines are distractors and don't belong. Keyboard: Tab to a line, then use its buttons.{indentMode ? ' Indentation matters here.' : ''}</p>
      <div className={ps.columns}>
        <section aria-label="Available lines">
          <h4 className={ps.colHead}>Available lines ({bank.length})</h4>
          <ul className={ps.list}>
            {bank.map(b => (
              <li key={b.key} className={ps.block}>
                <code className={ps.code}>{b.text}</code>
                <button type="button" className="btn btn-sm" onClick={() => setPlaced(p => [...p, b])} aria-label={`Add line: ${b.text.trim()}`}>Add <Icon name="arrow-right" /></button>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Your program">
          <h4 className={ps.colHead}>Your program ({placed.length} lines)</h4>
          <ol className={ps.list}>
            {placed.map((b, i) => (
              <li key={b.key} className={ps.block}>
                <code className={ps.code} style={{ paddingLeft: `${b.indent * 2}ch` }}>{b.text}</code>
                <span className={ps.tools}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move up: ${b.text.trim()}`}><Icon name="arrow-up" /></button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} disabled={i === placed.length - 1} aria-label={`Move down: ${b.text.trim()}`}><Icon name="arrow-down" /></button>
                  {indentMode && <button type="button" className="btn btn-sm btn-ghost" onClick={() => indent(i, -1)} aria-label={`Outdent: ${b.text.trim()}`}><Icon name="outdent" /></button>}
                  {indentMode && <button type="button" className="btn btn-sm btn-ghost" onClick={() => indent(i, 1)} aria-label={`Indent: ${b.text.trim()}`}><Icon name="indent" /></button>}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPlaced(p => p.filter(x => x.key !== b.key))} aria-label={`Remove: ${b.text.trim()}`}><Icon name="cross" /></button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={check} disabled={checking || placed.length === 0}>{checking ? 'Compiling and testing…' : 'Compile and test my program'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setPlaced([]); setResults([]); setSnapshot(null); }}>Start over</button>
        {assessment ? <GiveUp onGiveUp={onGiveUp} disabled={passedNow} /> : ep.passed && <span className="badge badge-ok">Passed</span>}
      </div>
      {diag && <DiagnosticsList diagnostics={[]} raw={diag.raw} />}
      <TestResults results={results} hideHints={assessment} />
      {!assessment && <Hints hints={entry.meta.hints} viewed={ep.hintsViewed} onView={viewHint} maxTier={isVariant ? 2 : 3} />}
      {!assessment && (
        <ExerciseTutor
          id={entry.id} kind={entry.meta.kind} runsIn={entry.meta.runsIn} title={entry.meta.title} statement={entry.meta.prompt}
          hints={entry.meta.hints} hintsViewed={ep.hintsViewed} solution={files['solution.c'] ?? ''} substantive={ep.substantive}
          assessment={false} isVariant={isVariant} allowTutor={allowTutor} currentCode={program} snapshot={snapshot} bank={pool.map(b => b.text).join('\n')} onAsked={recordTutorAsk} />
      )}
    </div>
  );
}
