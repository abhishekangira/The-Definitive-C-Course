// Hand-over from the editor placeholder to the lazily loaded CodeMirror editor, so a learner who clicks, selects or
// types in the placeholder while the chunk loads keeps their place when it swaps.
//
// What carries over: focus, the selection (or caret), and plain typing (printable keys, Enter, Backspace) in an
// editable editor. What does not: IME composition, Tab/arrow/shortcut keys (the placeholder is not an editor, so it
// ignores them), and paste. Requests are keyed by a per-instance id and dropped when their editor unmounts, so a
// request can never fire for a different editor or after the learner navigated away.

export type InputOp = { type: 'insert'; text: string } | { type: 'enter' } | { type: 'backspace' };

export interface Handoff {
  /** The placeholder had focus when it was replaced. */
  focus: boolean;
  /** Selection in document offsets (anchor === head for a caret). */
  anchor: number;
  head: number;
  /** Keys typed into the placeholder, in order. */
  ops: InputOp[];
}

const pending = new Map<string, Handoff>();

export function stashHandoff(id: string, h: Handoff) { pending.set(id, h); }

/** Returns the request once and forgets it. */
export function takeHandoff(id: string): Handoff | undefined {
  const h = pending.get(id);
  pending.delete(id);
  return h;
}

/** Called when the editor unmounts (navigation): a request that never got picked up must not outlive it. */
export function cancelHandoff(id: string) { pending.delete(id); }

/** The user's selection inside `el` as text offsets, or null when the selection is elsewhere. */
export function selectionWithin(el: HTMLElement): { anchor: number; head: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null;
  const at = (node: Node, offset: number) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, offset);
    return r.toString().length;
  };
  return { anchor: at(sel.anchorNode, sel.anchorOffset), head: at(sel.focusNode, sel.focusOffset) };
}

/** The edit a key press stands for, or null for keys the placeholder leaves alone. */
export function opFromKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }): InputOp | null {
  if (e.ctrlKey || e.metaKey) return null;
  if (e.key === 'Enter') return { type: 'enter' };
  if (e.key === 'Backspace') return { type: 'backspace' };
  if (e.key.length === 1) return { type: 'insert', text: e.key };
  return null;
}
