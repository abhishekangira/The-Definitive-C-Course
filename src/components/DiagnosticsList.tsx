import type { Diagnostic } from '../content-model/types';
import styles from './DiagnosticsList.module.css';

/** Compiler messages, grouped as clang prints them (notes stay with their error/warning). */
export function DiagnosticsList({ diagnostics, raw, title = 'Compiler messages' }: { diagnostics: Diagnostic[]; raw?: string; title?: string }) {
  if (!diagnostics.length && !raw?.trim()) return null;
  const errors = diagnostics.filter(d => d.severity === 'error' || d.severity === 'fatal error').length;
  const warnings = diagnostics.filter(d => d.severity === 'warning').length;
  return (
    <details className={styles.box} open data-diagnostics>
      <summary>
        <span className={styles.title}>{title}</span>
        {errors > 0 && <span className="badge badge-err">{errors} error{errors > 1 ? 's' : ''}</span>}
        {warnings > 0 && <span className="badge badge-warn">{warnings} warning{warnings > 1 ? 's' : ''}</span>}
      </summary>
      <pre className={styles.raw}>{(raw ?? '').trimEnd()}</pre>
    </details>
  );
}
