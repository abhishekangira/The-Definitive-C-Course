// Leak guard (PLAN.md §2.6). Runs on the model reply before it is shown.
//
// Both sides are normalised the same way: NFKC, every default-ignorable character removed (zero-width,
// invisible operators, variation selectors, bidi marks), case-folded, markdown emphasis and backticks
// dropped, quotes removed (straight and typographic: models write “this”), whitespace collapsed away.
// Cyrillic and Greek letters that look like Latin ones are folded to Latin (so a lookalike spelling still
// matches, and a benign Δt or πr is left alone). The reply is also compared as MiniMarkdown renders it
// (`[label](url)` shows only the label, `\(` shows `\(`), with comments scanned both string-aware and
// string-blind (an unbalanced quote must not switch comment stripping off). A reply that uses a bidi
// override control, which stores text in one order and shows it in another, is refused outright.
// Comments are handled twice, because stripping them to compare and then showing the original
// reply is how a commented solution line used to get through. One pass keeps comment text (it is
// visible) and one pass drops terminated comment bodies (so a comment inside a line cannot hide
// the code). `://` is not a comment, and an unterminated `/*` does not swallow the rest.
// The reply is refused when a solution line the learner does not already have appears as a whole
// line, as a token window, or as a multi-line window, or when a code block is longer than three
// lines. A miss is a refusal: the original reply is not shown.
// A fragment the learner can already read is not a leak: their own code, the statement, a test's
// expected or actual output, an opened hint, a Parsons bank (`knownText`). Real replies that
// quoted `printf("hello world\n");` back to the learner, or `row <= height`, were refused only
// because those fragments are also pieces of the solution line next to them. The whole-line check
// is not relaxed: a reply that contains a full secret line is refused whatever else is on screen.
// A Parsons bank shows every solution line, so a line alone reveals nothing there; the order is the secret.
// A reply that lists four or more bank lines the learner has not placed yet, in solution order or in
// reverse, is refused (`bankText`).

export const MAX_CODE_BLOCK_LINES = 3;
const MAX_REPLY_CHARS = 8_000;
/** `x;` is worth refusing. Brackets alone are not. */
const MIN_LINE = 2;
/** A partial window shorter than this matches too much ordinary prose. Whole lines can be shorter. */
const MIN_WINDOW = 8;

/** Characters that render as nothing. A reply can use them to cut a solution line into pieces no window matches. */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
/** Bidi override controls reorder characters: text stored in one order and shown in another. Isolates and embeddings
 *  (used around code in right-to-left prose) do not, and are stripped as ignorable. */
const BIDI_OVERRIDE = /[\u202D\u202E]/;

/** Cyrillic and Greek lowercase letters that pass for Latin ones. NFKC does not fold them. */
const CONFUSABLE: Record<string, string> = {
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043A': 'k', '\u043C': 'm', '\u043D': 'h', '\u043E': 'o', '\u0440': 'p',
  '\u0441': 'c', '\u0442': 't', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u0501': 'd',
  '\u051B': 'q', '\u051D': 'w', '\u04BB': 'h', '\u04CF': 'l', '\u03B1': 'a', '\u03B2': 'b', '\u03B3': 'y', '\u03B5': 'e',
  '\u03B9': 'i', '\u03BA': 'k', '\u03BD': 'v', '\u03BF': 'o', '\u03C1': 'p', '\u03C4': 't', '\u03C5': 'u', '\u03C7': 'x',
  '\u03F2': 'c', '\u03F3': 'j', '\u0131': 'i',
};
/** A bank line or more in solution order is the answer to a Parsons exercise. */
const MIN_ORDERED_BANK_LINES = 4;

export type LeakReason = 'solution-line' | 'code-block' | 'solution-order' | 'hidden-text';

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

