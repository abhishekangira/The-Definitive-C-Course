// Tiny Markdown renderer for exercise prompts and hints stored in YAML, and for tutor replies (no HTML passthrough).
// Supports paragraphs, bullet/numbered lists, fenced code blocks, GFM pipe tables, `code`, **bold**, *italic*,
// [links](url); code and links also work inside bold and italic.
import { Fragment, type ReactNode } from 'react';

const INVISIBLE = /[\u00ad\u180e\u200b-\u200d\ufeff\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function httpHost(raw: string): string | null {
  const cleaned = raw.normalize('NFKC').replace(INVISIBLE, '').trim();
  if (!/^https?:/i.test(cleaned)) return null;
  try { return new URL(cleaned).host.toLowerCase(); } catch { return null; }
}

/** Link text that names a different host than the href gets that host written out. */
function linkText(label: string, href: string): string {
  const hrefHost = httpHost(href);
  const labelHost = httpHost(label);
  if (!hrefHost || !labelHost || hrefHost === labelHost) return label;
  return `${label} (host: ${hrefHost})`;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\][]+\]\([^)\s[]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    // The inside of bold and italic holds no `*`, so this recursion is at most one level deep.
    else if (tok.startsWith('**')) out.push(<strong key={key}>{inline(tok.slice(2, -2), key)}</strong>);
    else if (tok.startsWith('*')) out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    else {
      const lm = /^\[([^\][]+)\]\(([^)\s[]+)\)$/.exec(tok)!;
      const safe = /^(https?:|#|\.\/)/.test(lm[2]) ? lm[2] : '#';
      out.push(<a key={key} href={safe} target={safe.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{linkText(lm[1], safe)}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** One line of inline Markdown (code, bold, italic, links) with no blocks, for a legend or a label: a `1. ` at its start
 *  stays text, where MiniMarkdown would start a numbered list. */
export function InlineMarkdown({ text }: { text: string }) {
  return <>{inline(text.replace(/\r/g, '').replace(/\s*\n\s*/g, ' '), 'i')}</>;
}

const PIPE = /(?<!\\)\|/;

/** The cells of a table row: one outer pipe dropped at each end, split on unescaped pipes, and `\|` read as `|`
 *  (GFM unescapes it inside code spans too). */
function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(PIPE).map(c => c.trim().replace(/\\\|/g, '|'));
}

/** A GFM table starts at a line with a pipe followed by a delimiter row (`|---|:--:|`) with as many cells. Each
 *  delimiter cell is tested on its own: one regex for the whole row would backtrack badly on long runs. */
function tableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const delim = lines[i + 1];
  if (delim === undefined || !PIPE.test(head) || !delim.includes('-')) return false;
  const d = cells(delim);
  return d.length === cells(head).length && d.every(c => /^:?-+:?$/.test(c));
}

function plain(cell: string): string {
  return cell.replace(/[`*]/g, '');
}

export function MiniMarkdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++}><code>{body.join('\n')}</code></pre>);
    } else if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ''));
      blocks.push(<ul key={k++}>{items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>);
    } else if (/^\s*\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\. /, ''));
      blocks.push(<ol key={k++}>{items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>);
    } else if (tableStart(lines, i)) {
      // Alignment colons are accepted and ignored. A short row gets empty cells and a long one loses its extras (GFM).
      // The box scrolls sideways when the table is wider than its column, so it is a named tab stop (axe's
      // scrollable-region-focusable), like <Transcript>'s output box.
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && PIPE.test(lines[i])) rows.push(cells(lines[i++]));
      const t = k++;
      blocks.push(
        <div key={t} className="md-table" role="region" tabIndex={0} aria-label={`Table: ${head.map(plain).join(', ')}`}>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${t}-h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? '', `${t}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (line.trim() === '') {
      i++;
    } else {
      const para: string[] = [];
      // A table may follow a paragraph line with no blank line between (tutor replies do this).
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^\s*([-*]|\d+\.) /.test(lines[i]) && !(para.length && tableStart(lines, i))) para.push(lines[i++]);
      blocks.push(<p key={k++}>{inline(para.join(' '), String(k))}</p>);
    }
  }
  return <div className={className}>{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
