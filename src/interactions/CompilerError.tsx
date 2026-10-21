// CE: interpret a real compiler message or tool report. Which line? What does it mean? Which stage failed? Fix it.
// With a nested ```c fence the message is the compiler's, per target. With `session="id"` it is a stored native report
// (src/generated/sessions, docs/adr/0005-native-sessions.md) in platform tabs, and the line is its first user frame.
import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Diagnostic, TargetId } from '../content-model/types';
import { CodeEditor } from '../components/CodeEditor';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { Terminal } from '../components/Terminal';
import { InlineMarkdown, MiniMarkdown } from '../components/MiniMarkdown';
import { TranscriptPane } from '../components/Transcript';
import { transcriptTabs } from '../components/transcript-tabs';
import { useCRun } from '../runtime/useCRun';
import { useCardDone, useSamples, useSessions } from '../lesson/LessonContext';
import { nestedSamples } from './nested';
import { TARGET_LABEL } from './platform';
import { Question } from './Question';
import { firstUserFrame, fixProblem, fixRunFlags, STAGE_LABEL, STAGES, type FixCheck, type Stage } from './report-questions';
import { Mark } from '../components/Icon';
import styles from './Interaction.module.css';

const COMPILER_TABS: TargetId[] = ['wasm32-clang22', 'linux-x86_64-gcc13', 'macos-arm64-appleclang'];

interface Props {
  children?: ReactNode;
  question: string;
  options: string[];
  answer: number;
  explain?: string;
  /** Ask the learner to fix the code, and how the browser checks it (`true` = `compile`). */
  fix?: boolean | FixCheck;
  /** A stored native session whose report the learner reads, instead of a nested fence. */
  session?: string;
  /** The session step that holds the report (1-based, in each platform's own list); default: the last. */
  step?: number | string;
  /** Asks "which stage failed?"; `link` also turns the line question off (a link error has no source line). */
  stage?: Stage;
}

/** The program and the line a message points at, from a nested fence (wasm32's first diagnostic) or a session report. */
interface Source {
  file: string; code: string; files: Record<string, string>; stdin: string;
  /** The right answers to "which line?": every stored platform's first user frame in `file` (they normally agree). */
  lines: number[];
  report: ReactNode; lineHelp: string;
}

/**
 * Sample mode wraps one or two ```c fences: the broken program (expect=compile-error|warning) and, optionally, a fixed
 * reference version (predict=none). A learner's fix must pass the fix check and, when the reference exists, print
 * exactly what the verified reference prints.
 */
