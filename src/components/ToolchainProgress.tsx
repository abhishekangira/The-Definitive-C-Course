import { useToolchainState } from '../runtime/useCRun';
import styles from './ToolchainProgress.module.css';

/** Shown while the compiler downloads for the first time (later visits load it from cache). */
export function ToolchainProgress() {
  const s = useToolchainState();
  if (s.status === 'error') return <div className={styles.box} role="alert">The compiler failed to load: {s.message}. Check your connection and try again.</div>;
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
