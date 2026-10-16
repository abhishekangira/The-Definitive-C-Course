// Output pane for a program run: stdout, stderr (red), echoed input (blue) and status lines.
// When the program waits for input, an input line appears (interactive mode).
import { useEffect, useRef, useState } from 'react';
import type { Segment, RunPhase } from '../runtime/useCRun';
import type { RunResult } from '../runtime/protocol';
import { ToolchainProgress } from './ToolchainProgress';
import styles from './Terminal.module.css';

export function exitLine(r: (RunResult & { wallMs?: number }) | null): string | null {
  if (!r) return null;
  switch (r.kind) {
    case 'exit': return `Program exited with status ${r.exitCode}.`;
    case 'trap': return `Program crashed: ${r.message}. ${r.hint ?? ''}`.trim();
    case 'timeout': return r.message ?? 'Stopped: time limit exceeded.';
    case 'output-limit': return 'Stopped: the program printed more than 1 MiB.';
    case 'killed': return 'Stopped.';
  }
}

export function Terminal({ segments, phase, result, onInput, onEOF, onStop, label = 'Program output' }: {
  segments: Segment[];
  phase: RunPhase;
  result: (RunResult & { wallMs: number }) | null;
  onInput?: (line: string) => void;
  onEOF?: () => void;
  onStop?: () => void;
  label?: string;
}) {
  const [line, setLine] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (phase === 'waiting-input') inputRef.current?.focus(); }, [phase]);
  useEffect(() => { const b = boxRef.current; if (b) b.scrollTop = b.scrollHeight; }, [segments, phase]);

  const status = exitLine(result);
  const running = phase === 'running' || phase === 'waiting-input';
  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span className={styles.barTitle}>{label}</span>
        {phase === 'compiling' && <span className={styles.pill}>compiling…</span>}
        {running && <span className={styles.pill}>running</span>}
        {running && onStop && <button type="button" className={styles.stop} onClick={onStop}>Stop</button>}
      </div>
      {phase === 'compiling' && <ToolchainProgress />}
      <div className={styles.screen} ref={boxRef} role="log" aria-live="polite" aria-label={label} tabIndex={0}>
        {segments.length === 0 && phase === 'done' && !status && <span className={styles.muted}>(no output)</span>}
        {segments.map((s, i) => <span key={i} className={styles[s.kind]} data-kind={s.kind}>{s.text}</span>)}
        {phase === 'done' && segments.length === 0 && status && <span className={styles.muted}>(no output)</span>}
        {phase === 'waiting-input' && onInput && (
          <form className={styles.inputRow} onSubmit={e => { e.preventDefault(); onInput(line); setLine(''); }}>
            <label className="visually-hidden" htmlFor="term-input">Type input for the program, then press Enter</label>
            <input id="term-input" ref={inputRef} className={styles.input} value={line} onChange={e => setLine(e.target.value)} autoComplete="off" spellCheck={false}
              onKeyDown={e => { if (e.key === 'd' && e.ctrlKey && onEOF) { e.preventDefault(); onEOF(); } }} />
            <span className={styles.hint} aria-hidden="true">Enter sends the line · Ctrl-D = end of input</span>
          </form>
        )}
      </div>
      {status && <div className={`${styles.status} ${result?.kind === 'exit' && result.exitCode === 0 ? styles.ok : styles.bad}`}>{status}</div>}
    </div>
  );
}
