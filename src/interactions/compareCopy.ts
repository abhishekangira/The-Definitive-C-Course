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
