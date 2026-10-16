// The code editor. CodeMirror (about half of the old entry chunk) lives in CodeEditorImpl.tsx and is loaded on
// demand; until it arrives a static placeholder with the same box, font and line height is shown, so the page does
// not shift when the editor mounts. The placeholder is announced as loading, is a tab stop like the real editor,
// and hands focus over (see editor-focus.ts).
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { cancelHandoff, opFromKey, selectionWithin, stashHandoff, type InputOp } from './editor-focus';
import type { CodeEditorProps } from './CodeEditorImpl';
import styles from './CodeEditor.module.css';

export type { CodeEditorProps };

const loadEditor = () => import('./CodeEditorImpl');
const Editor = lazy(() => loadEditor().then(m => ({ default: m.CodeEditor })));

/** Start downloading CodeMirror without rendering it (the lesson pages call this when they mount). */
export function preloadCodeEditor() { void loadEditor(); }

/**
 * Static stand-in while CodeMirror loads. It is never contenteditable. For an editable editor it records plain typing
 * and replays it into the real editor (see editor-focus.ts); a read-only sample has nothing to record.
 */
function Placeholder({ id, value, label, minLines = 4, readOnly }: Pick<CodeEditorProps, 'value' | 'label' | 'minLines' | 'readOnly'> & { id: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const ops = useRef<InputOp[]>([]);
  // Layout-effect cleanup runs before the placeholder leaves the DOM, while it can still be document.activeElement
  // and still holds the selection. If the whole editor is going away instead, CodeEditor cancels this request.
  useLayoutEffect(() => () => {
    const el = pre.current;
    if (!el) return;
    const focus = document.activeElement === el;
    const sel = selectionWithin(el);
    if (!focus && !sel && ops.current.length === 0) return;
    const { anchor, head } = sel ?? { anchor: 0, head: 0 };
    stashHandoff(id, { focus, anchor, head, ops: ops.current });
  }, [id]);
  // A trailing newline renders no line in a <pre> but does in CodeMirror (an empty last line), so add one.
  const text = value.endsWith('\n') ? `${value}\n` : value;
  return (
    <div className={styles.editor} style={{ minHeight: `${minLines * 1.5 + 1.4}em` }} data-loading="true">
      <pre
        ref={pre}
        className={styles.placeholder}
        tabIndex={0}
        role="group"
        aria-label={`${label} (editor loading)`}
        aria-busy="true"
        onKeyDown={readOnly ? undefined : e => {
          const op = opFromKey(e);
          if (!op) return;
          e.preventDefault();
          ops.current.push(op);
        }}
      >{text}</pre>
      <span className="visually-hidden" role="status">Loading code editor…</span>
    </div>
  );
}

export function CodeEditor(props: CodeEditorProps) {
  const id = useId();
  useEffect(() => () => cancelHandoff(id), [id]);
  return (
    <Suspense fallback={<Placeholder id={id} value={props.value} label={props.label} minLines={props.minLines} readOnly={props.readOnly} />}>
      <Editor {...props} handoffId={id} />
    </Suspense>
  );
}
