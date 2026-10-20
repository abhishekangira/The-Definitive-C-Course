// Progress as cells, one per step, like bits in a byte: a filled cell is a step that is done. The cells are the course's own
// unit chart (lessons, project and checkpoint of a module); the words say the same thing, so the strip itself is one image.
import styles from './Cells.module.css';

export function Cells({ done, total, label = 'Progress', className }: { done: number; total: number; label?: string; className?: string }) {
  return (
    <span className={`${styles.cells} ${className ?? ''}`.trim()} role="img" aria-label={`${label}: ${done} of ${total}`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < done ? styles.on : undefined} />)}
    </span>
  );
}
