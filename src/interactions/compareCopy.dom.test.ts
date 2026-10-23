// @vitest-environment jsdom
// The compare box's copy text (issue #105): exact lines, blank lines kept, gap rows and notes left out.
import { afterEach, describe, expect, it } from 'vitest';
import { compareCopyText, listenForCopy, onCompareCopy, selectionCopyText } from './compareCopy';

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

  it('returns null, not an empty string, for a selection in the box that touches no row', () => {
    const pre = box(['a', 'b']);
    const r = document.createRange();
    r.setStart(pre, 0);
    r.setEnd(pre, 0);
    expect(compareCopyText(pre, r)).toBeNull();
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

  it('leaves a collapsed selection (a caret in a row) to the browser', () => {
    const pre = box(['nope', 'more']);
    const r = document.createRange();
    r.setStart(pre.querySelector('[data-line]')!.firstChild!, 2);
    const { data, prevented } = copy(pre, r);
    expect(data.size).toBe(0);
    expect(prevented).toBe(false);
  });

  it('leaves a copy that starts outside the box to the browser', () => {
    const pre = box(['nope']);
    const { data, prevented } = copy(pre, whole(document.body));
    expect(data.size).toBe(0);
    expect(prevented).toBe(false);
  });
});

describe('selectionCopyText and listenForCopy', () => {
  function select(range: Range) {
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it('is null for a selection inside one box (its onCopy handles it) or touching no box', () => {
    const pre = box(['nope', { blank: true }, 'more']);
    pre.setAttribute('data-compare', 'predicted');
    select(whole(pre));
    expect(selectionCopyText(document)).toBeNull();
    const p = document.createElement('p');
    p.textContent = 'elsewhere';
    document.body.append(p);
    select(whole(p));
    expect(selectionCopyText(document)).toBeNull();
  });

  it('keeps the blank line and drops gap rows for a selection over two labelled boxes, and restores the selection', () => {
    const label = (t: string) => { const d = document.createElement('div'); d.textContent = t; document.body.append(d); };
    label('You predicted');
    const a = box(['nope', { blank: true }, 'more']);
    label('Actual output');
    const b = box(['nope', { gap: true }, 'more']);
    label('after');
    a.setAttribute('data-compare', 'predicted');
    b.setAttribute('data-compare', 'actual');
    select(whole(document.body));
    const before = document.getSelection()!.getRangeAt(0).cloneRange();
    expect(selectionCopyText(document)).toBe('You predicted\nnope\n\nmore\nActual output\nnope\nmore\nafter');
    const after = document.getSelection()!.getRangeAt(0);
    expect([after.startContainer, after.startOffset, after.endContainer, after.endOffset]).toEqual([before.startContainer, before.startOffset, before.endContainer, before.endOffset]);
  });

  it('keeps the document listener until the last compare goes away', () => {
    const a = box(['nope', { blank: true }, 'more']);
    const b = box(['x']);
    a.setAttribute('data-compare', 'predicted');
    b.setAttribute('data-compare', 'actual');
    const fire = () => {
      select(whole(document.body));
      const data = new Map<string, string>();
      const e = new Event('copy', { cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { setData: (t: string, v: string) => { data.set(t, v); } };
      document.dispatchEvent(e);
      return data.get('text/plain');
    };
    const stopA = listenForCopy(document);
    const stopB = listenForCopy(document);
    stopA();
    expect(fire()).toBe('nope\n\nmore\nx');
    stopB();
    expect(fire()).toBeUndefined();
  });
});
