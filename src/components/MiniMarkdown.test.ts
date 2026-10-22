// MiniMarkdown's tables and emphasis nesting (issue #100). Hostile input is covered in src/untrusted-input.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { MiniMarkdown } from './MiniMarkdown';

const html = (text: string) => renderToStaticMarkup(createElement(MiniMarkdown, { text }));
const count = (h: string, tag: string) => h.split(`<${tag}>`).length - 1;
const bodyRows = (h: string) => [...h.matchAll(/<tbody>(.*?)<\/tbody>/g)].map(m => [...m[1].matchAll(/<tr>(.*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<td>(.*?)<\/td>/g)].map(c => c[1])));
const paragraphs = (h: string) => [...h.matchAll(/<p>(.*?)<\/p>/g)].map(m => m[1]);

/** The tutor reply from the issue's screenshot: the intro line sits directly above the header row. */
const REPLY = [
  '`printf` prints values according to **format specifiers** that appear after the `%` in the format string:',
  '| Specifier | C type it expects | What it prints |',
  '|-----------|-------------------|----------------|',
  '| `%d` | `int` (signed integer) | decimal integer |',
  '| `%f` | `double` (or `float` promoted) | floating-point number |',
  '',
  '`sizeof` yields a value of type **`size_t`**. Because it\'s an *unsigned* type, the correct specifier is **`%zu`**:',
  '',
  '- `z` – tells `printf` the argument is of type `size_t`.',
  '- `u` – prints an unsigned decimal integer.',
].join('\n');

describe('MiniMarkdown tables', () => {
  it('renders a tutor reply table that follows a paragraph line, in a named box that can take focus', () => {
    const out = html(REPLY);
    expect(count(out, 'table')).toBe(1);
    expect(count(out, 'th')).toBe(3);
    expect(bodyRows(out)).toEqual([[
      ['<code>%d</code>', '<code>int</code> (signed integer)', 'decimal integer'],
      ['<code>%f</code>', '<code>double</code> (or <code>float</code> promoted)', 'floating-point number'],
    ]]);
    expect(out).toContain('<div class="md-table" role="region" tabindex="0" aria-label="Table: Specifier, C type it expects, What it prints"><table>');
    const paras = paragraphs(out);
    expect(paras[0]).toMatch(/in the format string:$/);
    expect(paras.filter(p => p.includes('|'))).toEqual([]);
    expect(count(out, 'li')).toBe(2);
  });

  it('renders the Bit puzzles prompt from content as a table, with escaped pipes unescaped inside code', () => {
    const file = path.join(process.cwd(), 'content/modules/m02-bits-bytes-numbers/exercises/bitlab-lite/exercise.yaml');
    const { prompt } = parseYaml(readFileSync(file, 'utf8')) as { prompt: string };
    const out = html(prompt);
    expect([...out.matchAll(/<th>(.*?)<\/th>/g)].map(m => m[1])).toEqual(['function', 'job', 'allowed operators', 'at most']);
    const [rows] = bodyRows(out);
    expect(rows).toHaveLength(6);
    expect(rows[0][0]).toBe('<code>bit_and(x, y)</code>');
    expect(rows[0][2]).toBe('<code>~</code> <code>|</code>');
    expect(out).not.toContain('\\|');
    expect(paragraphs(out).filter(p => p.includes('| function |'))).toEqual([]);
  });

  it('leaves text that is not a table alone', () => {
    expect(html('a | b\nnot a delimiter')).toBe('<div><p>a | b not a delimiter</p></div>');
    expect(html('| a | b |\n|---|\n| 1 | 2 |')).not.toContain('<table>');
    expect(html('```\n| a |\n|---|\n```')).toBe('<div><pre><code>| a |\n|---|</code></pre></div>');
    expect(html('`x | y` in prose')).toBe('<div><p><code>x | y</code> in prose</p></div>');
    expect(html('| a |\n|-x-|')).not.toContain('<table>');
  });

  it('pads a short row, drops the extra cells of a long one, ignores alignment and ends at a line with no pipe', () => {
    const out = html('| a | b |\n|:--|--:|\n| 1 |\n| 1 | 2 | 3 |\nafter');
    expect(bodyRows(out)).toEqual([[['1', ''], ['1', '2']]]);
    expect(out).not.toContain('style=');
    expect(out).toMatch(/<\/table><\/div><p>after<\/p>/);
  });

  it('renders inline Markdown in cells', () => {
    expect(bodyRows(html('| a |\n|---|\n| **bold** and [docs](https://example.com/x) |'))).toEqual([[
      ['<strong>bold</strong> and <a href="https://example.com/x" target="_blank" rel="noreferrer">docs</a>'],
    ]]);
  });
});

describe('MiniMarkdown emphasis', () => {
  it('renders code and links inside bold and italic', () => {
    expect(html('type **`size_t`**')).toBe('<div><p>type <strong><code>size_t</code></strong></p></div>');
    expect(html('*see [docs](https://example.com/x)*')).toBe('<div><p><em>see <a href="https://example.com/x" target="_blank" rel="noreferrer">docs</a></em></p></div>');
    expect(html('**a** and *b*')).toBe('<div><p><strong>a</strong> and <em>b</em></p></div>');
  });
});
