// V3 Stack/Heap Stepper (SP). Steps through a trace pre-recorded by gdb on x86-64 Linux.
// In predict mode the learner clicks the line they expect to run next before each interesting step.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TraceFile, TraceStep } from '../content-model/types';
import { traceFor } from '../content-runtime/course';
import { CodeListing } from '../components/CodeListing';
import { useCardDone } from '../lesson/LessonContext';
import { nestedSample } from '../interactions/nested';
import { formatValue, isInterestingTransition } from './trace-format';
import styles from './Stepper.module.css';
import ix from '../interactions/Interaction.module.css';

export function Stepper({ sample, children, predict = true, maxPredictions = 4, showAddresses = false }: {
  sample?: string;
  children?: ReactNode;
  predict?: boolean;
  /** How many "which line next?" questions to ask before free stepping. */
  maxPredictions?: number;
  showAddresses?: boolean;
}) {
  const nested = nestedSample(children);
  const id = nested?.id ?? sample ?? '';
  const [trace, setTrace] = useState<TraceFile | null | undefined>(undefined);
  const [i, setI] = useState(0);
  const [guess, setGuess] = useState<number | null>(null);
  const [asked, setAsked] = useState(0);
  const [score, setScore] = useState(0);
  const [addr, setAddr] = useState(showAddresses);
  const markDone = useCardDone();

  useEffect(() => { void traceFor(id).then(t => setTrace(t)); }, [id]);
  const steps = trace?.steps ?? [];
  const step: TraceStep | undefined = steps[i];
  const next: TraceStep | undefined = steps[i + 1];
  const mustPredict = predict && next && asked < maxPredictions && isInterestingTransition(step!, next) && guess === null;
  const atEnd = i >= steps.length - 1;

  useEffect(() => { if (atEnd && steps.length) markDone(); }, [atEnd, steps.length, markDone]);

  const advance = () => { setGuess(null); setI(x => Math.min(x + 1, steps.length - 1)); };
  const onPick = (line: number) => {
    if (!next || guess !== null) return;
    setGuess(line);
    setAsked(a => a + 1);
    if (line === next.line) setScore(s => s + 1);
  };

  const heapLive = useMemo(() => step?.heap.filter(h => !h.freed) ?? [], [step]);
  if (trace === undefined) return <div className={ix.box}>Loading the trace…</div>;
  if (trace === null || !step) return <p className={ix.warn} role="alert">No trace for <code>{id}</code> yet (run <code>npm run trace</code>).</p>;

  return (
    <div className={ix.box} data-interaction="stepper" data-sample={id}
      onKeyDown={e => { if (e.key === 'ArrowRight' && !mustPredict) advance(); if (e.key === 'ArrowLeft') { setGuess(null); setI(x => Math.max(0, x - 1)); } }}>
      <div className={ix.kicker}>Step through memory {predict ? '· predict each jump' : ''}</div>
      <div className={styles.layout}>
        <div>
          <CodeListing
            code={trace.source}
            current={step.line}
            label="Program"
            onPick={mustPredict ? onPick : undefined}
            picked={guess}
            pickCorrect={guess === null ? null : guess === next?.line}
          />
          <div className={styles.controls}>
            <button type="button" className="btn btn-sm" onClick={() => { setGuess(null); setI(0); }} disabled={i === 0}>⟲ Restart</button>
            <button type="button" className="btn btn-sm" onClick={() => { setGuess(null); setI(x => Math.max(0, x - 1)); }} disabled={i === 0}>← Back</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={advance} disabled={atEnd || Boolean(mustPredict)}>Step →</button>
            <span className={styles.counter} aria-live="polite">Step {i + 1} of {steps.length}{trace.truncated ? ' (trace truncated)' : ''}</span>
          </div>
          {mustPredict && <p className={styles.prompt}>Before you step: <strong>which line runs next?</strong> Click it in the code.</p>}
          {guess !== null && next && (
            <p className={guess === next.line ? ix.goodText : ix.badText} role="status">
              {guess === next.line ? '✓ Right.' : `✗ Line ${next.line} runs next.`} {next.event === 'call' ? 'A function call pushes a new frame.' : next.stack.length < step.stack.length ? 'The function returns and its frame is popped.' : ''}
            </p>
          )}
          {asked > 0 && <p className={ix.muted}>Predictions: {score} of {asked} right.</p>}
        </div>
        <div className={styles.memory} aria-label="Memory at this step">
          <div className={styles.memHead}>
            <span>Stack <span className={ix.muted}>(newest frame on top)</span></span>
            <label className={styles.toggle}><input type="checkbox" checked={addr} onChange={e => setAddr(e.target.checked)} /> addresses</label>
          </div>
          {[...step.stack].reverse().map((f, k) => (
            <div key={`${f.func}-${k}`} className={`${styles.frame} ${k === 0 ? styles.top : ''}`}>
              <div className={styles.frameName}>{f.func}()</div>
              <table className={styles.vars}>
                <tbody>
                  {f.vars.length === 0 && <tr><td className={ix.muted} colSpan={3}>(no local variables)</td></tr>}
                  {f.vars.map(v => (
                    <tr key={v.name} className={v.declared === false ? styles.undeclared : undefined}>
                      <th scope="row"><code>{v.type} {v.name}</code></th>
                      <td><code>{v.declared === false ? '(not yet initialised)' : formatValue(v.value, { addresses: addr })}</code></td>
                      {addr && <td className={styles.addr}><code>{v.addr}</code></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {step.globals.length > 0 && (
            <div className={styles.section}>
              <div className={styles.memHead}>Globals &amp; statics</div>
              {step.globals.map(g => <div key={g.name}><code>{g.type} {g.name} = {formatValue(g.value, { addresses: addr })}</code></div>)}
            </div>
          )}
          <div className={styles.section}>
            <div className={styles.memHead}>Heap</div>
            {heapLive.length === 0 ? <div className={ix.muted}>(nothing allocated)</div> : heapLive.map(h => (
              <div key={h.id} className={`${styles.block} ${h.unreferenced ? styles.leak : ''}`}>
                <strong>#{h.id}</strong> <code>{h.type ?? 'bytes'}</code> · {h.size} bytes {h.unreferenced && <span className="badge badge-err">leaked: nothing points here</span>}
                {h.value && <div><code>{formatValue(h.value, { addresses: addr })}</code></div>}
                {addr && <div className={styles.addr}><code>{h.addr}</code></div>}
              </div>
            ))}
          </div>
          <div className={styles.section}>
            <div className={styles.memHead}>Output so far</div>
            <pre className={styles.stdout}>{step.stdout || ' '}</pre>
          </div>
          <p className={styles.platform}>Recorded on x86-64 Linux (gcc). Sizes and addresses differ in your browser (wasm32).</p>
        </div>
      </div>
    </div>
  );
}
