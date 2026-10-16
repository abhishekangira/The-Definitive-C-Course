import { useState } from 'react';
import { getRuntime } from '../runtime/CRuntime';
import { useToolchainState } from '../runtime/useCRun';
import styles from './ToolchainProgress.module.css';

/** The compiler's download progress, or what went wrong with it. Renders nothing once it is ready (later visits load it from cache). */
export function ToolchainProgress() {
  const s = useToolchainState();
  const [retried, setRetried] = useState(false);
  if (s.status === 'error') {
    return (
      <div className={styles.box} role="alert">
        <p className={styles.text}>The C compiler didn&apos;t finish downloading, so your program was not compiled. Your code is fine: check your internet connection, then press Retry.</p>
        <button type="button" className="btn btn-sm" onClick={() => { setRetried(true); getRuntime().prefetch(); }}>Retry</button>
        <p className={styles.detail}>Details: {s.message}</p>
      </div>
    );
  }
  if (s.status === 'ready' && retried) return <div className={styles.box} role="status">The compiler is ready. Press Run again.</div>;
  if (s.status !== 'loading') return null;
  const pct = s.total ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0;
  return (
    <div className={styles.box}>
      <div className={styles.text}>
        {pct < 100 ? `Downloading the C compiler (clang, ${Math.round(s.total / 1e6)} MB; cached for next time)…` : 'Preparing the compiler…'}
      </div>
      <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Compiler download">
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
