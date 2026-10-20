// "Explain" and "Reply", shown beside text the learner highlights in a lesson (like the Claude desktop app).
// Pointer and touch only: the chat panel is the keyboard route, because a toolbar that follows a selection cannot be
// reached in tab order. A selection made or changed with the keyboard (Shift+arrows, Ctrl+A) never shows it.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { readLessonSelection } from './selection';
import styles from './LessonChat.module.css';

export type SelectionAction = 'explain' | 'reply';

const TOOLBAR_WIDTH = 164;
const TOOLBAR_HEIGHT = 40;
const GAP = 8;
/** A selection must hold still this long (no pointer down) before the toolbar follows it. A drag never flickers it. */
const SETTLE_MS = 250;
const MOVES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
/** Keys that make or change a selection. */
const selectsByKey = (e: KeyboardEvent) => (e.shiftKey && MOVES.has(e.key)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a');

interface Placed { text: string; top: number; left: number }

/** Below the end of the selection; above its start when that would leave the screen. */
function place(range: Range): Pick<Placed, 'top' | 'left'> {
  const rects = [...range.getClientRects()].filter(r => r.width > 0 || r.height > 0);
  const first = rects[0] ?? range.getBoundingClientRect();
  const last = rects[rects.length - 1] ?? first;
  let top = last.bottom + GAP;
  if (top + TOOLBAR_HEIGHT > window.innerHeight) top = Math.max(GAP, first.top - TOOLBAR_HEIGHT - GAP);
  const left = Math.min(Math.max(GAP, last.right - TOOLBAR_WIDTH / 2), window.innerWidth - TOOLBAR_WIDTH - GAP);
  return { top: Math.round(top), left: Math.round(left) };
}

export function SelectionToolbar({ container, onAction }: { container: RefObject<HTMLElement | null>; onAction: (action: SelectionAction, quote: string) => void }) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);
  /** The current selection was made or changed with the keyboard. A press of the pointer starts a new one. */
  const byKeys = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const evaluate = () => {
      const root = container.current;
      const found = root && !byKeys.current ? readLessonSelection(root) : null;
      if (!found) { setPlaced(null); return; }
      const where = place(found.range);
      setPlaced(prev => (prev && prev.text === found.text && prev.top === where.top && prev.left === where.left ? prev : { text: found.text, ...where }));
    };
    const later = (ms: number) => { clearTimeout(timer); timer = setTimeout(evaluate, ms); };
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) { clearTimeout(timer); setPlaced(null); return; }
      if (!pointerDown.current) later(SETTLE_MS);
    };
    const onPointerDown = (e: PointerEvent) => {
      // A press on the toolbar must not count as "selecting", or the buttons would vanish under the pointer.
      if (e.target instanceof Node && toolbar.current?.contains(e.target)) return;
      pointerDown.current = true;
      byKeys.current = false;
    };
    const onPointerUp = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      later(10);
    };
    // A keyboard selection hides the toolbar (it could not be reached with Tab); Escape hides it too.
    const onKeyDown = (e: KeyboardEvent) => { if (selectsByKey(e)) byKeys.current = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Escape' || byKeys.current) { clearTimeout(timer); setPlaced(null); } };
    const onMove = () => later(30);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [container]);

  if (!placed) return null;
  const choose = (action: SelectionAction) => {
    onAction(action, placed.text);
    // The passage now sits in the chat. Dropping the highlight puts the page back the way it was.
    window.getSelection()?.removeAllRanges();
    setPlaced(null);
  };
  return createPortal(
    <div
      ref={toolbar} className={styles.toolbar} role="toolbar" aria-label="Ask the tutor about the highlighted text"
      style={{ top: placed.top, left: placed.left }}
      // Keep the highlight and the focus where they are while a button is pressed.
      onMouseDown={e => e.preventDefault()}
      data-tutor="selection"
    >
      <button type="button" className="btn btn-sm" onClick={() => choose('explain')}>Explain</button>
      <button type="button" className="btn btn-sm" onClick={() => choose('reply')}>Reply</button>
    </div>,
    document.body,
  );
}
