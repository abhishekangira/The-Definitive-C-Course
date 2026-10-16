import { useEffect, useRef, useState } from 'react';
import { getRuntime } from '../runtime/CRuntime';
import { useToolchainState } from '../runtime/useCRun';
import styles from './ToolchainProgress.module.css';

/**
 * The compiler's download progress, or what went wrong with it. Renders nothing once it is ready (later visits load it from cache).
 * `errorOnly`: for places that only need to explain a failed load (a background download is not their business).
 * Retry unmounts itself, so focus moves to the progress box, which keeps keyboard users in place.
 */
export function ToolchainProgress({ errorOnly = false }: { errorOnly?: boolean }) {
  const s = useToolchainState();
  const [retried, setRetried] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (retried && s.status === 'loading') box.current?.focus(); }, [retried, s.status]);
  if (s.status === 'error') {
    return (
      <div className={styles.box} role="alert" data-toolchain="error">
        <p className={styles.text}>
          {s.kind === 'download'
            ? "The C compiler didn't finish downloading, so your program was not compiled. Your code is fine: check your internet connection, then press Retry."
            : "The C compiler couldn't start, so your program was not compiled. Your code is fine: press Retry, and if it fails again reload the page (this device may be low on memory)."}
        </p>
        <button type="button" className="btn btn-sm" onClick={() => { setRetried(true); getRuntime().prefetch(); }}>Retry</button>
        <p className={styles.detail}>Details: {s.message}</p>
      </div>
    );
  }
  if (errorOnly && !retried) return null; // after Retry the same component shows progress and the ready note
  if (s.status === 'ready' && retried) return <div className={styles.box} role="status" data-toolchain="ready" ref={box} tabIndex={-1}>The compiler is ready. Try again.</div>;
  if (s.status !== 'loading') return null;
  const pct = s.total ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0;
  return (
    <div className={styles.box} data-toolchain="loading" ref={box} tabIndex={-1}>
      <div className={styles.text}>
        {pct < 100 ? `Downloading the C compiler (clang, ${Math.round(s.total / 1e6)} MB; cached for next time)…` : 'Preparing the compiler…'}
      </div>
      <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Compiler download">
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
