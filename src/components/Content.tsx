// Non-interactive MDX building blocks: analogies, callouts, static code.
import type { ReactNode } from 'react';
import { CodeEditor } from './CodeEditor';
import { MiniMarkdown } from './MiniMarkdown';
import styles from './Content.module.css';

/** A JS/browser analogy with the required "where it breaks down". */
export function Analogy({ js, c, breaksDown, children }: { js: string; c: string; breaksDown: string; children?: ReactNode }) {
  return (
    <aside className={styles.analogy} aria-label="JavaScript analogy">
      <div className={styles.analogyHead}>
        <span className={styles.tag}>JS analogy</span>
        <span className={styles.pair}><code>{js}</code> <span aria-hidden="true">≈</span><span className="visually-hidden">is like</span> <code>{c}</code></span>
      </div>
      {children}
      <p className={styles.breaks}><strong>Where it breaks down:</strong> <MiniMarkdown text={breaksDown} className={styles.inlineMd} /></p>
    </aside>
  );
}

export function Callout({ kind = 'note', title, children }: { kind?: 'note' | 'warning' | 'tip' | 'platform'; title?: string; children: ReactNode }) {
  return (
    <aside className={`${styles.callout} ${styles[kind]}`} aria-label={title ?? kind}>
      {title && <div className={styles.calloutTitle}>{title}</div>}
      {children}
    </aside>
  );
}

/** A ```c fragment: illustration only (compiled with -fsyntax-only at build time, never run). */
export function CodeBlock({ code }: { code: string; lang?: string }) {
  return <div className={styles.codeBlock}><CodeEditor value={code} readOnly label="Code example" minLines={1} /></div>;
}
