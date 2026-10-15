// PR: predict-before-run. The learner commits to a prediction, then Run unlocks.
// Expected answers come from src/generated/samples (tools/verify ran this exact code).
import { useMemo, useState } from 'react';
import type { SampleMeta, SampleResult } from '../content-model/types';
import { CodeEditor } from '../components/CodeEditor';
import { Terminal } from '../components/Terminal';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { useCRun } from '../runtime/useCRun';
import { useCardDone, useSamples } from '../lesson/LessonContext';
import { update, useProgress } from '../progress/store';
import { PlatformPicker } from './PlatformPicker';
import { describeOutcome, nativeFor, normOutput, TARGET_LABEL } from './platform';
import styles from './Interaction.module.css';

const OUTCOMES = [
  { key: 'compile-error', label: "It doesn't compile" },
  { key: 'runtime-error', label: 'It compiles, then crashes or stops with an error' },
  { key: 'runs', label: 'It runs and exits normally' },
] as const;

function outcomeKey(o: string): string { return o.startsWith('exit:') ? (o === 'exit:0' ? 'runs' : 'runtime-error') : o; }

export function CodeSample({ id, code, meta: metaJson }: { id: string; code: string; meta: string }) {
  const meta = useMemo(() => JSON.parse(metaJson) as SampleMeta, [metaJson]);
  const samples = useSamples();
  const sample: SampleResult | undefined = samples?.samples[id];
  const progress = useProgress();
  const saved = progress.samples[id];
  const markDone = useCardDone();
  const runner = useCRun();
  const [prediction, setPrediction] = useState(saved?.prediction ?? '');
  const [committed, setCommitted] = useState(Boolean(saved));
  const [revealed, setRevealed] = useState(Boolean(saved));
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(code);
  const [p64, setP64] = useState(saved?.predict64 ?? '');
  const [p64Done, setP64Done] = useState(saved?.predict64 !== undefined);
  const native = sample ? nativeFor(sample, progress.settings.platform) : null;
  const edited = source !== code;
  const predictKind = meta.predict ?? 'output';
  const nativeOnly = meta.target === 'native';
  const usesPointers = /%p/.test(code);
  // Low-memory mode: never download the compiler; show the output recorded at build time instead.
  const storedMode = Boolean(progress.settings.storedOutputMode) && !nativeOnly;

  const answerText = sample ? normOutput(sample.answer.stdout) : '';
  const isCorrect = (pred: string): boolean => {
    if (!sample) return false;
    if (predictKind === 'outcome') return pred === outcomeKey(sample.answer.outcome);
    if (predictKind === 'choice') return pred.trim() === answerText.trim();
    return normOutput(pred) === answerText;
  };

  const commit = () => {
    setCommitted(true);
    update(p => { p.samples[id] = { prediction, correct: isCorrect(prediction), at: new Date().toISOString() }; });
  };

  const run = async () => {
    setRevealed(true);
    if (!nativeOnly && !storedMode) await runner.run({ files: { 'main.c': source }, stdin: meta.stdin ?? (edited ? undefined : ''), args: meta.args, guardrail: meta.guardrail });
    if (!sample?.flagged || !sample.meta.predict64 || sample.meta.predict64 === 'none') markDone();
  };

  const submitP64 = () => {
    setP64Done(true);
    const correct = native?.run ? normOutput(p64) === normOutput(native.run.stdout) : false;
    update(p => { const s = p.samples[id]; if (s) { s.predict64 = p64; s.predict64Correct = correct; } });
    markDone();
  };

  if (!sample) {
    return (
      <div className={styles.box}>
        <CodeEditor value={code} readOnly label={`Code sample ${id}`} />
        <p className={styles.warn} role="alert">The expected output for this sample hasn't been generated yet (run <code>npm run verify</code>).</p>
      </div>
    );
  }

  const correct = committed ? isCorrect(prediction) : null;
  const needs64 = sample.flagged && sample.meta.predict64 && sample.meta.predict64 !== 'none';

  return (
    <div className={styles.box} data-interaction="predict" data-sample={id}>
      <div className={styles.kicker}>{nativeOnly ? 'Predict, then reveal' : 'Predict, then run'}</div>
      <CodeEditor value={source} onChange={setSource} readOnly={!editing} label={`Code sample ${id}`} diagnostics={runner.diagnostics} />
      {meta.stdin !== undefined && (
        <div className={styles.stdin}><span>Input typed by the user (stdin):</span> <code>{JSON.stringify(meta.stdin).slice(1, -1)}</code></div>
      )}

      {!committed && (
        <form className={styles.predict} onSubmit={e => { e.preventDefault(); if (prediction !== '') commit(); }}>
          {predictKind === 'output' && (
            <label className={styles.field}>
              <span>What exactly will it print? {usesPointers ? '' : 'One line per line of output.'}</span>
              <textarea value={prediction} onChange={e => setPrediction(e.target.value)} rows={Math.max(2, answerText.split('\n').length)} spellCheck={false} className={styles.mono} />
            </label>
          )}
          {predictKind === 'choice' && (
            <fieldset className={styles.choices}>
              <legend>What will it print?</legend>
              {(meta.choices ?? []).map(c => (
                <label key={c} className={styles.choice}>
                  <input type="radio" name={`pr-${id}`} value={c} checked={prediction === c} onChange={() => setPrediction(c)} />
                  <code>{c}</code>
                </label>
              ))}
            </fieldset>
          )}
          {predictKind === 'outcome' && (
            <fieldset className={styles.choices}>
              <legend>What happens when you compile and run it?</legend>
              {OUTCOMES.map(o => (
                <label key={o.key} className={styles.choice}>
                  <input type="radio" name={`pr-${id}`} value={o.key} checked={prediction === o.key} onChange={() => setPrediction(o.key)} />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
          {predictKind === 'none' ? (
            <button type="button" className="btn btn-primary" onClick={() => { setCommitted(true); void run(); }}>Run</button>
          ) : (
            <div className={styles.actions}>
              <button type="submit" className="btn btn-primary" disabled={prediction === ''}>Lock in my prediction</button>
              <span className={styles.muted}>Run unlocks after you commit.</span>
            </div>
          )}
        </form>
      )}

      {committed && (
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" onClick={run} disabled={runner.phase === 'compiling' || runner.phase === 'running'}>
            {nativeOnly || storedMode ? 'Reveal the result' : revealed ? 'Run again' : 'Run'}
          </button>
          {revealed && !nativeOnly && !storedMode && !editing && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit and experiment</button>}
          {editing && edited && <button type="button" className="btn btn-ghost" onClick={() => setSource(code)}>Reset code</button>}
        </div>
      )}

      {revealed && storedMode && (() => {
        const wasm = sample.results['wasm32-clang22'];
        return wasm && (
          <div className={styles.native}>
            <div className={styles.nativeLabel}>{TARGET_LABEL['wasm32-clang22']} (stored output: low-memory mode is on in Settings)</div>
            {wasm.compile.diagnostics.length > 0 && <DiagnosticsList diagnostics={wasm.compile.diagnostics} raw={wasm.compile.raw} />}
            {wasm.compile.ok && <pre className={styles.stored}>{wasm.run ? (wasm.run.stdoutDisplay ?? wasm.run.stdout) || '(no output)' : '—'}</pre>}
            <div className={styles.muted}>{describeOutcome(wasm.run, wasm.compile.ok)}</div>
          </div>
        );
      })()}

      {revealed && !nativeOnly && !storedMode && (runner.phase !== 'idle') && (
        <>
          <DiagnosticsList diagnostics={runner.diagnostics} raw={runner.rawDiagnostics} />
          <Terminal segments={runner.segments} phase={runner.phase} result={runner.result} onStop={runner.stop} onInput={runner.sendInput} onEOF={runner.sendEOF} label={TARGET_LABEL['wasm32-clang22']} />
        </>
      )}

      {revealed && predictKind !== 'none' && correct !== null && (
        <div className={correct ? styles.good : styles.bad} role="status">
          {correct ? <strong>✓ Your prediction was right.</strong> : <strong>✗ Not quite.</strong>}{' '}
          {!correct && predictKind === 'output' && (
            <span>Expected <code className={styles.pre}>{answerText || '(nothing)'}</code>; you predicted <code className={styles.pre}>{normOutput(prediction) || '(nothing)'}</code>.</span>
          )}
          {!correct && predictKind === 'outcome' && <span>{describeOutcome(sample.results['wasm32-clang22']?.run, sample.results['wasm32-clang22']?.compile.ok ?? true)}</span>}
          {!correct && predictKind === 'choice' && <span>It prints <code>{answerText}</code>.</span>}
          <span className={styles.muted}> The explanation follows below.</span>
        </div>
      )}

      {revealed && sample.flagged && (
        <div className={styles.native}>
          <div className={styles.nativeHead}>
            <strong>This program behaves differently on a 64-bit machine.</strong>
            {!progress.settings.platform && <PlatformPicker />}
          </div>
          {needs64 && !p64Done ? (
            <form className={styles.predict} onSubmit={e => { e.preventDefault(); submitP64(); }}>
              <label className={styles.field}>
                <span>{sample.meta.predict64}</span>
                <textarea value={p64} onChange={e => setP64(e.target.value)} rows={2} className={styles.mono} spellCheck={false} />
              </label>
              <button type="submit" className="btn btn-primary" disabled={!p64}>Check my 64-bit prediction</button>
            </form>
          ) : edited ? (
            <p className={styles.warn}>Your edit changes this program, so the stored 64-bit output no longer applies. Run it on your own machine (Module 3 shows how) to see the native result.</p>
          ) : (
            <>
              {needs64 && <p className={native?.run && normOutput(p64) === normOutput(native.run.stdout) ? styles.goodText : styles.badText}>
                {native?.run && normOutput(p64) === normOutput(native.run.stdout) ? '✓ Right for 64-bit too.' : '✗ The 64-bit answer differs from your prediction:'}</p>}
              <div className={styles.nativeLabel}>{TARGET_LABEL[native!.target]}{native!.fallback ? ' (stored; your platform’s run isn’t available yet)' : ' (stored output from a real run)'}</div>
              <pre className={styles.stored}>{native?.run ? (native.run.stdoutDisplay ?? native.run.stdout) || '(no output)' : '—'}</pre>
              <div className={styles.muted}>{describeOutcome(native?.run, sample.results[native!.target]?.compile.ok ?? true)}</div>
            </>
          )}
        </div>
      )}

      {revealed && nativeOnly && (
        <div className={styles.native}>
          <div className={styles.nativeLabel}>{TARGET_LABEL['linux-x86_64-gcc13']} (stored output from a real run)</div>
          <pre className={styles.stored}>{sample.results['linux-x86_64-gcc13']?.run?.stdoutDisplay ?? sample.results['linux-x86_64-gcc13']?.run?.stdout ?? '—'}</pre>
        </div>
      )}
    </div>
  );
}
