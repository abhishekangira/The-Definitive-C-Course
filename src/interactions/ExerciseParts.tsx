// Pieces shared by exercise kinds: test results, tiered hints, the solution gate.
import { useState } from 'react';
import { describeResult } from '../testing/format';
import type { TestResult } from '../testing/runner';
import type { ExerciseProgress } from '../progress/store';
import { solutionGate } from '../progress/gating';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { CodeEditor } from '../components/CodeEditor';
import styles from './Interaction.module.css';

/** The failure explanation: output is shown escaped ("a\\tb\\n"), so invisible differences are visible. */
function TestDetail({ r }: { r: TestResult }) {
  const lines = describeResult(r, 0);
  if (!lines.length) return null;
  return (
    <pre className={styles.testDetail}>
      {lines.map(l => `${'    '.repeat(l.indent ?? 0)}${l.mark ? (l.mark === 'pass' ? '✓ ' : '✗ ') : ''}${l.text}`).join('\n')}
    </pre>
  );
}

export function TestResults({ results, hideHints }: { results: TestResult[]; hideHints?: boolean }) {
  if (!results.length) return null;
  const passed = results.filter(r => r.status === 'pass').length;
  return (
    <div aria-live="polite">
      <p className={passed === results.length ? styles.goodText : styles.badText}>{passed} of {results.length} checks passed.</p>
      <ul className={styles.testList}>
        {results.map((r, i) => (
          <li key={i} className={`${styles.test} ${r.status === 'pass' ? styles.testPass : r.status === 'fail' ? styles.testFail : styles.testSkip}`}>
            <span className={styles.testName}>{r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'} {r.name}</span>
            {r.status !== 'pass' && <TestDetail r={r} />}
            {r.status === 'fail' && r.hint && !hideHints && <div className={styles.muted}>Hint: {r.hint}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TIER = ['Nudge', 'Concept', 'Partial code'];

export function Hints({ hints, viewed, onView, maxTier = 3 }: { hints: [string, string, string]; viewed: number; onView: (tier: number) => void; maxTier?: number }) {
  const shown = Math.min(viewed, maxTier);
  return (
    <div className={styles.hints}>
      {hints.slice(0, shown).map((h, i) => (
        <div key={i} className={styles.hint}>
          <strong>Hint {i + 1} · {TIER[i]}</strong>
          <MiniMarkdown text={h} />
        </div>
      ))}
      {shown < maxTier && (
        <div>
          <button type="button" className="btn btn-sm" onClick={() => onView(shown + 1)}>
            {shown === 0 ? 'Stuck? Show a hint' : `Show hint ${shown + 1} (${TIER[shown].toLowerCase()})`}
          </button>
        </div>
      )}
    </div>
  );
}

export function SolutionGatePanel({ ep, isVariant, solution, fileName, onView, onVariant, hasVariants }: {
  ep: ExerciseProgress;
  isVariant: boolean;
  solution: string | undefined;
  fileName: string;
  onView: () => void;
  onVariant: () => void;
  hasVariants: boolean;
}) {
  if (ep.passed && !ep.solutionViewed) return null;
  const gate = solutionGate(ep, isVariant);
  if (isVariant) return <p className={styles.muted}>{gate.reason}</p>;
  if (!ep.solutionViewed) {
    return (
      <div className={styles.actions}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!gate.unlocked} onClick={onView}>Show the solution</button>
        {!gate.unlocked && <span className={styles.muted}>{gate.reason}</span>}
      </div>
    );
  }
  return (
    <div className={styles.split}>
      <strong>Reference solution</strong>
      {solution && <CodeEditor value={solution} readOnly label="Reference solution" fileName={fileName} />}
      {hasVariants && (
        <div className={styles.note}>
          Study it, then prove the skill is yours: solve a <strong>variant</strong> on your own (no solution for variants).{' '}
          <button type="button" className="btn btn-sm btn-primary" onClick={onVariant}>{ep.variant ? 'Give me a different variant' : 'Start the variant'}</button>
        </div>
      )}
    </div>
  );
}

/** Assessment mode (checkpoints): no hints, no solution, no variants, always starts from the starter,
 *  and offers an explicit skip that reports the question as wrong. */
export interface AssessmentProps { assessment?: boolean; onGiveUp?: () => void }

export function GiveUp({ onGiveUp, disabled }: { onGiveUp?: () => void; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  if (!onGiveUp) return null;
  return (
    <button type="button" className="btn btn-ghost" disabled={disabled || done}
      onClick={() => { if (window.confirm('Skip this question? It will count as wrong in this attempt.')) { setDone(true); onGiveUp(); } }}>
      {done ? 'Skipped' : 'Skip (counts as wrong)'}
    </button>
  );
}
