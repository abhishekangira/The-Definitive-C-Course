// Copy text for a prediction-vs-output compare box (issue #105).
// Chrome's selection copy drops an empty block span (a blank line) and adds a stray "\n" around an empty gap
// row, so the box sets the clipboard itself. Never put a zero-width space in a row to keep a blank line:
// it ends up on the learner's clipboard.

/**
 * The selected text of a compare box: the selected part of each non-gap `[data-line]` row, joined with "\n".
 * Gap rows (the other side's lines) add nothing, and ::before notes are not text. Returns null when the
 * selection is not inside `box` or touches no row, so the browser's own copy runs.
 */
export function compareCopyText(box: Element, range: Range): string | null {
  if (!box.contains(range.commonAncestorContainer)) return null;
  const doc = box.ownerDocument;
  const parts: string[] = [];
  for (const row of box.querySelectorAll('[data-line]')) {
    if (row.hasAttribute('data-gap') || !range.intersectsNode(row)) continue;
    const part = doc.createRange();
    part.selectNodeContents(row);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    parts.push(part.toString());
  }
  return parts.length === 0 ? null : parts.join('\n');
}

/** onCopy for a compare box: the exact lines it shows, or the browser default when the selection is elsewhere. */
export function onCompareCopy(e: { currentTarget: Element; clipboardData: DataTransfer | null; preventDefault(): void }): void {
  const sel = e.currentTarget.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !e.clipboardData) return;
  const text = compareCopyText(e.currentTarget, sel.getRangeAt(0));
  if (text === null) return;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
}

/** The browser's own text for `range` (layout-aware, as a copy would give), read through the selection. */
function nativeText(sel: Selection, range: Range): string {
  sel.removeAllRanges();
  sel.addRange(range);
  return sel.toString();
}

/**
 * Copy text for a selection that crosses a compare box's edge (from its label into it, from one box into the
 * other, or Ctrl+A): the browser's text outside the boxes, and {@link compareCopyText} for the part of each box
 * the selection covers, one box per line. Returns null when the selection touches no box or sits inside one box
 * (the box's own onCopy handles that). Restores the selection, direction included.
 */
export function selectionCopyText(doc: Document): string | null {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const boxes = [...doc.querySelectorAll('pre[data-compare]')].filter(b => range.intersectsNode(b));
  if (boxes.length === 0 || (boxes.length === 1 && boxes[0].contains(range.commonAncestorContainer))) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
  const parts: string[] = [];
  const push = (t: string) => { const s = t.replace(/^\n+|\n+$/g, ''); if (s !== '') parts.push(s); };
  try {
    let from = range.cloneRange();
    from.collapse(true);
    for (const box of boxes) {
      const inBox = doc.createRange();
      inBox.selectNodeContents(box);
      if (range.compareBoundaryPoints(Range.START_TO_START, inBox) > 0) inBox.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, inBox) < 0) inBox.setEnd(range.endContainer, range.endOffset);
      const before = from.cloneRange();
      before.setEndBefore(box);
      // setEndBefore collapses `before` when the selection starts inside this box.
      if (!before.collapsed) push(nativeText(sel, before));
      const t = compareCopyText(box, inBox);
      if (t !== null) parts.push(t);
      from = doc.createRange();
      from.setStartAfter(box);
    }
    const after = from.cloneRange();
    if (range.compareBoundaryPoints(Range.START_TO_END, after) > 0) { // this range's end against after's start
      after.setEnd(range.endContainer, range.endOffset);
      push(nativeText(sel, after));
    }
  } finally {
    if (anchorNode && focusNode) sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  }
  return parts.join('\n');
}

/** Document copy listener for {@link selectionCopyText}. Leaves a copy already handled (a box's onCopy) alone. */
export function onDocumentCopy(e: ClipboardEvent): void {
  if (e.defaultPrevented || !e.clipboardData) return;
  const doc = (e.target instanceof Node ? e.target.ownerDocument : null) ?? document;
  const text = selectionCopyText(doc);
  if (text === null) return;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
}

let listeners = 0;

/** Adds {@link onDocumentCopy} while at least one compare is mounted. Returns the matching remove. */
export function listenForCopy(doc: Document): () => void {
  if (listeners++ === 0) doc.addEventListener('copy', onDocumentCopy);
  return () => { if (--listeners === 0) doc.removeEventListener('copy', onDocumentCopy); };
}
