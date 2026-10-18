// Leak guard (PLAN.md §2.6). Runs on the model reply before it is shown.
// Whitespace and comments are ignored. A solution line the learner's code does not already
// contain, or a code block longer than three lines, replaces the reply with a refusal.
// Comparison uses String.includes on normalised text, never a RegExp built from the reply.

export const MAX_CODE_BLOCK_LINES = 3;
const MAX_REPLY_CHARS = 8_000;
/** Short lines (`{`, `i++`) match too much prose. Eight characters is `return 0;`. */
const MIN_FINGERPRINT = 8;

export type LeakReason = 'solution-line' | 'code-block';

export interface GuardedReply {
  show: string;
  blocked: boolean;
  reason?: LeakReason;
}

/** Drop // and block comments. A comment marker inside a string is kept. Linear in the input. */
export function stripCComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      out += ' ';
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

function fingerprint(line: string): string {
  return stripCComments(line).replace(/\s+/g, '');
}

function significantLines(src: string): string[] {
  const seen: string[] = [];
  for (const line of stripCComments(src).split('\n')) {
    const fp = line.replace(/\s+/g, '');
    if (fp.length < MIN_FINGERPRINT) continue;
    if (/^[{}()[\];,]+$/.test(fp)) continue;
    seen.push(fp);
  }
  return seen;
}

function fencedCounts(reply: string): number[] {
  const counts: number[] = [];
  let open = false;
  let count = 0;
  for (const line of reply.split('\n')) {
    if (line.trimStart().startsWith('```')) {
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

/** A run of more than three lines that each end like a C statement, outside a fence. */
function hasLongStatementRun(reply: string): boolean {
  let run = 0;
  let open = false;
  for (const line of reply.split('\n')) {
    if (line.trimStart().startsWith('```')) { open = !open; run = 0; continue; }
    if (open) { run = 0; continue; }
    const t = line.trim();
    if (t !== '' && /[;{}]\s*$/.test(t) && !t.startsWith('//') && !t.startsWith('*')) run++;
    else run = 0;
    if (run > MAX_CODE_BLOCK_LINES) return true;
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
  const known = new Set(significantLines(input.learnerCode));
  const flat = fingerprint(reply);
  for (const line of significantLines(input.solution)) {
    if (known.has(line)) continue;
    if (flat.includes(line)) return { show: leakRefusal(input.hintsViewed), blocked: true, reason: 'solution-line' };
  }
  return { show: reply, blocked: false };
}
