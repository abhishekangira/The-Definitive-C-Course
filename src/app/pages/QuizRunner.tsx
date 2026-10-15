// Runs a retrieval quiz or a checkpoint. Code questions are graded against verified sample output;
// conceptual questions carry an authored answer. First attempts count.
import { useEffect, useMemo, useState } from 'react';
import { quizFor, samplesFor, type QuizItem } from '../../content-runtime/course';
import type { SamplesFile } from '../../content-model/types';
import { CodeEditor } from '../../components/CodeEditor';
import { MiniMarkdown } from '../../components/MiniMarkdown';
import { DiagnosticsList } from '../../components/DiagnosticsList';
import { Exercise } from '../../interactions/Exercise';
import { MemoryDiagram } from '../../interactions/MemoryDiagram';
import { NumberDrill } from '../../interactions/NumberDrill';
import { normOutput } from '../../interactions/platform';
import { seededShuffle } from '../../interactions/hash';
import { update, useProgress } from '../../progress/store';
import { CHECKPOINT_PASS, quizKey } from '../../progress/gating';
import ix from '../../interactions/Interaction.module.css';
import styles from './Pages.module.css';

type Result = { correct: boolean; given?: unknown };

const OUTCOME_OPTIONS = [
  ['compile-error', "It doesn't compile"],
  ['runtime-error', 'It compiles, then crashes or stops with an error'],
  ['runs', 'It runs and exits normally'],
] as const;

function outcomeKey(o: string): string { return o.startsWith('exit:') ? (o === 'exit:0' ? 'runs' : 'runtime-error') : o; }

