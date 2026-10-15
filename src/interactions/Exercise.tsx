// <Exercise id> — CT (write code), FB (fix the bug), PA (Parsons) and LT (local task) exercises.
import { useEffect, useMemo, useState } from 'react';
import { exercises, folderFiles, isSupportFile, starterOf, type ExerciseEntry } from '../content-runtime/course';
import type { TestsSpec } from '../content-model/types';
import { runTests, type TestResult } from '../testing/runner';
import { CodeEditor } from '../components/CodeEditor';
import { Terminal } from '../components/Terminal';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { useCRun } from '../runtime/useCRun';
import { useCardDone } from '../lesson/LessonContext';
import { useProgress } from '../progress/store';
import { browserExec } from './exec-browser';
import { useExerciseProgress } from './useExerciseProgress';
import { GiveUp, Hints, SolutionGatePanel, TestResults, type AssessmentProps } from './ExerciseParts';
import { Parsons } from './Parsons';
import { LocalTask } from './LocalTask';
import styles from './Interaction.module.css';

const KIND_LABEL = { ct: 'Write the code', fb: 'Fix the bug', pa: 'Put the lines in order', lt: 'On your machine' } as const;

export function useFolder(entry: ExerciseEntry | undefined) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!entry) return;
    let live = true;
    void folderFiles(entry.moduleId, entry.folder).then(f => { if (live) setFiles(f); });
    return () => { live = false; };
  }, [entry]);
  return files;
}

export function Exercise({ id, onPassed, assessment, onGiveUp }: { id: string; onPassed?: () => void } & AssessmentProps) {
  const entry = exercises[id];
  if (!entry) return <p className={styles.warn} role="alert">Unknown exercise “{id}”.</p>;
  if (entry.meta.kind === 'lt') return <LocalTask entry={entry} onPassed={onPassed} />;
  if (assessment) return <BrowserExercise entry={entry} onPassed={onPassed} assessment onGiveUp={onGiveUp} />;
  return <ExerciseWithVariants entry={entry} onPassed={onPassed} />;
}

function ExerciseWithVariants({ entry, onPassed }: { entry: ExerciseEntry; onPassed?: () => void }) {
  const progress = useProgress();
  const ep = progress.exercises[entry.id];
  const variantId = ep?.solutionViewed && ep.variant ? `${entry.id}/variants/${ep.variant}` : null;
  const variant = variantId ? exercises[variantId] : undefined;
  return (
    <>
      <BrowserExercise entry={entry} onPassed={onPassed} />
      {variant && (
        <div className={styles.note}>
          <strong>Variant: solve this one on your own.</strong>
          <BrowserExercise key={variant.id} entry={variant} parentId={entry.id} />
        </div>
      )}
    </>
  );
}

function BrowserExercise({ entry, parentId, onPassed, assessment, onGiveUp }: { entry: ExerciseEntry; parentId?: string; onPassed?: () => void } & AssessmentProps) {
  const files = useFolder(entry);
  const spec: TestsSpec | null = useMemo(() => {
    const text = files?.['tests.json'] ?? files?.['check.json'];
    return text ? (JSON.parse(text) as TestsSpec) : null;
  }, [files]);
  const fileName = spec?.sources[0] ?? entry.meta.file ?? 'main.c';
  const isVariant = Boolean(parentId);
  const { ep, touch, recordAttempt, viewHint, viewSolution, assignVariant } = useExerciseProgress(entry.id, parentId);
  const markDone = useCardDone();
  const runner = useCRun();
  const [code, setCode] = useState<string | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [stdin, setStdin] = useState(entry.meta.sampleStdin ?? '');

  useEffect(() => {
    if (files && spec && code === null) setCode((assessment ? undefined : ep.code) ?? starterOf(files, spec.sources[0]));
  }, [files, spec, code, ep.code, assessment]);
  const [passedNow, setPassedNow] = useState(false);

  if (!files || !spec || code === null) return <div className={styles.box}>Loading exercise…</div>;

  // Tests may compile harnesses from tests/; those are passed separately by the runner.
  const supportFiles = Object.fromEntries(Object.entries(files).filter(([k]) => isSupportFile(k) || k.startsWith('tests/')));
  const check = async () => {
    setChecking(true);
    const res = await runTests(spec, { [fileName]: code }, supportFiles, browserExec);
    setChecking(false);
    setResults(res);
    const passed = res.length > 0 && res.every(r => r.status === 'pass');
    recordAttempt(code, passed);
    if (passed) { setPassedNow(true); markDone(); onPassed?.(); }
  };

  if (entry.meta.kind === 'pa') {
    return <Parsons entry={entry} files={files} spec={spec} fileName={fileName} isVariant={isVariant} parentId={parentId} assessment={assessment} onGiveUp={onGiveUp} onPassed={() => { markDone(); onPassed?.(); }} />;
  }

  return (
    <div className={styles.box} data-interaction={entry.meta.kind} data-exercise={entry.id}>
      <div className={styles.kicker}>{KIND_LABEL[entry.meta.kind]}{isVariant ? ' · variant' : ''}</div>
      <h3 className={styles.heading}>{entry.meta.title}</h3>
      <MiniMarkdown text={entry.meta.prompt} className={styles.prompt} />
      <CodeEditor value={code} onChange={v => { setCode(v); if (!assessment) touch(v); }} label={`${entry.meta.title}: ${fileName}`} fileName={fileName} diagnostics={runner.diagnostics} minLines={8} />
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check my code'}</button>
        <button type="button" className="btn" onClick={() => void runner.run({ files: { ...supportFiles, [fileName]: code }, sources: spec.sources, stdin: stdin || undefined })}
          disabled={runner.phase === 'compiling' || runner.phase === 'running'}>Run</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setCode(starterOf(files, fileName)); setResults([]); }}>Reset</button>
        {assessment ? <GiveUp onGiveUp={onGiveUp} disabled={passedNow} /> : ep.passed && <span className="badge badge-ok">Passed</span>}
      </div>
      <details className={styles.muted}>
        <summary>Input for Run (optional)</summary>
        <textarea className={styles.mono} value={stdin} onChange={e => setStdin(e.target.value)} rows={3} aria-label="Standard input for Run" style={{ width: '100%' }} />
        <span>Leave empty to type input interactively while the program runs.</span>
      </details>
      {runner.phase !== 'idle' && (
        <>
          <DiagnosticsList diagnostics={runner.diagnostics} raw={runner.rawDiagnostics} />
          <Terminal segments={runner.segments} phase={runner.phase} result={runner.result} onInput={runner.sendInput} onEOF={runner.sendEOF} onStop={runner.stop} />
        </>
      )}
      <TestResults results={results} hideHints={assessment} />
      {!assessment && (
        <>
          <Hints hints={entry.meta.hints} viewed={ep.hintsViewed} onView={viewHint} maxTier={isVariant ? 2 : 3} />
          <SolutionGatePanel ep={ep} isVariant={isVariant} solution={files['solution.c']} fileName={fileName}
            onView={viewSolution} onVariant={() => assignVariant(entry.meta.variants)} hasVariants={entry.meta.variants.length > 0} />
        </>
      )}
    </div>
  );
}
