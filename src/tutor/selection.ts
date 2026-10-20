// What the learner highlighted in the lesson, if it is something the lesson chat may take (PLAN.md §2.6).
import { LEFT_OUT_SELECTOR } from './lessonText';

/** A quote longer than this is cut. The chat shows it in a small box and sends it in every later request. */
export const MAX_QUOTE = 2_000;

export interface LessonSelection {
  text: string;
  range: Range;
}

/** The selection inside `container`, or null when it is empty, outside the lesson, or touches an exercise (the lesson chat leaves those out). */
export function readLessonSelection(container: Element, selection: Selection | null = window.getSelection()): LessonSelection | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  // A range that reaches into an exercise would quote it.
  for (const skipped of container.querySelectorAll(LEFT_OUT_SELECTOR)) {
    if (range.intersectsNode(skipped)) return null;
  }
  const text = selection.toString().replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  if (text.length < 2) return null;
  return { text: text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text, range };
}
