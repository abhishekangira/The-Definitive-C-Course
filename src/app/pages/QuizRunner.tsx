// Runs a retrieval quiz or a checkpoint. Code questions are graded against verified sample output;
// conceptual questions carry an authored answer. First attempts count.
import { useEffect, useMemo, useState } from 'react';
import { quizFor, samplesFor, sessionsFor, type QuizItem } from '../../content-runtime/course';
import type { SamplesFile, SessionsFile } from '../../content-model/types';
import { TranscriptPane } from '../../components/Transcript';
import { sameOrder, sessionOrder } from '../../interactions/quiz-answers';
import { STAGE_LABEL, STAGES, type Stage } from '../../interactions/report-questions';
import { SpItem } from './QuizItems';
import { CodeEditor, preloadCodeEditor } from '../../components/CodeEditor';
import { MiniMarkdown } from '../../components/MiniMarkdown';
import { DiagnosticsList } from '../../components/DiagnosticsList';
import { Exercise } from '../../interactions/Exercise';
import { MemoryDiagram } from '../../interactions/MemoryDiagram';
import { NumberDrill } from '../../interactions/NumberDrill';
import { normOutput } from '../../interactions/platform';
import { seededShuffle } from '../../interactions/hash';
import { noteActivity, update, useProgress } from '../../progress/store';
import { CHECKPOINT_PASS, quizKey } from '../../progress/gating';
import { Icon, Mark } from '../../components/Icon';
import ix from '../../interactions/Interaction.module.css';
import styles from './Pages.module.css';

type Result = { correct: boolean; given?: unknown };

const OUTCOME_OPTIONS = [
  ['compile-error', "It doesn't compile"],
  ['runtime-error', 'It compiles, then crashes or stops with an error'],
  ['runs', 'It runs and exits normally'],
] as const;

function outcomeKey(o: string): string { return o.startsWith('exit:') ? (o === 'exit:0' ? 'runs' : 'runtime-error') : o; }

