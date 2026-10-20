// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_QUOTE, readLessonSelection } from './selection';

let container: HTMLElement;
function mount(html: string): HTMLElement {
  container?.remove();
  container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}
function select(from: Node, fromOffset: number, to: Node, toOffset: number) {
  const range = document.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}
afterEach(() => { window.getSelection()?.removeAllRanges(); container?.remove(); });

describe('readLessonSelection', () => {
  it('returns the highlighted text inside the lesson', () => {
    const root = mount('<p id="p">A compiler turns source into a program.</p>');
    const text = root.querySelector('#p')!.firstChild!;
    select(text, 2, text, 10);
    expect(readLessonSelection(root)?.text).toBe('compiler');
  });

  it('returns nothing for no selection, a caret, a single character, or a selection outside the lesson', () => {
    const root = mount('<p id="p">Inside</p>');
    const outside = document.createElement('p');
    outside.textContent = 'Outside the lesson';
    document.body.appendChild(outside);
    expect(readLessonSelection(root)).toBeNull();
    const text = root.querySelector('#p')!.firstChild!;
    select(text, 1, text, 1);
    expect(readLessonSelection(root)).toBeNull();
    select(text, 1, text, 2);
    expect(readLessonSelection(root)).toBeNull();
    select(outside.firstChild!, 0, outside.firstChild!, 7);
    expect(readLessonSelection(root)).toBeNull();
    outside.remove();
  });

  it('returns nothing when the highlight is in an exercise or reaches into one', () => {
    const root = mount('<p id="a">Before the exercise</p><div data-exercise="cash"><p id="b">Write change-making code</p></div><p id="c">After the exercise</p>');
    const a = root.querySelector('#a')!.firstChild!;
    const b = root.querySelector('#b')!.firstChild!;
    const c = root.querySelector('#c')!.firstChild!;
    select(b, 0, b, 10);
    expect(readLessonSelection(root), 'inside').toBeNull();
    select(a, 0, c, 5);
    expect(readLessonSelection(root), 'across').toBeNull();
    select(a, 0, a, 6);
    expect(readLessonSelection(root)?.text, 'next to it').toBe('Before');
  });

  it('cuts a very long highlight', () => {
    const root = mount(`<p id="p">${'word '.repeat(2000)}</p>`);
    const text = root.querySelector('#p')!.firstChild!;
    select(text, 0, text, text.textContent!.length);
    const found = readLessonSelection(root)!;
    expect(found.text.length).toBe(MAX_QUOTE + 1);
    expect(found.text.endsWith('…')).toBe(true);
  });
});
