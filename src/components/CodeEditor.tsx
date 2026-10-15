// CodeMirror 6 editor for C, with clang diagnostics shown as inline markers.
// Keyboard: Tab indents; Esc then Tab (or Shift+Tab) moves focus out, so focus is never trapped.
import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, HighlightStyle } from '@codemirror/language';
import { linter, lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import type { Diagnostic } from '../content-model/types';
import styles from './CodeEditor.module.css';

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#ff9ac1' },
  { tag: [t.typeName, t.standard(t.typeName)], color: '#7cd6ff' },
  { tag: [t.string, t.character], color: '#a8e6a3' },
  { tag: [t.number, t.bool], color: '#ffc27a' },
  { tag: t.comment, color: '#8b95a3', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta], color: '#c9a7ff' },
  { tag: t.function(t.variableName), color: '#ffe08a' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '14.5px', backgroundColor: 'var(--bg-code)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '10px 0', caretColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-sunken)', color: 'var(--text-faint)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
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
  /** Lines to highlight (1-based), e.g. the stepper's current line. */
  highlightLine?: number | null;
}

export function CodeEditor({ value, onChange, readOnly, diagnostics = [], fileName = 'main.c', label, minLines = 4 }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const highlight = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
          highlight.current.of(syntaxHighlighting(dark() ? darkHighlight : defaultHighlightStyle, { fallback: true })),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          linter(null), lintGutter(),
          theme,
          editable.current.of([EditorView.editable.of(!readOnly), EditorState.readOnly.of(Boolean(readOnly))]),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
          EditorView.updateListener.of(u => { if (u.docChanged) onChangeRef.current?.(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    // Re-theme highlighting when the app theme changes.
    const obs = new MutationObserver(() => v.dispatch({ effects: highlight.current.reconfigure(syntaxHighlighting(dark() ? darkHighlight : defaultHighlightStyle, { fallback: true })) }));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { obs.disconnect(); v.destroy(); view.current = null; };
    // The editor is created once; value/readOnly updates are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (reset, solution, variant) replace the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorView.editable.of(!readOnly), EditorState.readOnly.of(Boolean(readOnly))]) });
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, toCm(v, diagnostics, fileName)));
  }, [diagnostics, fileName]);

  return (
    <div className={styles.editor} style={{ minHeight: `${minLines * 1.5 + 1.4}em` }} ref={host}
      onKeyDown={e => { if (e.key === 'Escape') (e.currentTarget.querySelector('.cm-content') as HTMLElement | null)?.blur(); }} />
  );
}