function QuizItemView({ item, samples, index, onResult, result, assessment }: { item: QuizItem; samples: SamplesFile | null; index: number; onResult: (r: Result) => void; result?: Result; assessment: boolean }) {
  const [text, setText] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(() => (item.items ? seededShuffle(item.items, item.id) : []));
  const sample = samples?.samples[item.sample ?? item.id];
  const head = (
    <div className={ix.kicker}>Question {index + 1}{item.transfer ? ' · new situation' : ''}</div>
  );
  const feedback = result && (
    <div className={result.correct ? ix.good : ix.bad} role="status">
      <strong>{result.correct ? '✓ Correct.' : '✗ Not quite.'}</strong> {item.explain && <MiniMarkdown text={item.explain} />}
    </div>
  );
  const locked = Boolean(result);

  if (item.type === 'exercise' && item.exercise) {
    return (
      <div className={styles.quizItem} data-quiz-item={item.id}>{head}<MiniMarkdown text={item.prompt} />
        <Exercise id={item.exercise} assessment={assessment} onPassed={() => !result && onResult({ correct: true })} onGiveUp={() => !result && onResult({ correct: false })} />
        {feedback}
      </div>
    );
  }
  if (item.type === 'md' && item.sample) {
    const ask = (item.items ?? []);
    return <div className={styles.quizItem} data-quiz-item={item.id}>{head}<MemoryDiagram sample={item.sample} line={item.line} ask={ask} prompt={item.prompt} onResult={c => onResult({ correct: c })} />{feedback}</div>;
  }
  if (item.type === 'np') {
    const [value, from, to, width] = (item.items ?? []) as [string, 'dec' | 'bin' | 'hex', 'dec' | 'bin' | 'hex', string];
    return <div className={styles.quizItem}>{head}<NumberDrill value={value} from={from} to={to} width={Number(width) as 8} prompt={item.prompt} onResult={c => onResult({ correct: c })} /></div>;
  }

  // Code-based items need verified output.
  if (item.code && !sample) return <div className={styles.quizItem}>{head}<p className={ix.warn}>Expected output for this question hasn't been generated (run <code>npm run verify</code>).</p></div>;

  const submitPredict = () => {
    if (item.type === 'predict') onResult({ correct: normOutput(text) === normOutput(sample!.answer.stdout), given: text });
    else if (item.type === 'outcome') onResult({ correct: pick === outcomeKey(sample!.answer.outcome), given: pick });
    else if (item.type === 'choice' || item.type === 'ce') {
      const correct = item.answer !== undefined ? pick === String(item.answer) : sample ? (item.choices?.[Number(pick)] ?? '').trim() === normOutput(sample.answer.stdout).trim() : false;
      onResult({ correct, given: pick });
    } else if (item.type === 'order') onResult({ correct: order.join('\n') === (item.items ?? []).join('\n'), given: order });
  };

  return (
    <div className={styles.quizItem} data-quiz-item={item.id}>
      {head}
      <MiniMarkdown text={item.prompt} />
      {item.code && <CodeEditor value={item.code} readOnly label={`Code for question ${index + 1}`} minLines={2} />}
      {item.type === 'ce' && sample && <DiagnosticsList diagnostics={sample.results['wasm32-clang22']?.compile.diagnostics ?? []} raw={sample.results['wasm32-clang22']?.compile.raw} />}
      <form className={ix.predict} onSubmit={e => { e.preventDefault(); if (!locked) submitPredict(); }}>
        {item.type === 'predict' && (
          <label className={ix.field}><span>What exactly does it print?</span>
            <textarea className={ix.mono} rows={2} value={text} onChange={e => setText(e.target.value)} disabled={locked} spellCheck={false} />
          </label>
        )}
        {item.type === 'outcome' && (
          <fieldset className={ix.choices}><legend className="visually-hidden">Outcome</legend>
            {OUTCOME_OPTIONS.map(([k, label]) => (
              <label key={k} className={ix.choice}><input type="radio" name={item.id} checked={pick === k} onChange={() => setPick(k)} disabled={locked} />{label}</label>
            ))}
          </fieldset>
        )}
        {(item.type === 'choice' || item.type === 'ce') && (
          <fieldset className={ix.choices}><legend className="visually-hidden">Choices</legend>
            {(item.choices ?? []).map((c, i) => (
              <label key={i} className={ix.choice}><input type="radio" name={item.id} checked={pick === String(i)} onChange={() => setPick(String(i))} disabled={locked} /><MiniMarkdown text={c} /></label>
            ))}
          </fieldset>
        )}
        {item.type === 'order' && (
          <ol className={styles.orderList}>
            {order.map((o, i) => (
              <li key={o}>
                <span>{o}</span>
                <span>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={locked || i === 0} aria-label={`Move up: ${o}`} onClick={() => setOrder(x => { const n = [...x]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>↑</button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={locked || i === order.length - 1} aria-label={`Move down: ${o}`} onClick={() => setOrder(x => { const n = [...x]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>↓</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {!locked && <div className={ix.actions}><button type="submit" className="btn btn-primary" disabled={(item.type === 'predict' && !text) || ((item.type === 'outcome' || item.type === 'choice' || item.type === 'ce') && pick === null)}>Submit answer</button></div>}
      </form>
      {result && !result.correct && item.type === 'predict' && sample && <p className={ix.muted}>It prints: <code className={ix.pre}>{normOutput(sample.answer.stdout)}</code></p>}
      {feedback}
    </div>
  );
}

export function QuizRunner({ moduleId, kind }: { moduleId: string; kind: 'retrieval' | 'checkpoint' }) {
  const items = useMemo(() => quizFor(moduleId, kind), [moduleId, kind]);
  const progress = useProgress();
  const [samples, setSamples] = useState<SamplesFile | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [finished, setFinished] = useState(false);
  useEffect(() => { void samplesFor(moduleId).then(setSamples); }, [moduleId]);
  const answered = Object.keys(results).length;
  const score = Object.values(results).filter(r => r.correct).length;
  const pass = kind === 'retrieval' || score / items.length >= CHECKPOINT_PASS;
  const prev = progress.quizzes[quizKey(moduleId, kind)];

  const finish = () => {
    setFinished(true);
    update(p => {
      const key = quizKey(moduleId, kind);
      const better = !p.quizzes[key] || score >= p.quizzes[key].score || (pass && !p.quizzes[key].passed);
      if (better) p.quizzes[key] = { score, total: items.length, passed: pass || Boolean(p.quizzes[key]?.passed), at: new Date().toISOString(), answers: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.correct])) };
    });
  };

  return (
    <div>
      {prev && <p className={styles.muted}>Best so far: {prev.score}/{prev.total}{kind === 'checkpoint' ? (prev.passed ? ' (passed)' : ' (not yet passed)') : ''}.</p>}
      {items.map((item, i) => (
        <QuizItemView key={item.id} item={item} index={i} samples={samples} result={results[item.id]} assessment={kind === 'checkpoint'}
          onResult={r => setResults(x => (x[item.id] ? x : { ...x, [item.id]: r }))} />
      ))}
      <div className={styles.quizFooter}>
        {!finished ? (
          <button type="button" className="btn btn-primary" disabled={answered < items.length} onClick={finish}>
            {answered < items.length ? `Answer all questions (${answered}/${items.length})` : kind === 'checkpoint' ? 'Submit checkpoint' : 'Finish warm-up'}
          </button>
        ) : (
          <div className={pass ? styles.okBox : styles.warnBox} role="status">
            <strong>{score} of {items.length} correct.</strong>{' '}
            {kind === 'checkpoint' ? (pass ? 'Checkpoint passed: you have unlocked the next module (once the project is done too).' : `You need ${Math.ceil(items.length * CHECKPOINT_PASS)} to pass. Review the explanations, revisit the lessons, and retake it.`) : 'Warm-up done: the lessons are open.'}
          </div>
        )}
      </div>
    </div>
  );
}
