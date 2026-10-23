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
import { applyMatch, describeOutcome, nativeFor, normOutput, outputDiff, predictionVerdict, storedOutputText, TARGET_LABEL, type DiffRow, type PredictionVerdict } from './platform';
import { Mark } from '../components/Icon';
import styles from './Interaction.module.css';

const OUTCOMES = [
  { key: 'compile-error', label: "It doesn't compile" },
  { key: 'runtime-error', label: 'It compiles, then crashes or stops with an error' },
  { key: 'runs', label: 'It runs and exits normally' },
] as const;

function outcomeKey(o: string): string { return o.startsWith('exit:') ? (o === 'exit:0' ? 'runs' : 'runtime-error') : o; }

const CLOSE_TEXT = 'Almost: the values are right, but the spacing, punctuation or line breaks differ.';

function countsAsRight(v: PredictionVerdict): boolean { return v === 'exact' || v === 'close'; }

function DiffLines({ row }: { row: DiffRow }) {
  // A span, not a div: this row is a child of the compare <pre>, and a div there is invalid.
  return (
    <span className={styles.compareLine} data-line="" data-gap={row.gap ? '' : undefined} data-blank={row.blank ? '' : undefined}>
      {row.blank && <span className={styles.emptyNote}>empty line</span>}
      {!row.gap && row.chunks.filter(c => c.text !== '').map((c, i) => (
        c.mark
          ? <span key={i} className={styles.diffMark} data-diff="">{c.text}</span>
          : <span key={i}>{c.text}</span>
      ))}
    </span>
  );
}

/** The two labelled boxes. They sit outside the role=status verdict so a screen reader announces the verdict, not the output. */
function OutputCompare({ predicted, actual }: { predicted: string; actual: string }) {
  const diff = outputDiff(predicted, actual);
  const column = (label: string, which: 'predicted' | 'actual', rows: DiffRow[], empty: boolean) => (
    <div className={styles.compareCol} key={which}>
      <div className={styles.compareLabel}>{label}</div>
      {/* One expression, so the pre has no whitespace text nodes (they would show as blank lines). */}
      <pre className={`${styles.stored} ${styles.compareBox}`} data-compare={which}>{empty
        ? <span className={styles.compareLine} data-line="">(nothing)</span>
        : rows.map((row, i) => <DiffLines key={i} row={row} />)}</pre>
    </div>
  );
  return (
    <div className={styles.compare}>
      {column('You predicted', 'predicted', diff.predicted, diff.predictedEmpty)}
      {column('Actual output', 'actual', diff.actual, diff.actualEmpty)}
    </div>
  );
}

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
  const verdictFor = (pred: string, actual: string): PredictionVerdict => {
    if (!sample) return 'wrong';
    if (predictKind === 'outcome') return pred === outcomeKey(sample.answer.outcome) ? 'exact' : 'wrong';
    if (predictKind === 'choice') return pred.trim() === answerText.trim() ? 'exact' : 'wrong';
    return applyMatch(predictionVerdict(pred, actual), meta.match);
  };

  // A missing native run is not empty output. Whitespace normalises to '' and would otherwise be exact.
  const verdictFor64 = (pred: string): PredictionVerdict => {
    if (!native?.run) return 'wrong';
    return applyMatch(predictionVerdict(pred, native.run.stdout), meta.match);
  };

  const commit = () => {
    setCommitted(true);
    const verdict = verdictFor(prediction, sample?.answer.stdout ?? '');
    update(p => { p.samples[id] = { prediction, correct: countsAsRight(verdict), verdict, at: new Date().toISOString() }; });
  };

  const run = async () => {
    setRevealed(true);
    if (!nativeOnly && !storedMode) await runner.run({ files: { 'main.c': source }, stdin: meta.stdin ?? (edited ? undefined : ''), args: meta.args, guardrail: meta.guardrail });
    if (!sample?.flagged || !sample.meta.predict64 || sample.meta.predict64 === 'none') markDone();
  };

  const submitP64 = () => {
    setP64Done(true);
    const verdict = verdictFor64(p64);
    update(p => { const s = p.samples[id]; if (s) { s.predict64 = p64; s.predict64Correct = countsAsRight(verdict); s.predict64Verdict = verdict; } });
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

  const verdict = committed ? verdictFor(prediction, sample.answer.stdout) : null;
  const needs64 = sample.flagged && sample.meta.predict64 && sample.meta.predict64 !== 'none';
  const p64Verdict = p64Done ? verdictFor64(p64) : null;

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
            {wasm.compile.ok && <pre className={styles.stored}>{storedOutputText(sample, wasm.run)}</pre>}
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

      {revealed && predictKind !== 'none' && verdict !== null && (
        <>
          <div className={verdict === 'exact' ? styles.good : verdict === 'close' ? styles.close : styles.bad} role="status">
            {verdict === 'exact' && <strong><Mark ok /> Your prediction was right.</strong>}
            {verdict === 'close' && <strong><Mark ok="close" /> {CLOSE_TEXT}</strong>}
            {verdict === 'wrong' && <strong><Mark ok={false} /> Not quite.</strong>}{' '}
            {verdict !== 'exact' && predictKind === 'outcome' && <span>{describeOutcome(sample.results['wasm32-clang22']?.run, sample.results['wasm32-clang22']?.compile.ok ?? true)}</span>}
            {verdict !== 'exact' && predictKind === 'choice' && <span>It prints <code>{answerText}</code>.</span>}
            <span className={styles.muted}> The explanation follows below.</span>
          </div>
          {verdict !== 'exact' && predictKind === 'output' && <OutputCompare predicted={prediction} actual={sample.answer.stdout} />}
        </>
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
              {needs64 && p64Verdict && (
                <div className={p64Verdict === 'exact' ? styles.good : p64Verdict === 'close' ? styles.close : styles.bad} role="status">
                  {p64Verdict === 'exact' && <strong><Mark ok /> Right for 64-bit too.</strong>}
                  {p64Verdict === 'close' && <strong><Mark ok="close" /> {CLOSE_TEXT}</strong>}
                  {p64Verdict === 'wrong' && <strong><Mark ok={false} /> Not quite.</strong>}
                </div>
              )}
              {needs64 && p64Verdict && p64Verdict !== 'exact' && <OutputCompare predicted={p64} actual={native?.run?.stdout ?? ''} />}
              <div className={styles.nativeLabel}>{TARGET_LABEL[native!.target]}{native!.fallback ? ' (stored; your platform’s run isn’t available yet)' : ' (stored output from a real run)'}</div>
              <pre className={styles.stored}>{storedOutputText(sample, native?.run)}</pre>
              <div className={styles.muted}>{describeOutcome(native?.run, sample.results[native!.target]?.compile.ok ?? true)}</div>
            </>
          )}
        </div>
      )}

      {revealed && nativeOnly && (
        <div className={styles.native}>
          <div className={styles.nativeLabel}>{TARGET_LABEL['linux-x86_64-gcc13']} (stored output from a real run)</div>
          <pre className={styles.stored}>{storedOutputText(sample, sample.results['linux-x86_64-gcc13']?.run)}</pre>
        </div>
      )}
    </div>
  );
}
