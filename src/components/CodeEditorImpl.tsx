// CodeMirror 6 editor for C, with clang diagnostics shown as inline markers.
// Loaded on demand through the wrapper in CodeEditor.tsx so CodeMirror stays out of the entry chunk.
// Keyboard: Tab indents; Esc then Tab (or Shift+Tab) moves focus out, so focus is never trapped.
// When the page passes `onRun`, Ctrl+Enter (Cmd+Enter on a Mac) runs the program.
import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, deleteCharBackward, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { syntaxHighlighting, indentOnInput, bracketMatching, HighlightStyle } from '@codemirror/language';
import { linter, lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import type { Diagnostic } from '../content-model/types';
import { takeHandoff } from './editor-focus';
import styles from './CodeEditor.module.css';
import { registerEditorText } from './editorText';

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#ff9ac1' },
  { tag: [t.typeName, t.standard(t.typeName)], color: '#7cd6ff' },
  { tag: [t.string, t.character], color: '#a8e6a3' },
  { tag: [t.number, t.bool], color: '#ffc27a' },
  { tag: t.comment, color: '#8b95a3', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta], color: '#c9a7ff' },
  { tag: t.function(t.variableName), color: '#ffe08a' },
]);

// Light palette: every colour is at least 5:1 on the code background and on the active-line highlight (WCAG AA is 4.5:1).
// CodeMirror's built-in light style is not contrast-checked, so it is not used.
const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#a01c58' },
  { tag: [t.typeName, t.standard(t.typeName)], color: '#0a5c8c' },
  { tag: [t.string, t.character], color: '#1a6b2d' },
  { tag: [t.number, t.bool], color: '#8a4a00' },
  { tag: t.comment, color: '#586270', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta], color: '#6a3fb5' },
  { tag: t.function(t.variableName), color: '#6b4f00' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '14.5px', backgroundColor: 'var(--bg-code)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '10px 0', caretColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-sunken)', color: 'var(--text-faint)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
});

function toCm(view: EditorView, diags: Diagnostic[], file: string): CmDiagnostic[] {
  const doc = view.state.doc;
  return diags
    .filter(d => (d.file === file || d.file.endsWith('/' + file)) && d.severity !== 'note' && d.line >= 1 && d.line <= doc.lines)
    .map(d => {
      const line = doc.line(d.line);
      const from = Math.min(line.from + Math.max(0, d.col - 1), line.to);
      return {
        from,
        to: Math.max(from, Math.min(line.to, from + 1)),
        severity: d.severity === 'warning' ? 'warning' : 'error',
        message: d.flag ? `${d.message} [${d.flag}]` : d.message,
      } satisfies CmDiagnostic;
    });
}

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  diagnostics?: Diagnostic[];
  fileName?: string;
  label: string;
  minLines?: number;
  /** Ctrl/Cmd+Enter inside the editor. Without it that key keeps its default (insert a blank line). */
  onRun?: () => void;
  /** Lines to highlight (1-based), e.g. the stepper's current line. */
  highlightLine?: number | null;
  /** Internal: id of the placeholder this editor replaces (see editor-focus.ts). */
  handoffId?: string;
}

/**
 * The editor content is always an explicit tab stop. A read-only editor is not contenteditable, so it needs one,
 * and axe does not count contenteditable as focusable, so a scrolling editor would otherwise fail
 * "scrollable-region-focusable" even though it is fully keyboard-usable.
 */
function editableExtensions(readOnly?: boolean) {
  return [
    EditorView.editable.of(!readOnly),
    EditorState.readOnly.of(Boolean(readOnly)),
    EditorView.contentAttributes.of({ tabindex: '0' }),
  ];
}

export function CodeEditor({ value, onChange, onRun, readOnly, diagnostics = [], fileName = 'main.c', label, minLines = 4, handoffId }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const highlight = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  useEffect(() => {
    const dark = () => document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(), highlightActiveLine(),
          cpp(),
          highlight.current.of(syntaxHighlighting(dark() ? darkHighlight : lightHighlight)),
          keymap.of([{ key: 'Mod-Enter', run: () => { const run = onRunRef.current; if (!run) return false; run(); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          linter(null), lintGutter(),
          theme,
          editable.current.of(editableExtensions(readOnly)),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
          EditorView.updateListener.of(u => { if (u.docChanged) onChangeRef.current?.(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    const unregister = registerEditorText(v.dom, () => v.state.doc.toString());
    // Re-theme highlighting when the app theme changes, or (with the "System" theme) when the operating system's does.
    const retheme = () => v.dispatch({ effects: highlight.current.reconfigure(syntaxHighlighting(dark() ? darkHighlight : lightHighlight)) });
    const obs = new MutationObserver(retheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', retheme);
    return () => { obs.disconnect(); scheme.removeEventListener('change', retheme); unregister(); v.destroy(); view.current = null; };
    // The editor is created once; value/readOnly updates are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (reset, solution, variant) replace the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  // The learner used the placeholder while this chunk was loading: carry over selection, typed keys and focus.
  // This runs after the value effect above on purpose; that one would otherwise reset the document to the stale prop.
  useEffect(() => {
    const v = view.current;
    const handoff = v && handoffId ? takeHandoff(handoffId) : undefined;
    if (!v || !handoff) return;
    const clamp = (n: number) => Math.max(0, Math.min(n, v.state.doc.length));
    v.dispatch({ selection: { anchor: clamp(handoff.anchor), head: clamp(handoff.head) } });
    if (!readOnly) {
      for (const op of handoff.ops) {
        if (op.type === 'insert') v.dispatch(v.state.replaceSelection(op.text), { userEvent: 'input.type', scrollIntoView: true });
        else if (op.type === 'enter') insertNewlineAndIndent(v);
        else deleteCharBackward(v);
      }
    }
    if (handoff.focus) v.focus();
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(editableExtensions(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, toCm(v, diagnostics, fileName)));
  }, [diagnostics, fileName]);

  // Until CodeMirror has measured its lines it lays out with estimated heights, which is shorter than the placeholder
  // for a frame. Hold the box at the placeholder's exact height (lines x 1.4 x 14.5px + padding + border) until then.
  const baseMin = `${minLines * 1.5 + 1.4}em`;
  const initialMin = useRef(`max(${baseMin}, ${(value.split('\n').length * 20.3 + 22).toFixed(1)}px)`);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => { if (host.current) host.current.style.minHeight = baseMin; }); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [baseMin]);
  return (
    <div className={styles.editor} style={{ minHeight: initialMin.current }} ref={host}
      onKeyDown={e => { if (e.key === 'Escape') (e.currentTarget.querySelector('.cm-content') as HTMLElement | null)?.blur(); }} />
  );
}