export function CompilerError(props: Props) {
  const { children, question, options, answer, explain, session, stage } = props;
  // Sample mode: the broken program, then the fixed one. Session mode: the program is the session's, so the only fence
  // is the fixed version (for "Show a fixed version", its verified output, and e2e).
  const nested = nestedSamples(children);
  const [sampleRef, fixedRef] = session ? [undefined, nested[0]] : nested;
  const samples = useSamples();
  const sessions = useSessions();
  const markDone = useCardDone();
  const name = useId();
  const [tab, setTab] = useState<TargetId>('wasm32-clang22');
  const [platform, setPlatform] = useState(0);
  const [lineGuess, setLineGuess] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [stagePicked, setStagePicked] = useState<Stage | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const runner = useCRun();
  const [source, setSource] = useState<string | null>(null);
  const [fixState, setFixState] = useState<'idle' | 'ok' | 'bad'>('idle');
  const [fixWhy, setFixWhy] = useState('');
  const [fixAttempts, setFixAttempts] = useState(0);
  const [shownFix, setShownFix] = useState(false);

  const sample = sampleRef ? samples?.samples[sampleRef.id] : undefined;
  const diags: Diagnostic[] = useMemo(() => sample?.results[tab]?.compile.diagnostics ?? [], [sample, tab]);
  const step = props.step === undefined ? 'last' : Number(props.step);
  const fixCheck: FixCheck | null = props.fix === false ? null : props.fix === true || props.fix === undefined ? 'compile' : props.fix;
  const warn = (text: ReactNode) => <p className={styles.warn} role="alert">{text}</p>;

  let src: Source;
  if (session) {
    const result = sessions?.sessions[session];
    if (!result) return warn(<>The report of session <code>{session}</code> hasn't been generated yet (run <code>npm run verify</code>).</>);
    const tabs = transcriptTabs(result, step).tabs;
    if (!tabs.length) return <TranscriptPane file={sessions} id={session} step={step} />; // says what is missing
    // Graded against every platform's report, not just the tab on screen, so switching tabs never turns a right answer
    // wrong (verify's `bug:` check keeps the Linux reports on one line).
    const frames = tabs.map(t => firstUserFrame(t.steps, result.sources));
    const frame = frames[Math.min(platform, tabs.length - 1)] ?? frames.find(f => f);
    const cFiles = Object.keys(result.sources).filter(f => f.endsWith('.c'));
    const file = frame?.file ?? cFiles[0];
    if (stage !== 'link' && !frame) return warn(<>The report of session <code>{session}</code> names no line of its own files, so it can&apos;t ask which line: add <code>stage=&quot;link&quot;</code> or pick another <code>step</code>.</>);
    if (fixCheck && cFiles.length !== 1) return warn(<>The browser can only check a fix to a session with one <code>.c</code> file; give <code>{session}</code> <code>fix={'{false}'}</code>.</>);
    src = {
      file, code: result.sources[file] ?? '', files: result.sources, stdin: '',
      lines: [...new Set(frames.filter(f => f?.file === file).map(f => f!.line))],
      report: <TranscriptPane file={sessions} id={session} step={step} selected={platform} onSelect={setPlatform} />,
      lineHelp: `Look for the first line of the report that names your file, ${file}, with a line number after it.`,
    };
  } else {
    if (!sampleRef) return warn('CompilerError needs a nested ```c fence or a session.');
    if (!sample) return warn(<>Compiler output for <code>{sampleRef.id}</code> hasn&apos;t been generated yet (run <code>npm run verify</code>).</>);
    const tabs = COMPILER_TABS.filter(t => sample.results[t]);
    src = {
      file: 'main.c', code: sampleRef.code, files: {}, stdin: sampleRef.meta.stdin ?? '',
      lines: [(sample.results['wasm32-clang22']?.compile.diagnostics ?? []).find(d => d.severity !== 'note')?.line].filter((l): l is number => l !== undefined),
      report: (
        <>
          <div role="tablist" className={styles.tabs} aria-label="Compiler">
            {tabs.map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={styles.tab} onClick={() => setTab(t)}>{TARGET_LABEL[t]}</button>)}
          </div>
          <DiagnosticsList diagnostics={diags} raw={sample.results[tab]?.compile.raw ?? ''} title="What the compiler says" />
        </>
      ),
      lineHelp: 'Look at the number after the file name in the first message.',
    };
  }

  // The fixed program's output is only comparable when it is defined: undefined-behaviour output is never stored or checked.
  const fixedSample = fixedRef ? samples?.samples[fixedRef.id] : undefined;
  const fixedOutput = fixedSample && fixedSample.meta.expect !== 'ub' ? fixedSample.answer.stdout : undefined;
  const asksLine = stage !== 'link';
  const lines = src.code.split('\n');
  const lineRight = lineGuess !== null && src.lines.includes(lineGuess);
  const stageRight = stage === undefined || stagePicked === stage;
  const allRight = picked === answer && stageRight;
  const code = source ?? src.code;
  let n = 0;

  const checkFix = async () => {
    if (!fixCheck) return;
    const r = await runner.run({ files: { ...src.files, [src.file]: code }, stdin: src.stdin, ...fixRunFlags(fixCheck) });
    const problem = fixProblem(r, fixedOutput);
    setFixState(problem ? 'bad' : 'ok');
    setFixWhy(problem ?? '');
    if (problem) setFixAttempts(k => k + 1);
  };
  const ready = picked !== null && (!asksLine || lineGuess !== null) && (stage === undefined || stagePicked !== null);

  return (
    <div className={styles.box} data-interaction="compiler-error" data-sample={session ? undefined : sampleRef?.id} data-session={session} data-step={session ? String(step) : undefined} data-fixed={fixCheck && fixedRef ? fixedRef.id : undefined}>
      <div className={styles.kicker}>{session ? 'Read the report' : 'Read the compiler'}</div>
      {src.report}

      {asksLine && (
        <Question n={++n} legend={<>Which line {session ? <>of <code>{src.file}</code> is the report</> : 'is the compiler'} pointing at? Click it.</>}>
          <ol className={styles.codeLines}>
            {lines.map((l, i) => (
              <li key={i}>
                <label className={`${styles.codeLine} ${lineGuess === i + 1 ? (lineRight ? styles.choiceRight : styles.choiceWrong) : ''}`} data-line={i + 1}>
                  <input type="radio" name={`${name}-line`} className="visually-hidden" aria-label={`Line ${i + 1}: ${l.trim() || 'blank'}`} checked={lineGuess === i + 1} onChange={() => setLineGuess(i + 1)} />
                  <span className={styles.lineNo} aria-hidden="true">{i + 1}</span>
                  <code>{l || ' '}</code>
                </label>
              </li>
            ))}
          </ol>
          {lineGuess !== null && <p className={lineRight ? styles.goodText : styles.badText} data-line-right={String(lineRight)}><Mark ok={lineRight} /> {lineRight ? `Yes: ${session ? 'its first frame in your code' : 'the file:line:col prefix'} says so.` : src.lineHelp}</p>}
        </Question>
      )}

      <form className={styles.predict} onSubmit={e => { e.preventDefault(); if (ready) { setSubmitted(true); if (!fixCheck) markDone(); } }}>
        <Question n={++n} legend={<InlineMarkdown text={question} />}>
          {options.map((o, i) => (
            <label key={i} className={`${styles.choice} ${submitted ? (i === answer ? styles.choiceRight : i === picked ? styles.choiceWrong : '') : ''}`} data-correct={submitted ? String(i === answer) : undefined}>
              <input type="radio" name={`${name}-q`} checked={picked === i} onChange={() => setPicked(i)} />
              <MiniMarkdown text={o} />
            </label>
          ))}
        </Question>
        {stage !== undefined && (
          <Question n={++n} legend="Which stage failed?" data-question="stage">
            {STAGES.map(s => (
              <label key={s} className={`${styles.choice} ${submitted ? (s === stage ? styles.choiceRight : s === stagePicked ? styles.choiceWrong : '') : ''}`} data-correct={submitted ? String(s === stage) : undefined}>
                <input type="radio" name={`${name}-stage`} checked={stagePicked === s} onChange={() => setStagePicked(s)} />
                {STAGE_LABEL[s]}
              </label>
            ))}
          </Question>
        )}
        <div className={styles.actions}><button type="submit" className="btn btn-primary" disabled={!ready}>Check</button></div>
      </form>
      {submitted && (
        <div className={allRight ? styles.good : styles.bad} role="status">
          <strong><Mark ok={allRight} /> {allRight ? 'Correct.' : picked === answer ? 'Not quite: look again at which stage stopped.' : 'Not quite.'}</strong>
          {explain && <MiniMarkdown text={explain} />}
        </div>
      )}

      {submitted && fixCheck && (
        <div className={styles.split}>
          <strong>{++n}. Fix the program so it compiles with no errors or warnings{fixCheck === 'ubsan' ? ' and runs with no undefined behaviour' : fixCheck === 'leak' ? ' and frees everything it allocates' : ''}.</strong>
          <CodeEditor value={code} onChange={v => { setSource(v); setFixState('idle'); }} label="Fix the code" diagnostics={runner.diagnostics} />
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" onClick={checkFix} disabled={runner.phase === 'compiling' || runner.phase === 'running'}>Compile and check</button>
            <button type="button" className="btn btn-ghost" onClick={() => setSource(src.code)}>Reset</button>
          </div>
          {runner.phase !== 'idle' && <DiagnosticsList diagnostics={runner.diagnostics} raw={runner.rawDiagnostics} />}
          {runner.phase !== 'idle' && runner.diagnostics.length === 0 && <Terminal segments={runner.segments} phase={runner.phase} result={runner.result} onStop={runner.stop} />}
          {fixState === 'ok' && <div className={styles.good} role="status"><strong><Mark ok /> Fixed: it compiles cleanly{fixCheck === 'ubsan' ? ' and runs with no undefined behaviour' : fixCheck === 'leak' ? ' and leaks nothing' : ''}{fixedOutput !== undefined ? ' and prints the right output' : ''}.</strong></div>}
          {fixState === 'ok' && <button type="button" className="btn" onClick={markDone}>Continue</button>}
          {fixState === 'bad' && <div className={styles.bad} role="status">{fixWhy}</div>}
          {fixedRef && fixAttempts >= 2 && fixState !== 'ok' && !shownFix && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShownFix(true); setSource(fixedRef.code); setFixState('idle'); }}>Show a fixed version</button>
          )}
          {shownFix && fixState !== 'ok' && <p className={styles.muted}>The editor now holds a fixed version. Compare it with the original, then press <em>Compile and check</em>.</p>}
        </div>
      )}
    </div>
  );
}
