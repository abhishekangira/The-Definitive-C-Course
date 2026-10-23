// @vitest-environment jsdom
// The compare box's copy text (issue #105): exact lines, blank lines kept, gap rows and notes left out.
import { afterEach, describe, expect, it } from 'vitest';
import { compareCopyText, onCompareCopy } from './compareCopy';

type Row = string | { gap: true } | { blank: true; gap?: true };

function box(rows: Row[]): HTMLPreElement {
  const pre = document.createElement('pre');
  for (const r of rows) {
    const span = document.createElement('span');
    span.setAttribute('data-line', '');
    if (typeof r === 'string') {
      // A marked chunk is a nested span, as in DiffLines.
      const [head, mark] = r.split('|');
      span.append(head);
      if (mark !== undefined) { const m = document.createElement('span'); m.textContent = mark; span.append(m); }
    } else {
      if ('gap' in r && r.gap) span.setAttribute('data-gap', '');
      if ('blank' in r) { span.setAttribute('data-blank', ''); span.setAttribute('aria-label', 'empty line'); }
    }
    pre.append(span);
  }
  document.body.append(pre);
  return pre;
}

function whole(el: Element): Range {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r;
}

afterEach(() => { document.body.replaceChildren(); });

describe('compareCopyText', () => {
  it('copies a whole predicted box with its blank line exactly', () => {
    const text = compareCopyText(box(['nope', { blank: true }, 'more']), whole(document.querySelector('pre')!));
    expect(text).toBe('nope\n\nmore');
    expect(text).not.toContain('\u200b');
    expect(text).not.toContain('empty line');
  });

  it('leaves out gap rows, including a gap that carries the empty-line note', () => {
    const pre = box([{ gap: true }, '3 -3 1', { blank: true, gap: true }, '3.|5', { gap: true }]);
    expect(compareCopyText(pre, whole(pre))).toBe('3 -3 1\n3.5');
  });

  it('copies only the selected part of the first and last rows, across a nested mark', () => {
    const pre = box(['abc|def', { blank: true }, 'ghi']);
    const rows = pre.querySelectorAll('[data-line]');
    const r = document.createRange();
    r.setStart(rows[0].querySelector('span')!.firstChild!, 1);
    r.setEnd(rows[2].firstChild!, 2);
    expect(compareCopyText(pre, r)).toBe('ef\n\ngh');
  });

  it('returns null for a selection that is not inside the box', () => {
    const pre = box(['a']);
    const other = document.createElement('p');
    other.textContent = 'elsewhere';
    document.body.append(other);
    expect(compareCopyText(pre, whole(other))).toBeNull();
    expect(compareCopyText(pre, whole(document.body))).toBeNull();
  });
});

describe('onCompareCopy', () => {
  function copy(pre: Element, range: Range) {
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const data = new Map<string, string>();
    let prevented = false;
    onCompareCopy({
      currentTarget: pre,
      clipboardData: { setData: (t: string, v: string) => { data.set(t, v); } } as unknown as DataTransfer,
      preventDefault: () => { prevented = true; },
    });
    return { data, prevented };
  }

  it('writes the exact lines and stops the browser copy', () => {
    const pre = box(['nope', { blank: true }, 'more']);
    const { data, prevented } = copy(pre, whole(pre));
    expect(data.get('text/plain')).toBe('nope\n\nmore');
    expect(prevented).toBe(true);
  });

  it('leaves a copy that starts outside the box to the browser', () => {
    const pre = box(['nope']);
    const { data, prevented } = copy(pre, whole(document.body));
    expect(data.size).toBe(0);
    expect(prevented).toBe(false);
  });
});
