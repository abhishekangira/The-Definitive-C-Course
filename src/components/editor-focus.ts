// Focus hand-off between the editor placeholder and the lazily loaded CodeMirror editor, so a learner who
// tabs into (or clicks) the placeholder while the chunk loads does not lose their place when it swaps.
let pending: string | null = null;

export function requestEditorFocus(label: string) { pending = label; }

/** True once, for the editor whose label asked for focus. */
export function takeEditorFocusRequest(label: string): boolean {
  if (pending !== label) return false;
  pending = null;
  return true;
}
