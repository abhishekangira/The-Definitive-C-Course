// @vitest-environment jsdom
// What the lesson chat reads from the page. It must be what the learner sees, as light Markdown, and nothing else.
import { describe, expect, it } from 'vitest';
import { lessonTextFrom, MAX_LESSON_TEXT } from './lessonText';

function read(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  return lessonTextFrom(root);
}

describe('lessonTextFrom', () => {
  it('turns prose into Markdown: headings, paragraphs, list items, inline code', () => {
    const text = read('<h2>Types</h2><p>An <code>int</code> is\n  four bytes.</p><ul><li>one</li><li>two <strong>bold</strong></li></ul>');
    expect(text).toBe('## Types\n\nAn `int` is four bytes.\n\n- one\n- two bold');
  });

  it('drops a list item that holds only controls', () => {
    expect(read('<p>Steps</p><ol><li><button>Source</button></li><li><button>Run</button></li></ol><p>Done</p>')).toBe('Steps\n\nDone');
  });

  it('marks each part of the lesson, so the model can tell what has been reached', () => {
    const text = read('<section data-card="0" aria-label="Part 1 of 3"><p>First.</p></section><section data-card="1" aria-label="Part 2 of 3"><p>Second.</p></section>');
    expect(text).toBe('--- Part 1 of 3 ---\nFirst.\n\n--- Part 2 of 3 ---\nSecond.');
  });

  it('keeps indentation in code, reading CodeMirror line by line and leaving out its line numbers', () => {
    const editor = '<div class="cm-editor"><div class="cm-gutters"><div class="cm-gutterElement">1</div><div class="cm-gutterElement">2</div></div>'
      + '<div class="cm-content"><div class="cm-line">int main(void) {</div><div class="cm-line">    return 0;</div><div class="cm-line">}</div></div></div>';
    expect(read(`<p>Code:</p>${editor}`)).toBe('Code:\n\n```\nint main(void) {\n    return 0;\n}\n```');
    expect(read('<pre><code>a\n  b</code></pre>')).toBe('```\na\n  b\n```');
  });

  it('leaves out controls, hidden and decorative things, and a closed <details> body', () => {
    const text = read([
      '<p>Shown.</p>',
      '<button>Run</button><textarea>my guess</textarea><input value="x">',
      '<svg><text>icon</text></svg><span aria-hidden="true">decoration</span><span class="visually-hidden">Loading code editor</span>',
      '<p hidden>hidden paragraph</p>',
      '<details><summary>Hint</summary><p>Secret hint text</p></details>',
      '<details open><summary>Open</summary><p>Visible body</p></details>',
    ].join(''));
    expect(text).toContain('Shown.');
    expect(text).toContain('Hint');
    expect(text).toContain('Visible body');
    for (const gone of ['Run', 'my guess', 'icon', 'decoration', 'Loading code editor', 'hidden paragraph', 'Secret hint text']) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it('replaces an exercise with a note: the lesson chat is not the exercise tutor', () => {
    const text = read('<p>Before.</p><div data-exercise="cash"><h3>Cash</h3><p>Write change-making code.</p><div class="cm-editor"><div class="cm-line">int main(void) {}</div></div></div><p>After.</p>');
    expect(text).toBe('Before.\n\n[An exercise is here. Its text is left out.]\n\nAfter.');
  });

  it('reads a table and a quiz option the way it is laid out', () => {
    expect(read('<table><tr><th>type</th><th>bytes</th></tr><tr><td>int</td><td>4</td></tr></table>')).toBe('type | bytes |\nint | 4 |');
    expect(read('<fieldset><legend>Which one?</legend><label><input type="radio"> Option A</label><label><input type="radio"> Option B</label></fieldset>'))
      .toContain('Which one?');
  });

  it('is capped, with a note, so a huge page cannot make a huge request', () => {
    const text = read(`<p>${'word '.repeat(MAX_LESSON_TEXT)}</p>`);
    expect(text.length).toBeLessThan(MAX_LESSON_TEXT + 40);
    expect(text.endsWith('[Lesson text shortened.]')).toBe(true);
  });
});

describe('lessonTextFrom reads a video transcript', () => {
  it('reads the transcript of an animation or video even though its <details> is closed', () => {
    const text = read('<figure><figcaption>What happens when you press Run</figcaption><details data-transcript><summary>Transcript</summary><p>The page sends your source text to a Web Worker.</p></details></figure>');
    expect(text).toContain('What happens when you press Run');
    expect(text).toContain('Transcript');
    expect(text).toContain('The page sends your source text to a Web Worker.');
  });

  it('still hides the body of any other closed <details>', () => {
    expect(read('<details><summary>Transcript</summary><p>not marked</p></details>')).not.toContain('not marked');
  });
});
