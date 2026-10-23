// PR: predict-before-run. The learner commits to a prediction, then Run unlocks.
// Expected answers come from src/generated/samples (tools/verify ran this exact code).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SampleMeta, SampleResult } from '../content-model/types';
import { CodeEditor } from '../components/CodeEditor';
import { Terminal } from '../components/Terminal';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { useCRun } from '../runtime/useCRun';
import { useCardDone, usePredictionShown, useSamples } from '../lesson/LessonContext';
import { firstSample64Verdict, firstSampleVerdict, sample64Verdict, sampleVerdict, update, useProgress } from '../progress/store';
import { PlatformPicker } from './PlatformPicker';
import { applyMatch, describeOutcome, nativeFor, normOutput, outputDiff, predictionVerdict, storedOutputText, TARGET_LABEL, type DiffRow, type PredictionVerdict } from './platform';
import { Mark } from '../components/Icon';
import { listenForCopy, onCompareCopy } from './compareCopy';
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
  const chunks = row.gap ? [] : row.chunks.filter(c => c.text !== '');
  // A blank row is an empty span: min-height keeps it one line tall, and the "empty line" note is ::before plus
  // aria-label. No zero-width space: the box's onCopy (compareCopy.ts) writes the exact lines to the clipboard.
  return (
    <span
      className={styles.compareLine}
      data-line=""
      data-gap={row.gap ? '' : undefined}
      data-blank={row.blank ? '' : undefined}
      {...(row.blank ? { role: 'img' as const, 'aria-label': 'empty line' } : {})}
    >
      {chunks.map((c, i) => (
        c.mark
          ? <span key={i} className={styles.diffMark} data-diff="">{c.text}</span>
          : <span key={i}>{c.text}</span>
      ))}
    </span>
  );
}

/** One labelled box. Always a tab stop: a long line scrolls sideways, and whether it overflows depends on the column width. */
function CompareColumn({ label, which, rows, empty }: { label: string; which: 'predicted' | 'actual'; rows: DiffRow[]; empty: boolean }) {
  const labelId = useId();
  return (
    <div className={styles.compareCol}>
      <div id={labelId} className={styles.compareLabel}>{label}</div>
      {/* One expression, so the pre has no whitespace text nodes (they would show as blank lines). */}
      <pre className={`${styles.stored} ${styles.compareBox}`} data-compare={which} tabIndex={0} role="region" aria-labelledby={labelId} onCopy={empty ? undefined : onCompareCopy}>{empty
        ? <span className={styles.compareLine} data-line="">(nothing)</span>
        : rows.map((row, i) => <DiffLines key={i} row={row} />)}</pre>
    </div>
  );
}

/** The two labelled boxes. They sit outside the role=status verdict so a screen reader announces the verdict, not the output. */
function OutputCompare({ predicted, actual }: { predicted: string; actual: string }) {
  const diff = outputDiff(predicted, actual);
  // A selection that crosses a box edge (label into box, box into box, Ctrl+A) is not a box's own copy event.
  // One document listener while any compare is mounted (counted, so one unmount does not remove it for the rest).
  useEffect(() => listenForCopy(document), []);
  return (
    <div className={styles.compare}>
      <CompareColumn label="You predicted" which="predicted" rows={diff.predicted} empty={diff.predictedEmpty} />
      <CompareColumn label="Actual output" which="actual" rows={diff.actual} empty={diff.actualEmpty} />
    </div>
  );
}

