// Leak guard (PLAN.md §2.6). Runs on the model reply before it is shown.
//
// Both sides are normalised the same way: NFKC, zero-width and bidi marks removed, case-folded,
// markdown emphasis and backticks dropped, quotes removed, whitespace collapsed away.
// Comments are handled twice, because stripping them to compare and then showing the original
// reply is how a commented solution line used to get through. One pass keeps comment text (it is
// visible) and one pass drops terminated comment bodies (so a comment inside a line cannot hide
// the code). `://` is not a comment, and an unterminated `/*` does not swallow the rest.
// The reply is refused when a solution line the learner does not already have appears as a whole
// line, as a token window, or as a multi-line window, or when a code block is longer than three
// lines. A miss is a refusal: the original reply is not shown.

export const MAX_CODE_BLOCK_LINES = 3;
const MAX_REPLY_CHARS = 8_000;
/** `x;` is worth refusing. Brackets alone are not. */
const MIN_LINE = 2;
/** A partial window shorter than this matches too much ordinary prose. Whole lines can be shorter. */
const MIN_WINDOW = 8;

const ZERO_WIDTH = /[\u00AD\u180E\u200B-\u200D\u2060\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export type LeakReason = 'solution-line' | 'code-block';

export interface GuardedReply {
  show: string;
  blocked: boolean;
  reason?: LeakReason;
}

/**
 * Drop `//` and terminated block comments. A comment marker inside a string is kept.
 * `://` is a URL, not a comment. An unterminated block comment drops only the marker,
 * so the rest of the text is still visible to the comparison. Linear in the input.
 */
export function stripCComments(src: string): string {
  return scanComments(src, false);
}

function scanComments(src: string, keepBody: boolean): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/' && src[i - 1] !== ':') {
      i += 2;
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      if (keepBody) out += src.slice(start, i);
      continue;
    }
    if (c === '/' && d === '*') {
      const start = i + 2;
      let j = start;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      if (j >= n) {
        i += 2;
        out += ' ';
        continue;
      }
      out += keepBody ? src.slice(start, j) : ' ';
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        const ch = src[i];
        out += ch;
        i++;
        if (ch === '\\' && i < n) { out += src[i]; i++; continue; }
        if (ch === q || ch === '\n') break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function prep(src: string): string {
  return src.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase();
}

function dropMarkdown(src: string): string {
  // `*`, backticks and `~~` are emphasis. Underscores between identifier characters stay (`my_var`).
  return src
    .replace(/[`*~]+/g, '')
    .replace(/__/g, '')
    .replace(/(^|[^a-z0-9])_+/g, '$1')
    .replace(/_+($|[^a-z0-9])/g, '$1');
}

function compact(src: string): string {
  return dropMarkdown(src).replace(/["']/g, '').replace(/\s+/g, '');
}

function isSignal(line: string): boolean {
  return line.length >= MIN_LINE && /[a-z0-9]/.test(line) && !/^[{}()[\];,]+$/.test(line);
}

function solutionLines(src: string): string[] {
  return scanComments(prep(src), false).split('\n').map(compact).filter(isSignal);
}

function haystacks(src: string): string[] {
  const ready = prep(src);
  return [compact(scanComments(ready, true)), compact(scanComments(ready, false))];
}

function tokenWindows(line: string): string[] {
  const tokens = line.match(/[a-z_][a-z0-9_]*|\\n|\d+|[^a-z0-9_\\]/g);
  if (!tokens || tokens.length < 2) return [];
  const windows: string[] = [];
  for (let n = 2; n < tokens.length; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const w = tokens.slice(i, i + n).join('');
      if (w.length >= MIN_WINDOW && /[;{}()=]/.test(w)) windows.push(w);
    }
  }
  return windows;
}

function multiLineWindows(lines: string[]): string[] {
  const windows: string[] = [];
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= lines.length; i++) windows.push(lines.slice(i, i + n).join(''));
  }
  return windows;
}

function isFence(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('```') || t.startsWith('~~~');
}

function fencedCounts(reply: string): number[] {
  const counts: number[] = [];
  let open = false;
  let count = 0;
  for (const line of reply.split('\n')) {
    if (isFence(line)) {
      if (open) counts.push(count);
      open = !open;
      count = 0;
      continue;
    }
    if (open && line.trim() !== '') count++;
  }
  if (open) counts.push(count);
  return counts;
}

function looksLikeCode(rawLine: string): boolean {
  const marked = scanComments(rawLine, true).trim();
  if (!marked) return false;
  if (/[;{}]\s*$/.test(marked)) return true;
  const indented = rawLine.startsWith('\t') || /^\s{2,}\S/.test(rawLine);
  return indented && /[=()]/.test(marked);
}

/** A run of more than three code lines. Blank lines do not break the run. */
function hasLongStatementRun(reply: string): boolean {
  let run = 0;
  let fence = false;
  for (const line of reply.split('\n')) {
    if (isFence(line)) { fence = !fence; run = 0; continue; }
    if (fence) { run = 0; continue; }
    if (line.trim() === '') continue;
    if (looksLikeCode(line)) {
      run++;
      if (run > MAX_CODE_BLOCK_LINES) return true;
    } else run = 0;
  }
  return false;
}

export function leakRefusal(hintsViewed: number): string {
  const viewed = Number.isFinite(hintsViewed) ? Math.max(0, Math.min(3, Math.floor(hintsViewed))) : 0;
  if (viewed < 3) {
    const label = ['a nudge', 'the concept', 'a piece of the code'][viewed];
    return `I can't show that reply, because it gives away the solution. Open hint ${viewed + 1} (${label}) instead.`;
  }
  return 'I can\'t show that reply, because it gives away the solution. Every hint is already open; change one thing and check again.';
}

export function guardReply(input: { reply: string; solution: string; learnerCode: string; hintsViewed: number }): GuardedReply {
  const reply = input.reply.length > MAX_REPLY_CHARS ? input.reply.slice(0, MAX_REPLY_CHARS) : input.reply;
  if (fencedCounts(reply).some(n => n > MAX_CODE_BLOCK_LINES) || hasLongStatementRun(reply)) {
    return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'code-block' };
  }
  const known = new Set(solutionLines(input.learnerCode));
  const secret = solutionLines(input.solution).filter(line => !known.has(line));
  const hays = haystacks(reply);
  const seen = (needle: string) => hays.some(hay => hay.includes(needle));
  for (const line of secret) {
    if (seen(line)) return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-line' };
    for (const window of tokenWindows(line)) {
      if (seen(window)) return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-line' };
    }
  }
  for (const window of multiLineWindows(secret)) {
    if (seen(window)) return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-line' };
  }
  return { show: reply, blocked: false };
}