/** `'a'`, `'\n'`, `'\x41'`. A lone apostrophe in prose ("Here's") is not the start of one. */
const CHAR_LITERAL = /^'(?:[^'\\\n]|\\[^\n][^'\n]{0,5})'/;

function scanComments(src: string, keepBody: boolean, stringAware = true): string {
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
    if (stringAware && (c === '"' || (c === "'" && CHAR_LITERAL.test(src.slice(i, i + 9))))) {
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
  return src.normalize('NFKC').replace(IGNORABLE, '').toLowerCase().replace(/[\u0131\u0391-\u03FF\u0400-\u052F]/g, ch => CONFUSABLE[ch] ?? ch);
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
  return dropMarkdown(src).replace(/["'\u201C\u201D\u201E\u201F\u2018\u2019\u201A\u201B\u2032\u2033]/g, '').replace(/\s+/g, '');
}

/** The reply as the learner reads it: a link shows only its label, and a markdown escape keeps its backslash on screen but not in meaning. */
function renderedText(src: string): string {
  return src.replace(/!?\[([^\][\n]*)\]\([^)\s]*\)/g, '$1').replace(/\\([!-/:-@[-`{-~])/g, '$1');
}



function isSignal(line: string): boolean {
  return line.length >= MIN_LINE && /[a-z0-9]/.test(line) && !/^[{}()[\];,]+$/.test(line);
}

function solutionLines(src: string): string[] {
  return scanComments(prep(src), false).split('\n').map(compact).filter(isSignal);
}

function haystacks(src: string, stringAware = true): string[] {
  const ready = prep(src);
  return [compact(scanComments(ready, true, stringAware)), compact(scanComments(ready, false, stringAware))];
}

/** What the reply says, as many ways as it can be read: as typed and as rendered, with comments scanned string-aware and string-blind. */
function replyHaystacks(reply: string): string[] {
  const rendered = renderedText(reply);
  return [...haystacks(reply), ...haystacks(reply, false), ...haystacks(rendered), ...haystacks(rendered, false)];
}

function orderedBankRun(hay: string, ordered: readonly string[]): number {
  let at = 0;
  let run = 0;
  for (const line of ordered) {
    const found = hay.indexOf(line, at);
    if (found < 0) continue;
    run++;
    at = found + line.length;
  }
  return run;
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

function fenceMarker(line: string): '```' | '~~~' | null {
  const t = line.trimStart();
  return t.startsWith('```') ? '```' : t.startsWith('~~~') ? '~~~' : null;
}

function isFence(line: string): boolean {
  return fenceMarker(line) !== null;
}

/** A block closes only with the marker that opened it, so a `~~~` line inside a backtick fence cannot split the count. */
function fencedCounts(reply: string): number[] {
  const counts: number[] = [];
  let open: '```' | '~~~' | null = null;
  let count = 0;
  for (const line of reply.split('\n')) {
    const marker = fenceMarker(line);
    if (marker && (open === null || marker === open)) {
      if (open) counts.push(count);
      open = open ? null : marker;
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

export function guardReply(input: {
  reply: string; solution: string; learnerCode: string; hintsViewed: number;
  /** Text the learner can already see. Lines and fragments of it are not evidence of a leak. */
  knownText?: string;
  /** Every line of a Parsons bank. The lines are known; their order is not. */
  bankText?: string;
}): GuardedReply {
  const reply = input.reply.length > MAX_REPLY_CHARS ? input.reply.slice(0, MAX_REPLY_CHARS) : input.reply;
  if (BIDI_OVERRIDE.test(reply)) {
    return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'hidden-text' };
  }
  if (fencedCounts(reply).some(n => n > MAX_CODE_BLOCK_LINES) || hasLongStatementRun(reply)) {
    return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'code-block' };
  }
  const knownText = input.knownText ?? '';
  const known = new Set([...solutionLines(input.learnerCode), ...solutionLines(knownText)]);
  const secret = solutionLines(input.solution).filter(line => !known.has(line));
  const hays = replyHaystacks(reply);
  const seen = (needle: string) => hays.some(hay => hay.includes(needle));
  const readable = [...haystacks(input.learnerCode), ...haystacks(knownText)];
  const alreadyReadable = (needle: string) => readable.some(hay => hay.includes(needle));
  // `(hello,world` is a fragment of the solution line and also parenthesised prose. It is not a leak when what is
  // inside the edge parentheses is already on screen. `(guests<1||guests>10)` is: that text is not readable.
  const leaks = (window: string) => seen(window) && !alreadyReadable(window) && !alreadyReadable(window.replace(/^\(/, '').replace(/\)$/, ''));
  for (const line of secret) {
    if (seen(line)) return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-line' };
    for (const window of tokenWindows(line)) {
      if (leaks(window)) return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-line' };
    }
  }
  for (const window of multiLineWindows(secret)) {
    if (leaks(window)) return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-line' };
  }
  const bank = new Set(solutionLines(input.bankText ?? ''));
  if (bank.size > 0) {
    // Lines the learner has already placed are theirs to hear about: a recap of them gives the order of nothing new.
    const placed = new Set(solutionLines(input.learnerCode));
    const ordered = solutionLines(input.solution).filter(line => bank.has(line) && !placed.has(line));
    const reversed = [...ordered].reverse();
    if (hays.some(hay => orderedBankRun(hay, ordered) >= MIN_ORDERED_BANK_LINES || orderedBankRun(hay, reversed) >= MIN_ORDERED_BANK_LINES)) {
      return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-order' };
    }
  }
  return { show: reply, blocked: false };
}
