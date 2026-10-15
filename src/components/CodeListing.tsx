// Static code listing with line numbers, an optional highlighted line and optional clickable lines.
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
  return (
    <ol className={styles.listing} aria-label={label}>
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
