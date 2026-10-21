// Static code listing with line numbers, an optional highlighted line and optional clickable lines.
import type { CSSProperties } from 'react';
import styles from './CodeListing.module.css';

export function CodeListing({ code, current, onPick, picked, pickCorrect, label }: {
  code: string;
  current?: number | null;
  /** When set, lines become buttons (for "which line runs next?"). */
  onPick?: (line: number) => void;
  picked?: number | null;
  pickCorrect?: boolean | null;
  label: string;
}) {
  const lines = code.replace(/\n$/, '').split('\n');
  // The number column fits the longest number (PipelineExplorer shows up to 1500 lines), so every line's code starts at one x.
  const digits = Math.max(3, String(lines.length).length);
  return (
    <ol className={styles.listing} aria-label={label} style={{ '--digits': digits } as CSSProperties} data-digits={digits}>
      {lines.map((text, i) => {
        const n = i + 1;
        const cls = [
          styles.line,
          current === n ? styles.current : '',
          picked === n ? (pickCorrect === null || pickCorrect === undefined ? styles.picked : pickCorrect ? styles.right : styles.wrong) : '',
        ].join(' ');
        const content = (
          <>
            <span className={styles.no} aria-hidden="true">{n}</span>
            <code className={styles.text}>{text || ' '}</code>
            {current === n && <span className="visually-hidden"> (current line)</span>}
          </>
        );
        return (
          <li key={n} className={cls} aria-current={current === n ? 'step' : undefined}>
            {onPick ? (
              <button type="button" className={styles.pick} onClick={() => onPick(n)} aria-label={`Line ${n}: ${text.trim() || 'blank'}`}>{content}</button>
            ) : content}
          </li>
        );
      })}
    </ol>
  );
}