function QuizItemView({ item, samples, sessions, index, onResult, result, assessment }: {
  item: QuizItem; samples: SamplesFile | null;
  /** undefined while loading. */
  sessions: SessionsFile | null | undefined;
  index: number; onResult: (r: Result) => void; result?: Result; assessment: boolean;
}) {
  const [text, setText] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [stagePick, setStagePick] = useState<Stage | null>(null);
  const [order, setOrder] = useState<string[]>(() => (item.items ? seededShuffle(item.items, item.id) : []));
  const sample = samples?.samples[item.sample ?? item.id];
  const head = (
    <div className={ix.kicker}>Question {index + 1}{item.transfer ? ' · new situation' : ''}</div>
  );
  const feedback = result && (
    <div className={result.correct ? ix.good : ix.bad} role="status">
      <strong><Mark ok={result.correct} /> {result.correct ? 'Correct.' : 'Not quite.'}</strong> {item.explain && <MiniMarkdown text={item.explain} />}
    </div>
  );
  const locked = Boolean(result);

  if (item.type === 'exercise' && item.exercise) {
    return (
      <div className={styles.quizItem} data-quiz-item={item.id}>{head}<MiniMarkdown text={item.prompt} />
        <Exercise id={item.exercise} assessment={assessment} allowTutor={false} onPassed={() => !result && onResult({ correct: true })} onGiveUp={() => !result && onResult({ correct: false })} />
        {feedback}
      </div>
    );
  }
  if (item.type === 'md' && item.sample) {
    const ask = (item.items ?? []);
    return <div className={styles.quizItem} data-quiz-item={item.id}>{head}<MemoryDiagram sample={item.sample} line={item.line} ask={ask} prompt={item.prompt} onResult={c => onResult({ correct: c })} />{feedback}</div>;
  }
  if (item.type === 'sp') return <SpItem item={item} head={head} feedback={feedback} result={result} onResult={onResult} />;
  if (item.type === 'np') {
    const [value, from, to, width] = (item.items ?? []) as [string, 'dec' | 'bin' | 'hex', 'dec' | 'bin' | 'hex', string];
    return <div className={styles.quizItem} data-quiz-item={item.id}>{head}<NumberDrill value={value} from={from} to={to} width={Number(width) as 8} prompt={item.prompt} onResult={c => onResult({ correct: c })} /></div>;
  }

  // Session-backed items need the stored native run: a ce reads its report, an order item is graded against its commands.
  const session = item.session ? sessions?.sessions[item.session] : undefined;
  if (item.session && sessions === undefined) return <div className={styles.quizItem}>{head}<p className={ix.muted}>Loading the stored run…</p></div>;
  const stored = item.type === 'order' && session ? sessionOrder(session) : undefined;
  if (item.session && (!session || (stored && 'problem' in stored))) {
    return <div className={styles.quizItem}>{head}<p className={ix.warn} role="alert">{stored && 'problem' in stored ? stored.problem : <>The stored run of session <code>{item.session}</code> hasn&apos;t been generated (run <code>npm run verify</code>).</>}</p></div>;
  }
  const accepted = stored && 'order' in stored ? stored.order : item.items ?? [];
  const reportStep = item.step === undefined ? 'last' : item.step;

  // Code-based items need verified output.
  if (item.code && !sample) return <div className={styles.quizItem}>{head}<p className={ix.warn}>Expected output for this question hasn't been generated (run <code>npm run verify</code>).</p></div>;

  const submitPredict = () => {
    if (item.type === 'predict') onResult({ correct: normOutput(text) === normOutput(sample!.answer.stdout), given: text });
    else if (item.type === 'outcome') onResult({ correct: pick === outcomeKey(sample!.answer.outcome), given: pick });
    else if (item.type === 'choice' || item.type === 'ce') {
      const kindRight = item.answer !== undefined ? pick === String(item.answer) : sample ? (item.choices?.[Number(pick)] ?? '').trim() === normOutput(sample.answer.stdout).trim() : false;
      onResult({ correct: kindRight && (item.stage === undefined || stagePick === item.stage), given: item.stage ? [pick, stagePick] : pick });
    } else if (item.type === 'order') onResult({ correct: sameOrder(order, accepted), given: order });
  };

  return (
    <div className={styles.quizItem} data-quiz-item={item.id}>
      {head}
      <MiniMarkdown text={item.prompt} />
      {item.code && <CodeEditor value={item.code} readOnly label={`Code for question ${index + 1}`} minLines={2} />}
      {item.type === 'ce' && session && <TranscriptPane file={sessions!} id={item.session!} step={reportStep} />}
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
        {item.type === 'ce' && item.stage && (
          <fieldset className={ix.choices} data-question="stage"><legend>Which stage failed?</legend>
            {STAGES.map(st => (
              <label key={st} className={ix.choice}><input type="radio" name={`${item.id}-stage`} checked={stagePick === st} onChange={() => setStagePick(st)} disabled={locked} />{STAGE_LABEL[st]}</label>
            ))}
          </fieldset>
        )}
        {item.type === 'order' && (
          // Keyed by the line, so a moved row keeps its focused button; a move to the end that disables the button hands focus
          // to the other one, so a keyboard user is not dropped to the top of the page.
          <ol className={styles.orderList}>
            {order.map((o, i) => (
              <li key={o} data-place-right={locked ? String(o === accepted[i]) : undefined}>
                <span>{locked && <><Mark ok={o === accepted[i]} /><span className="visually-hidden">{o === accepted[i] ? 'Right place: ' : 'Wrong place: '}</span></>}{item.session ? <code>{o}</code> : o}</span>
                <span>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={locked || i === 0} aria-label={`Move up: ${o}`} onClick={e => { if (i === 1) (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus(); setOrder(x => { const n = [...x]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; }); }}><Icon name="arrow-up" /></button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={locked || i === order.length - 1} aria-label={`Move down: ${o}`} onClick={e => { if (i === order.length - 2) (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); setOrder(x => { const n = [...x]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; }); }}><Icon name="arrow-down" /></button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {!locked && <div className={ix.actions}><button type="submit" className="btn btn-primary" disabled={(item.type === 'predict' && !text) || ((item.type === 'outcome' || item.type === 'choice' || item.type === 'ce') && pick === null) || (item.type === 'ce' && Boolean(item.stage) && stagePick === null)}>Submit answer</button></div>}
      </form>
      {result && item.type === 'ce' && item.stage && <p data-stage-right={String(stagePick === item.stage)}><Mark ok={stagePick === item.stage} /> The stage that failed: {STAGE_LABEL[item.stage]}.</p>}
      {result && item.type === 'order' && session && <><p className={ix.muted}>The stored run, in its order:</p><TranscriptPane file={sessions!} id={item.session!} /></>}
      {result && !result.correct && item.type === 'predict' && sample && <p className={ix.muted}>It prints: <code className={ix.pre}>{normOutput(sample.answer.stdout)}</code></p>}
      {feedback}
    </div>
  );
}

export function QuizRunner({ moduleId, kind }: { moduleId: string; kind: 'retrieval' | 'checkpoint' }) {
  const items = useMemo(() => quizFor(moduleId, kind), [moduleId, kind]);
  const progress = useProgress();
  const [samples, setSamples] = useState<SamplesFile | null>(null);
  const [sessions, setSessions] = useState<SessionsFile | null | undefined>(undefined);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [finished, setFinished] = useState(false);
  useEffect(() => { void samplesFor(moduleId).then(setSamples); }, [moduleId]);
  useEffect(() => { void sessionsFor(moduleId).then(setSessions); }, [moduleId]);
  useEffect(() => { preloadCodeEditor(); }, []);
  const answered = Object.keys(results).length;
  const score = Object.values(results).filter(r => r.correct).length;
  const pass = kind === 'retrieval' || score / items.length >= CHECKPOINT_PASS;
  const prev = progress.quizzes[quizKey(moduleId, kind)];

  const finish = () => {
    setFinished(true);
    update(p => {
      noteActivity(p);
      const key = quizKey(moduleId, kind);
      const better = !p.quizzes[key] || score >= p.quizzes[key].score || (pass && !p.quizzes[key].passed);
      if (better) p.quizzes[key] = { score, total: items.length, passed: pass || Boolean(p.quizzes[key]?.passed), at: new Date().toISOString(), answers: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.correct])) };
    });
  };

  return (
    <div>
      {prev && <p className={styles.muted}>Best so far: {prev.score}/{prev.total}{kind === 'checkpoint' ? (prev.passed ? ' (passed)' : ' (not yet passed)') : ''}.</p>}
      {items.map((item, i) => (
        <QuizItemView key={item.id} item={item} index={i} samples={samples} sessions={sessions} result={results[item.id]} assessment={kind === 'checkpoint'}
          onResult={r => { update(p => noteActivity(p)); setResults(x => (x[item.id] ? x : { ...x, [item.id]: r })); }} />
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
