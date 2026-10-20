// The whole document of each mounted code editor, keyed by its `.cm-editor` element. CodeMirror only renders the lines
// near the viewport, so the DOM of a long editor holds part of the code; the lesson chat reads the rest from here
// without importing CodeMirror.
const docs = new WeakMap<Element, () => string>();

export function registerEditorText(dom: Element, read: () => string): () => void {
  docs.set(dom, read);
  return () => { docs.delete(dom); };
}

/** The full code of the editor whose root is `dom`, or null when it is not a registered editor. */
export function editorText(dom: Element): string | null {
  return docs.get(dom)?.() ?? null;
}
