// CE: interpret a real compiler message. Step 1: which line? Step 2: what does it mean? Step 3 (optional): fix it.
import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Diagnostic, TargetId } from '../content-model/types';
import { CodeEditor } from '../components/CodeEditor';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { Terminal } from '../components/Terminal';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { useCRun } from '../runtime/useCRun';
import { useCardDone, useSamples } from '../lesson/LessonContext';
import { nestedSamples } from './nested';
import { normOutput, TARGET_LABEL } from './platform';
import styles from './Interaction.module.css';

const COMPILER_TABS: TargetId[] = ['wasm32-clang22', 'linux-x86_64-gcc13', 'macos-arm64-appleclang'];

/**
 * Wraps one or two ```c fences: the broken program (expect=compile-error|warning) and, optionally, a fixed
 * reference version (predict=none). A learner's fix must compile cleanly and, when the reference exists,
 * print exactly what the verified reference prints.
 */
export function CompilerError({ children, question, options, answer, explain, fix = true }: {
  children: ReactNode;
  question: string;
  options: string[];
  answer: number;
  explain?: string;
  /** Ask the learner to fix the code. */
  fix?: boolean;
}) {
  const [sampleRef, fixedRef] = nestedSamples(children);
  const samples = useSamples();
  const sample = sampleRef ? samples?.samples[sampleRef.id] : undefined;
  const markDone = useCardDone();
  const name = useId();
  const [tab, setTab] = useState<TargetId>('wasm32-clang22');
  const [lineGuess, setLineGuess] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [source, setSource] = useState(sampleRef?.code ?? '');
  const runner = useCRun();
  const [fixState, setFixState] = useState<'idle' | 'ok' | 'bad'>('idle');

  const diags: Diagnostic[] = useMemo(() => sample?.results[tab]?.compile.diagnostics ?? [], [sample, tab]);
  const raw = sample?.results[tab]?.compile.raw ?? '';
  const fixedOutput = fixedRef ? samples?.samples[fixedRef.id]?.answer.stdout : undefined;
  const first = (sample?.results['wasm32-clang22']?.compile.diagnostics ?? []).find(d => d.severity !== 'note');
  if (!sampleRef) return <p className={styles.warn}>CompilerError needs a nested ```c fence.</p>;
  if (!sample) return <p className={styles.warn} role="alert">Compiler output for <code>{sampleRef.id}</code> hasn't been generated yet (run <code>npm run verify</code>).</p>;

  const lines = sampleRef.code.split('\n');
  const lineRight = first ? lineGuess === first.line : false;
  const tabs = COMPILER_TABS.filter(t => sample.results[t]);

  const checkFix = async () => {
    const r = await runner.run({ files: { 'main.c': source }, stdin: sampleRef.meta.stdin ?? '' });
    const clean = r.compile.ok && r.compile.diagnostics.every(d => d.severity === 'note');
    const outputOk = fixedOutput === undefined || normOutput(r.stdout) === normOutput(fixedOutput);
    setFixState(clean && outputOk && r.result?.kind === 'exit' ? 'ok' : 'bad');
  };

  return (
    <div className={styles.box} data-interaction="compiler-error" data-sample={sampleRef.id}>
      <div className={styles.kicker}>Read the compiler</div>
      <div role="tablist" className={styles.tabs} aria-label="Compiler">
        {tabs.map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={styles.tab} onClick={() => setTab(t)}>{TARGET_LABEL[t]}</button>
        ))}
      </div>
      <DiagnosticsList diagnostics={diags} raw={raw} title="What the compiler says" />

      <fieldset className={styles.choices}>
        <legend>1. Which line is the compiler pointing at? Click it.</legend>
        <ol className={styles.codeLines}>
          {lines.map((l, i) => (
            <li key={i}>
              <label className={`${styles.codeLine} ${lineGuess === i + 1 ? (lineRight ? styles.choiceRight : styles.choiceWrong) : ''}`}>
                <input type="radio" name={`${name}-line`} className="visually-hidden" checked={lineGuess === i + 1} onChange={() => setLineGuess(i + 1)} />
                <span className={styles.lineNo} aria-hidden="true">{i + 1}</span>
                <code>{l || ' '}</code>
              </label>
            </li>
          ))}
        </ol>
        {lineGuess !== null && <p className={lineRight ? styles.goodText : styles.badText}>{lineRight ? '✓ Yes: the file:line:col prefix says so.' : `✗ Look at the number after the file name in the first message.`}</p>}
      </fieldset>

      <form className={styles.predict} onSubmit={e => { e.preventDefault(); if (picked !== null) { setSubmitted(true); if (!fix) markDone(); } }}>
        <fieldset className={styles.choices}>
          <legend><MiniMarkdown text={`2. ${question}`} /></legend>
          {options.map((o, i) => (
            <label key={i} className={`${styles.choice} ${submitted ? (i === answer ? styles.choiceRight : i === picked ? styles.choiceWrong : '') : ''}`}>
              <input type="radio" name={`${name}-q`} checked={picked === i} onChange={() => setPicked(i)} />
              <MiniMarkdown text={o} />
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}><button type="submit" className="btn btn-primary" disabled={picked === null || lineGuess === null}>Check</button></div>
      </form>
      {submitted && (
        <div className={picked === answer ? styles.good : styles.bad} role="status">
          <strong>{picked === answer ? '✓ Correct.' : '✗ Not quite.'}</strong>
          {explain && <MiniMarkdown text={explain} />}
        </div>
      )}

      {submitted && fix && (
        <div className={styles.split}>
          <strong>3. Fix the program so it compiles with no errors or warnings.</strong>
          <CodeEditor value={source} onChange={v => { setSource(v); setFixState('idle'); }} label="Fix the code" diagnostics={runner.diagnostics} />
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" onClick={checkFix} disabled={runner.phase === 'compiling' || runner.phase === 'running'}>Compile and check</button>
            <button type="button" className="btn btn-ghost" onClick={() => setSource(sampleRef.code)}>Reset</button>
          </div>
          {runner.phase !== 'idle' && <DiagnosticsList diagnostics={runner.diagnostics} raw={runner.rawDiagnostics} />}
          {runner.phase !== 'idle' && runner.diagnostics.length === 0 && <Terminal segments={runner.segments} phase={runner.phase} result={runner.result} onStop={runner.stop} />}
          {fixState === 'ok' && <div className={styles.good} role="status"><strong>✓ Fixed: it compiles cleanly{fixedOutput !== undefined ? ' and prints the right output' : ''}.</strong></div>}
          {fixState === 'ok' && <button type="button" className="btn" onClick={markDone}>Continue</button>}
          {fixState === 'bad' && <div className={styles.bad} role="status">{runner.diagnostics.length ? 'Still not clean: read the new message, which may point somewhere else.' : 'It compiles, but the output isn\'t right yet.'}</div>}
        </div>
      )}
    </div>
  );
}
