// The code editor. CodeMirror (about half of the old entry chunk) lives in CodeEditorImpl.tsx and is loaded on
// demand; until it arrives a static placeholder with the same box, font and line height is shown, so the page does
// not shift when the editor mounts. The placeholder is announced as loading, is a tab stop like the real editor,
// and hands focus over (see editor-focus.ts).
import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import { requestEditorFocus } from './editor-focus';
import type { CodeEditorProps } from './CodeEditorImpl';
import styles from './CodeEditor.module.css';

export type { CodeEditorProps };

const loadEditor = () => import('./CodeEditorImpl');
const Editor = lazy(() => loadEditor().then(m => ({ default: m.CodeEditor })));

/** Start downloading CodeMirror without rendering it (the lesson pages call this when they mount). */
export function preloadCodeEditor() { void loadEditor(); }

function Placeholder({ value, label, minLines = 4 }: Pick<CodeEditorProps, 'value' | 'label' | 'minLines'>) {
  const pre = useRef<HTMLPreElement>(null);
  // Layout-effect cleanup runs before the placeholder leaves the DOM, while it can still be document.activeElement.
  useLayoutEffect(() => () => { if (pre.current && document.activeElement === pre.current) requestEditorFocus(label); }, [label]);
  return (
    <div className={styles.editor} style={{ minHeight: `${minLines * 1.5 + 1.4}em` }} aria-busy="true">
      <pre ref={pre} className={styles.placeholder} tabIndex={0} aria-label={`${label} (editor loading)`}>{value}</pre>
      <span className="visually-hidden" role="status">Loading code editor…</span>
    </div>
  );
}

export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<Placeholder value={props.value} label={props.label} minLines={props.minLines} />}>
      <Editor {...props} />
    </Suspense>
  );
}
