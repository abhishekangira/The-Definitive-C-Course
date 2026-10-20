// The lesson as the learner sees it right now, as plain text for the lesson chat (PLAN.md §2.6).
//
// This reads the rendered page, not the MDX source, on purpose. A lesson is gated: the parts the learner has not
// reached are not in the DOM, a quiz's answer and explanation appear only after it is answered, and a sample's
// output appears only after it ran. So the tutor knows what the learner knows, and cannot give away the next
// prediction. The source has all of it (`answer=` and `explain=` sit in the MDX).

import { editorText } from '../components/editorText';

/** Never part of the lesson text: controls, media, and things only a screen reader needs. */
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'button', 'textarea', 'input', 'select', 'canvas', 'video', 'audio', 'img', 'iframe']);
/** Elements that are set apart from their neighbours by a blank line. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'legend', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
]);
/** Elements that only start a new line: list items and table rows stay together. */
const LINE_TAGS = new Set(['dd', 'dt', 'li', 'tr']);
/** CodeMirror: the gutter holds line numbers, and the announcer is a live region. Neither is code. */
const SKIP_CLASSES = ['visually-hidden', 'cm-gutters', 'cm-announced', 'cm-panels'];

export const MAX_LESSON_TEXT = 60_000;
/**
 * A problem inside a lesson has its own tutor (hints in order, a check of the learner's code, a guard against
 * repeating the solution). The lesson chat has none of that, so it neither reads these nor takes a highlight in them.
 */
export const LEFT_OUT_SELECTOR = '[data-exercise]';
/** On the <details> that holds the transcript of an animation or a video. The lesson chat reads it open or closed. */
export const TRANSCRIPT_MARK = 'data-transcript';
const LEFT_OUT_NOTE = '[An exercise is here. Its text is left out.]';

function skipped(el: Element): boolean {
  if (SKIP_TAGS.has(el.localName)) return true;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  return SKIP_CLASSES.some(c => el.classList.contains(c));
}

function codeLines(el: Element): string {
  // The editor's whole document when it is registered: a long one renders only the lines near the viewport.
  const whole = editorText(el);
  if (whole !== null) return whole.replace(/\s+$/, '');
  const lines = [...el.querySelectorAll('.cm-line')];
  return (lines.length ? lines.map(l => l.textContent ?? '') : [el.textContent ?? '']).join('\n').replace(/\s+$/, '');
}

function fence(code: string): string {
  return `\n\`\`\`\n${code}\n\`\`\`\n`;
}

function render(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  if (el.matches(LEFT_OUT_SELECTOR)) return `\n${LEFT_OUT_NOTE}\n`;
  if (skipped(el)) return '';
  const name = el.localName;
  if (name === 'br') return '\n';
  if (el.classList.contains('cm-editor')) return fence(codeLines(el));
  if (name === 'pre') return fence((el.textContent ?? '').replace(/\s+$/, ''));
  // A closed <details> shows its summary only, except a video's transcript: it is there to be read, and the learner
  // who asks about the video has the right to expect the tutor has.
  const children = name === 'details' && !el.hasAttribute('open') && !el.hasAttribute(TRANSCRIPT_MARK)
    ? [...el.children].filter(c => c.localName === 'summary')
    : [...el.childNodes];
  let inner = children.map(render).join('');
  if (name === 'code') return inner.trim() ? `\`${inner.trim()}\`` : '';
  if (name === 'td' || name === 'th') return `${inner.trim()} | `;
  // A list whose items are all controls (the step chips of an animation) reads as nothing, not as a column of dashes.
  if (name === 'li') inner = inner.trim() ? `- ${inner.trim()}` : '';
  else if (/^h[1-6]$/.test(name)) inner = `${'#'.repeat(Number(name[1]))} ${inner.trim()}`;
  if (el.hasAttribute('data-card')) {
    const label = el.getAttribute('aria-label');
    inner = `${label ? `--- ${label} ---` : '---'}${inner.startsWith('\n') ? '' : '\n'}${inner}`;
  }
  if (LINE_TAGS.has(name)) return `\n${inner}`;
  return BLOCK_TAGS.has(name) || el.hasAttribute('data-card') ? `\n${inner}\n` : inner;
}

/**
 * The text under `root`, as light Markdown: headings, list items, `inline code`, fenced code (CodeMirror editors
 * and <pre>), a `--- Part n of m ---` line before each card, and the transcript of each video or animation shown. An exercise is replaced by a one-line note, so the
 * model knows something is there but not what.
 */
export function lessonTextFrom(root: Element): string {
  // Text nodes already collapsed their own whitespace. What is left is the space around block boundaries, which
  // goes everywhere except inside a fence, where indentation is the point.
  let inFence = false;
  const lines = render(root).split('\n').map(line => {
    if (line.startsWith('```')) { inFence = !inFence; return line; }
    return inFence ? line.replace(/\s+$/, '') : line.replace(/\s+/g, ' ').trim();
  });
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > MAX_LESSON_TEXT ? `${text.slice(0, MAX_LESSON_TEXT)}\n[Lesson text shortened.]` : text;
}