export function CodeSample({ id, code, meta: metaJson }: { id: string; code: string; meta: string }) {
  const meta = useMemo(() => JSON.parse(metaJson) as SampleMeta, [metaJson]);
  const samples = useSamples();
  const sample: SampleResult | undefined = samples?.samples[id];
  const progress = useProgress();
  const saved = progress.samples[id];
  // A cleared entry is "Predict again": it stays in the document so a merge cannot bring the old prediction back, and the card looks unanswered.
  const kept = saved && !saved.cleared ? saved : undefined;
  const markDone = useCardDone();
  const predictionShown = usePredictionShown();
  const box = useRef<HTMLDivElement>(null);
  const runButton = useRef<HTMLButtonElement>(null);
  const reset64Button = useRef<HTMLButtonElement>(null);
  const pendingReveal = useRef<'run' | '64' | null>(null);
  const generation = useRef(0);
  const [revealTick, setRevealTick] = useState(0);
  useEffect(() => () => { generation.current++; }, []);
  const runner = useCRun();
  const [prediction, setPrediction] = useState(kept?.prediction ?? '');
  const [committed, setCommitted] = useState(Boolean(kept));
  const [revealed, setRevealed] = useState(Boolean(kept));
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(code);
  const [p64, setP64] = useState(kept?.predict64 ?? '');
  const [p64Done, setP64Done] = useState(kept?.predict64 !== undefined);
  // Wait for a DOM commit after the run settles (or an immediate stored/native reveal). The 64-bit
  // submit button disappears, so focus goes to its newly mounted reset button instead.
  useEffect(() => {
    if (!pendingReveal.current) return;
    const target = pendingReveal.current === '64' ? reset64Button.current : runButton.current;
    pendingReveal.current = null;
    const focus = target?.isConnected && !target.disabled ? target : box.current;
    if (focus) predictionShown?.(focus);
  }, [revealTick, predictionShown]);
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
    update(p => {
      // A first try survives "Predict again" (perfect lessons count first tries); `first` itself is set at the reveal.
      const prev = Object.hasOwn(p.samples, id) ? p.samples[id] : undefined;
      p.samples[id] = { prediction, correct: countsAsRight(verdict), verdict, at: new Date().toISOString() };
      if (prev?.first) p.samples[id].first = prev.first;
      if (prev?.first64) p.samples[id].first64 = prev.first64;
    });
  };

  const run = async () => {
    const firstReveal = !revealed && predictKind !== 'none';
    const mine = ++generation.current;
    setRevealed(true);
    if (firstReveal) update(p => { const s = p.samples[id]; if (s && !s.cleared && !s.first) s.first = sampleVerdict(s); });
    if (!nativeOnly && !storedMode) await runner.run({ files: { 'main.c': source }, stdin: meta.stdin ?? (edited ? undefined : ''), args: meta.args, guardrail: meta.guardrail });
    if (mine !== generation.current) return; // reset, unmount or a replacement run
    if (firstReveal) { pendingReveal.current = 'run'; setRevealTick(t => t + 1); }
    if (!sample?.flagged || !sample.meta.predict64 || sample.meta.predict64 === 'none') markDone();
  };

  const submitP64 = () => {
    pendingReveal.current = '64';
    setRevealTick(t => t + 1);
    setP64Done(true);
    const verdict = verdictFor64(p64);
    update(p => {
      const s = p.samples[id];
      if (s) { s.predict64 = p64; s.predict64Correct = countsAsRight(verdict); s.predict64Verdict = verdict; s.first64 ??= verdict; s.at = new Date().toISOString(); }
    });
    markDone();
  };

  const changePrediction = () => {
    setCommitted(false);
  };

  const predictAgain = () => {
    generation.current++;
    pendingReveal.current = null;
    // stop() cancels compilation or kills the running program before the terminal unmounts. reset() also cancels
    // pending work and kills any remaining handle, then clears the terminal state and returns the phase to idle.
    runner.stop();
    runner.reset();
    setPrediction('');
    setCommitted(false);
    setRevealed(false);
    setEditing(false);
    setSource(code);
    setP64('');
    setP64Done(false);
    update(p => {
      const prev = Object.hasOwn(p.samples, id) ? p.samples[id] : undefined;
      const first = prev && firstSampleVerdict(prev);
      const first64 = prev && firstSample64Verdict(prev);
      p.samples[id] = { prediction: '', correct: false, cleared: true, at: new Date().toISOString() };
      if (first) p.samples[id].first = first;
      if (first64) p.samples[id].first64 = first64;
    });
  };

  const predict64Again = () => {
    setP64('');
    setP64Done(false);
    update(p => {
      const s = p.samples[id];
      if (!s) return;
      s.first64 ??= sample64Verdict(s);
      delete s.predict64;
      delete s.predict64Correct;
      delete s.predict64Verdict;
      s.at = new Date().toISOString();
    });
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
    <div ref={box} tabIndex={-1} className={styles.box} data-interaction="predict" data-sample={id}>
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
          {predictKind !== 'none' && !revealed && <button type="button" className="btn" onClick={changePrediction}>Change prediction</button>}
          <button ref={runButton} type="button" className="btn btn-primary" onClick={run} disabled={runner.phase === 'compiling' || runner.phase === 'running'}>
            {nativeOnly || storedMode ? 'Reveal the result' : revealed ? 'Run again' : 'Run'}
          </button>
          {predictKind !== 'none' && revealed && <button type="button" className="btn" onClick={predictAgain}>Predict again</button>}
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
            {wasm.compile.ok && <pre className={styles.stored} data-stored-output>{storedOutputText(sample, wasm.run)}</pre>}
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
              {needs64 && p64Done && <button ref={reset64Button} type="button" className="btn" onClick={predict64Again}>Predict the 64-bit output again</button>}
              <div className={styles.nativeLabel}>{TARGET_LABEL[native!.target]}{native!.fallback ? ' (stored; your platform’s run isn’t available yet)' : ' (stored output from a real run)'}</div>
              <pre className={styles.stored} data-stored-output>{storedOutputText(sample, native?.run)}</pre>
              <div className={styles.muted}>{describeOutcome(native?.run, sample.results[native!.target]?.compile.ok ?? true)}</div>
            </>
          )}
        </div>
      )}

      {revealed && nativeOnly && (
        <div className={styles.native}>
          <div className={styles.nativeLabel}>{TARGET_LABEL['linux-x86_64-gcc13']} (stored output from a real run)</div>
          <pre className={styles.stored} data-stored-output>{storedOutputText(sample, sample.results['linux-x86_64-gcc13']?.run)}</pre>
        </div>
      )}
    </div>
  );
}
