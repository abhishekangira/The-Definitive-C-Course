// Tiny Markdown renderer for exercise prompts and hints stored in YAML (no HTML passthrough).
// Supports paragraphs, bullet/numbered lists, fenced code blocks, `code`, **bold**, *italic*, [links](url).
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
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
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
    } else if (line.trim() === '') {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^\s*([-*]|\d+\.) /.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={k++}>{inline(para.join(' '), String(k))}</p>);
    }
  }
  return <div className={className}>{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
