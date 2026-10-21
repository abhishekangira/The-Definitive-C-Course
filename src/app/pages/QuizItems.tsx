// Quiz items that read generated data beyond a sample's output: `sp` (a gdb trace) and the native-session parts of `ce`
// and `order` (docs/adr/0005-native-sessions.md). Grading lives in src/interactions/quiz-answers.ts.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TraceFile } from '../../content-model/types';
import type { QuizItem } from '../../content-runtime/course';
import { traceFor } from '../../content-runtime/course';
import { CodeListing } from '../../components/CodeListing';
import { Mark } from '../../components/Icon';
import { MiniMarkdown } from '../../components/MiniMarkdown';
import { seededShuffle } from '../../interactions/hash';
import { callStack, spStackOptions, spSteps, type Frames, type SpStackKey } from '../../interactions/quiz-answers';
import ix from '../../interactions/Interaction.module.css';
import styles from './Pages.module.css';

type Result = { correct: boolean; given?: unknown };

/** A call stack as gdb's `bt` lists it: innermost frame first, numbered from #0. */
const StackLines = ({ frames }: { frames: Frames }) => (
  <span className={styles.stackList}>{frames.map((f, i) => <span key={i}><code>#{i}</code> <code>{f.func}</code>, line {f.line}</span>)}</span>
);

/**
 * sp: paused before `line` in a gdb trace. Part 1: the line one `step` later (click it). Part 2: the call stack after
 * that step, out of three from the trace (after `step`, before it, after `next`). Both parts must be right.
 */
export function SpItem({ item, head, feedback, result, onResult }: { item: QuizItem; head: ReactNode; feedback: ReactNode; result?: Result; onResult: (r: Result) => void }) {
  const [trace, setTrace] = useState<TraceFile | null | undefined>(undefined);
  const [pick, setPick] = useState<number | null>(null);
  const [stackPick, setStackPick] = useState<SpStackKey | null>(null);
  useEffect(() => { void traceFor(item.sample ?? '').then(setTrace); }, [item.sample]);
  const at = trace && item.line ? spSteps(trace, item.line) : null;
  const options = useMemo(() => {
    const o = trace && item.line ? spStackOptions(trace, item.line) : null;
    return o && seededShuffle(o, item.id);
  }, [trace, item.line, item.id]);
  const lineRight = Boolean(at) && pick === at!.next.line;
  const body = trace === undefined ? <p className={ix.muted}>Loading the trace…</p>
    : !at ? <p className={ix.warn} role="alert">No trace for <code>{item.sample}</code> with a step after line {item.line} (run <code>npm run trace</code>).</p>
    : !options ? <p className={ix.warn} role="alert">Line {item.line} of <code>{item.sample}</code> calls no function, so the stack after <code>step</code> has nothing to tell apart (lint reports this item).</p>
    : (
      <>
        <CodeListing code={trace!.source} current={at.now.line} label={`Program for question ${item.id}`} onPick={result ? undefined : setPick} picked={pick} pickCorrect={result ? lineRight : null} />
        <div>
          <p className={ix.muted}>Paused before line {at.now.line}. The call stack (innermost first, as gdb&apos;s <code>bt</code> lists it):</p>
          <StackLines frames={callStack(at.now)} />
        </div>
        <form className={ix.predict} onSubmit={e => { e.preventDefault(); if (!result && pick !== null && stackPick) onResult({ correct: lineRight && stackPick === 'step', given: [pick, stackPick] }); }}>
          <p className={ix.prompt} data-question="line">1. After one <code>step</code>, which line is about to run? Click it in the program.</p>
          <fieldset className={ix.choices} data-question="stack">
            <legend>2. After that <code>step</code>, what does <code>bt</code> show?</legend>
            {options.map(o => (
              <label key={o.key} className={ix.choice} data-stack={result ? (o.key === 'step' ? 'right' : o.key === stackPick ? 'wrong' : undefined) : undefined}>
                <input type="radio" name={`${item.id}-stack`} checked={stackPick === o.key} onChange={() => setStackPick(o.key)} disabled={Boolean(result)} />
                <StackLines frames={o.frames} />
                {result && (o.key === 'step' || o.key === stackPick) && <><Mark ok={o.key === 'step'} /><span className="visually-hidden">{o.key === 'step' ? ' (the stack after step)' : ' (your answer)'}</span></>}
              </label>
            ))}
          </fieldset>
          {!result && <div className={ix.actions}><button type="submit" className="btn btn-primary" disabled={pick === null || !stackPick}>Submit answer</button></div>}
        </form>
        {result && (
          <ul className={styles.stackList} data-parts>
            <li data-line-right={String(lineRight)}><Mark ok={lineRight} /> 1. Line {at.next.line} is about to run{lineRight ? '.' : `, not line ${pick}.`}</li>
            <li data-stack-right={String(stackPick === 'step')}><Mark ok={stackPick === 'step'} /> 2. {stackPick === 'step' ? 'That is the stack after step.' : stackPick === 'next' ? 'That is the stack after next, which runs the whole call.' : 'That is the stack before the step.'}</li>
          </ul>
        )}
      </>
    );
  return (
    <div className={styles.quizItem} data-quiz-item={item.id} data-sample={item.sample} data-line={item.line}>
      {head}<MiniMarkdown text={item.prompt} />{body}{feedback}
    </div>
  );
}
