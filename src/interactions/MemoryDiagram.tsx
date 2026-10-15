// MD: fill in a memory diagram at one moment of a program (stack frames, values, pointer arrows).
// The answers come from the gdb trace of the sample (x86-64 Linux), so they are real.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TraceFile, TraceVar } from '../content-model/types';
import { traceFor } from '../content-runtime/course';
import { CodeListing } from '../components/CodeListing';
import { useCardDone } from '../lesson/LessonContext';
import { nestedSample } from './nested';
import { formatValue, findVar } from '../visualizers/trace-format';
import { correctAnswer, pickStep } from './memory-answers';
import styles from './Interaction.module.css';
import ms from './MemoryDiagram.module.css';

function matches(v: TraceVar, given: string): boolean {
  const g = given.trim().replace(/\s+/g, ' ');
  const want = correctAnswer(v);
  if (v.value.t === 'char' && typeof v.value.v === 'number') {
    const ch = String.fromCharCode(v.value.v);
    return g === want || g === `'${ch}'` || g === ch;
  }
  if (v.value.t === 'float') return Number(g) === Number(v.value.v);
  return g === want;
}

export function MemoryDiagram({ sample, children, line, occurrence, step: stepIndex, ask, prompt, onResult }: {
  sample?: string;
  children?: ReactNode;
  /** Diagram the moment this line is about to run (first occurrence unless `occurrence` is given). */
  line?: number;
  occurrence?: number;
  step?: number;
  /** Cells to fill, as "function.variable" (innermost frame of that function) or "variable". */
  ask: string[];
  prompt?: string;
  /** Quiz mode: reports whether the first check was fully correct. */
  onResult?: (correct: boolean) => void;
}) {
  const nested = nestedSample(children);
  const id = nested?.id ?? sample ?? '';
  const [trace, setTrace] = useState<TraceFile | null | undefined>(undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(0);
  const markDone = useCardDone();
  useEffect(() => { void traceFor(id).then(setTrace); }, [id]);

  const step = useMemo(() => (trace ? pickStep(trace, line, occurrence, stepIndex) : undefined), [trace, line, occurrence, stepIndex]);
  const targets = useMemo(() => {
    if (!step) return [];
    const names = new Set<string>(['NULL']);
    step.stack.forEach(f => f.vars.forEach(v => names.add(v.name)));
    step.globals.forEach(v => names.add(v.name));
    step.heap.forEach(h => names.add(`heap #${h.id}`));
    return [...names];
  }, [step]);

  if (trace === undefined) return <div className={styles.box}>Loading…</div>;
  if (!trace || !step) return <p className={styles.warn} role="alert">No trace for <code>{id}</code> at that line yet (run <code>npm run trace</code>).</p>;

  const cells = ask.map(path => ({ path, hit: findVar(step, path) }));
  const allRight = cells.every(c => c.hit && matches(c.hit.v, answers[c.path] ?? ''));
  const reveal = checked >= 2 && !allRight;

  return (
    <div className={styles.box} data-interaction="memory-diagram" data-sample={id} data-step={trace.steps.indexOf(step)}>
      <div className={styles.kicker}>Fill in the memory diagram</div>
      <p className={styles.prompt}>{prompt ?? <>Line <strong>{step.line}</strong> is about to run. Fill in the missing cells.</>}</p>
      <div className={ms.layout}>
        <CodeListing code={trace.source} current={step.line} label="Program" />
        <div className={ms.stack} aria-label="Stack (newest frame on top)">
          {[...step.stack].map((f, idx) => ({ f, idx })).reverse().map(({ f, idx }) => (
            <div key={idx} className={ms.frame}>
              <div className={ms.frameName}>{f.func}()</div>
              {f.vars.map(v => {
                const path = cells.find(c => c.hit && c.hit.frameIndex === idx && c.hit.v.name === v.name)?.path;
                const isPtr = v.value.t === 'ptr';
                return (
                  <div key={v.name} className={ms.cell}>
                    <code className={ms.name}>{v.type} {v.name}</code>
                    {path ? (
                      <span className={ms.input}>
                        {isPtr ? (
                          <select aria-label={`${f.func}: ${v.name} points to`} value={answers[path] ?? ''} onChange={e => setAnswers(a => ({ ...a, [path]: e.target.value }))}>
                            <option value="">points to…</option>
                            {targets.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : (
                          <input aria-label={`${f.func}: value of ${v.name}`} value={answers[path] ?? ''} onChange={e => setAnswers(a => ({ ...a, [path]: e.target.value }))} size={8} />
                        )}
                        {checked > 0 && <span aria-label={matches(v, answers[path] ?? '') ? 'correct' : 'incorrect'}>{matches(v, answers[path] ?? '') ? ' ✓' : ' ✗'}</span>}
                        {reveal && !matches(v, answers[path] ?? '') && <span className={ms.reveal}> answer: {correctAnswer(v)}</span>}
                      </span>
                    ) : (
                      <code className={ms.value}>{v.declared === false ? '(not yet set)' : formatValue(v.value)}</code>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={() => { if (checked === 0) onResult?.(allRight); setChecked(c => c + 1); markDone(); }}>Check</button>
        {checked > 0 && <span className={allRight ? styles.goodText : styles.badText} role="status">{allRight ? '✓ All correct.' : reveal ? 'Here are the answers. Compare them with yours.' : 'Some cells are wrong. Look again and check once more.'}</span>}
      </div>
      <p className={styles.muted}>Values recorded by running the program on x86-64 Linux.</p>
    </div>
  );
}
