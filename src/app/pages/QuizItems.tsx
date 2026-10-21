// Quiz items that read generated data beyond a sample's output: `sp` (a gdb trace) and the native-session parts of `ce`
// and `order` (docs/adr/0005-native-sessions.md). Grading lives in src/interactions/quiz-answers.ts.
import { useEffect, useState, type ReactNode } from 'react';
import type { TraceFile } from '../../content-model/types';
import type { QuizItem } from '../../content-runtime/course';
import { traceFor } from '../../content-runtime/course';
import { CodeListing } from '../../components/CodeListing';
import { MiniMarkdown } from '../../components/MiniMarkdown';
import { callStack, spSteps } from '../../interactions/quiz-answers';
import ix from '../../interactions/Interaction.module.css';
import styles from './Pages.module.css';

type Result = { correct: boolean; given?: unknown };

function Stack({ frames, label }: { frames: Array<{ func: string; line: number }>; label: string }) {
  return (
    <div>
      <p className={ix.muted}>{label}</p>
      <ul className={styles.stackList}>
        {frames.map((f, i) => <li key={i}><code>#{i}</code> <code>{f.func}</code>, line {f.line}</li>)}
      </ul>
    </div>
  );
}

/** sp: paused before `line` in a gdb trace; the learner predicts the line one `step` later. */
export function SpItem({ item, head, feedback, result, onResult }: { item: QuizItem; head: ReactNode; feedback: ReactNode; result?: Result; onResult: (r: Result) => void }) {
  const [trace, setTrace] = useState<TraceFile | null | undefined>(undefined);
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => { void traceFor(item.sample ?? '').then(setTrace); }, [item.sample]);
  const at = trace && item.line ? spSteps(trace, item.line) : null;
  const body = trace === undefined ? <p className={ix.muted}>Loading the trace…</p>
    : !at ? <p className={ix.warn} role="alert">No trace for <code>{item.sample}</code> with a step after line {item.line} (run <code>npm run trace</code>).</p>
    : (
      <>
        <CodeListing code={trace!.source} current={at.now.line} label={`Program for question ${item.id}`} onPick={result ? undefined : setPick} picked={pick} pickCorrect={result ? result.correct : null} />
        <Stack frames={callStack(at.now)} label={`Paused before line ${at.now.line}. The call stack (innermost first, as gdb's bt lists it):`} />
        <form className={ix.predict} onSubmit={e => { e.preventDefault(); if (!result && pick !== null) onResult({ correct: pick === at.next.line, given: pick }); }}>
          <p className={ix.prompt}>After one <code>step</code>, which line is about to run? Click it in the program.</p>
          {!result && <div className={ix.actions}><button type="submit" className="btn btn-primary" disabled={pick === null}>Submit answer</button></div>}
        </form>
        {result && <Stack frames={callStack(at.next)} label={`After step: line ${at.next.line} is about to run. The call stack:`} />}
      </>
    );
  return (
    <div className={styles.quizItem} data-quiz-item={item.id} data-sample={item.sample} data-line={item.line}>
      {head}<MiniMarkdown text={item.prompt} />{body}{feedback}
    </div>
  );
}
