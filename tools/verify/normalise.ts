// Output normalisation (PLAN §3.1 step 5).
//
// Only text produced by a %p conversion is normalised. To know *exactly* which characters a %p
// produced (rather than guessing from "looks like hex"), the verifier runs a marked build of the
// sample: every %p conversion in a string literal is wrapped in two control characters,
//   printf("&x = %p\n", …)   →   printf("&x = \036%p\037\n", …)
// so the output carries "\x1e0x7ffd5e0c1a2c\x1f". Each marked span is then:
//   - a NULL spelling ("(nil)" glibc, "0" musl/wasm, "0x0" macOS, all-zero MSVC) → <NULL>
//   - an address → <addrN>, numbered in order of first appearance per run, shared by stdout and
//     stderr, so pointer equality survives ("p == &x" prints the same token twice)
//   - anything else (e.g. puts("use %p") printing the literal text) → left as written.
// Everything outside the spans is untouched, so printf("%#x", 0xdeadbeef) keeps its hex.
// Octal escapes are used because a hex escape would swallow following hex digits ("\x1fab").
//
// The marked build only adds 8 bytes per marked literal to .rodata; its normalised output equals
// the original program's. Compile diagnostics always come from the unmarked build, and columns in
// runtime reports from the marked build are mapped back (remapColumns).
//
// Without any %p literal but with norm=ptr, a heuristic is used instead: 0x-prefixed hex with ≥ 5
// digits is an address and "(nil)"/"0x0" is NULL (wasm32 addresses are ≥ 5 digits, e.g. 0x110a0).

export const MARK_OPEN = '\x1e';
export const MARK_CLOSE = '\x1f';
const OPEN_ESC = '\\036';
const CLOSE_ESC = '\\037';

/** A %p conversion spec inside a C string literal body (flags, width, precision allowed). */
const CONV_RE = /^%[-+ #0']*(?:\*|\d+)?(?:\.(?:\*|\d+))?(?:hh|h|ll|l|j|z|t|L)?([a-zA-Z])/;

export interface Insertion {
  line: number; // 1-based
  col: number; // 1-based column in the original line before which text was inserted
  len: number;
}

export interface MarkedSource {
  code: string;
  /** Number of %p conversions marked. 0 → the source has no %p in any string literal. */
  count: number;
  insertions: Insertion[];
}

/**
 * Wraps every %p conversion in a string literal with \036 … \037. Comments, character literals
 * and `%%` are skipped. Only plain and u8 string literals are touched.
 */
export function markPointerConversions(code: string): MarkedSource {
  let out = '';
  let count = 0;
  const insertions: Insertion[] = [];
  let line = 1;
  let col = 1;
  let i = 0;
  const n = code.length;
  const advance = (k: number) => {
    for (let j = 0; j < k; j++) {
      const ch = code[i + j];
      out += ch;
      if (ch === '\n') { line++; col = 1; } else col++;
    }
    i += k;
  };
  const insert = (text: string) => { insertions.push({ line, col, len: text.length }); out += text; };

  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') { // line comment (with \-newline continuations)
      while (i < n && code[i] !== '\n') advance(code[i] === '\\' && code[i + 1] === '\n' ? 2 : 1);
      continue;
    }
    if (c === '/' && next === '*') {
      advance(2);
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) advance(1);
      if (i < n) advance(2);
      continue;
    }
    if (c === "'") {
      advance(1);
      while (i < n && code[i] !== "'" && code[i] !== '\n') advance(code[i] === '\\' ? 2 : 1);
      if (i < n && code[i] === "'") advance(1);
      continue;
    }
    if (c === '"') {
      // Skip wide/UTF-16/UTF-32 literals (L"", u"", U""): printf formats are plain char strings.
      const prefix = /(?:^|[^A-Za-z0-9_])(u8|L|u|U)$/.exec(code.slice(Math.max(0, i - 3), i));
      const wide = prefix !== null && prefix[1] !== 'u8';
      advance(1);
      while (i < n && code[i] !== '"' && code[i] !== '\n') {
        if (code[i] === '\\') { advance(2); continue; }
        if (code[i] === '%' && !wide) {
          if (code[i + 1] === '%') { advance(2); continue; }
          const m = CONV_RE.exec(code.slice(i, i + 32));
          if (m && m[1] === 'p') {
            insert(OPEN_ESC);
            advance(m[0].length);
            insert(CLOSE_ESC);
            count++;
            continue;
          }
        }
        advance(1);
      }
      if (i < n && code[i] === '"') advance(1);
      continue;
    }
    advance(1);
  }
  return { code: out, count, insertions };
}

/** True when some string literal in the source contains a %p conversion. */
export function usesPointerFormat(code: string): boolean {
  return markPointerConversions(code).count > 0;
}

/** Maps a column of the marked source back to the original source. */
export function originalColumn(insertions: Insertion[], line: number, markedCol: number): number {
  let offset = 0;
  for (const ins of insertions.filter(x => x.line === line).sort((a, b) => a.col - b.col)) {
    const start = ins.col + offset; // where the inserted text begins in the marked line
    if (markedCol < start) break;
    if (markedCol < start + ins.len) return ins.col;
    offset += ins.len;
  }
  return markedCol - offset;
}

/** Rewrites "file:line:col" references (UBSan/compiler messages) from marked to original columns. */
export function remapColumns(text: string, insertions: Insertion[], file = 'main.c'): string {
  if (!insertions.length) return text;
  const esc = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${esc}):(\\d+):(\\d+)`, 'g'), (_m, f: string, l: string, c: string) =>
    `${f}:${l}:${originalColumn(insertions, Number(l), Number(c))}`);
}

export const stripMarkers = (s: string) => s.replace(/[\x1e\x1f]/g, '');

export type PointerMode = 'markers' | 'heuristic' | 'none';

/** Decides how a sample's output is normalised. */
export function pointerMode(code: string, norm: 'ptr' | 'none' | undefined): PointerMode {
  if (norm === 'none') return 'none';
  if (usesPointerFormat(code)) return 'markers';
  return norm === 'ptr' ? 'heuristic' : 'none';
}

const NULL_SPELLINGS = new Set(['(nil)', '(null)', '0', '0x0', '0X0']);
const ADDR_RE = /^(?:0[xX])?[0-9a-fA-F]+$/;

/** Classifies the text inside one marked span. */
export function classifyPointerText(text: string): { kind: 'null' } | { kind: 'addr'; key: string } | { kind: 'other' } {
  const t = text.trim();
  if (NULL_SPELLINGS.has(t) || /^(?:0[xX])?0+$/.test(t)) return { kind: 'null' };
  if (ADDR_RE.test(t)) return { kind: 'addr', key: BigInt(/^0[xX]/.test(t) ? t : `0x${t}`).toString(16) };
  return { kind: 'other' };
}

export class PointerTokens {
  private map = new Map<string, string>();
  token(key: string): string {
    let t = this.map.get(key);
    if (!t) { t = `<addr${this.map.size + 1}>`; this.map.set(key, t); }
    return t;
  }
}

/** Normalises one stream of a marked run. Pass the same `tokens` for stdout then stderr. */
export function normaliseMarked(text: string, tokens: PointerTokens): string {
  const replaced = text.replace(/\x1e([^\x1e\x1f]*)\x1f/g, (_m, inner: string) => {
    const c = classifyPointerText(inner);
    if (c.kind === 'null') return '<NULL>';
    if (c.kind === 'addr') return tokens.token(c.key);
    return inner;
  });
  return stripMarkers(replaced); // stray markers: truncated output or a program printing them
}

const HEUR_NULL_RE = /\(nil\)|\b0x0+\b/g;
const HEUR_ADDR_RE = /\b0x[0-9a-fA-F]{5,}\b/g;

/** norm=ptr without marked literals: the prototype's "looks like an address" rule. */
export function normaliseHeuristic(text: string, tokens: PointerTokens): string {
  return text.replace(HEUR_NULL_RE, '<NULL>').replace(HEUR_ADDR_RE, h => tokens.token(BigInt(h).toString(16)));
}

export interface NormalisedRun {
  stdout: string;
  stderr: string;
  /** stdout for display: markers removed, %p addresses rebased (native) or as printed (wasm). */
  stdoutDisplay?: string;
}

/**
 * Normalises one run's stdout+stderr. `rebase` selects display rebasing for native 64-bit Linux
 * output (ASLR); wasm output is deterministic, so its display text is the output as printed.
 */
export function normaliseRun(stdout: string, stderr: string, mode: PointerMode, rebase: 'linux-x86_64' | 'none'): NormalisedRun {
  if (mode === 'none') return { stdout, stderr };
  const tokens = new PointerTokens();
  if (mode === 'heuristic') {
    const out = normaliseHeuristic(stdout, tokens);
    return { stdout: out, stderr: normaliseHeuristic(stderr, tokens), stdoutDisplay: rebase === 'none' ? stdout : rebaseHeuristic(stdout) };
  }
  const out = normaliseMarked(stdout, tokens);
  const err = normaliseMarked(stderr, tokens);
  return { stdout: out, stderr: err, stdoutDisplay: rebase === 'none' ? stripMarkers(stdout) : rebaseMarked(stdout) };
}

// ---------- display rebasing ----------

interface Group { min: bigint; max: bigint; base: bigint }

/**
 * Replaces real (ASLR-randomised) addresses with stable fake ones that keep offsets inside a
 * region: addresses within 1 MiB of each other form a group, and each group is moved to a fixed
 * base chosen by magnitude (x86-64 Linux: stack ≥ 0x7f00_0000_0000, else image/heap). Stack groups
 * keep 16-byte alignment (Linux also randomises the stack's page offset); others keep their
 * in-page offset. From research/prototypes/pipeline/verify/lib/normalize.mjs (verified over 5 runs).
 */
export function rebaseGroups(addrs: bigint[]): (a: bigint) => bigint {
  const sorted = [...new Set(addrs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const groups: Group[] = [];
  for (const a of sorted) {
    const g = groups.at(-1);
    if (g && a - g.max < 0x100000n) g.max = a;
    else groups.push({ min: a, max: a, base: 0n });
  }
  let low = 0n;
  let stack = 0n;
  for (const g of groups) {
    if (g.min >= 0x7f0000000000n) g.base = 0x7ffd4a3c1bc0n + stack++ * 0x10000000n + (g.min & 0xfn);
    else g.base = 0x55d0c1400000n + low++ * 0x01000000n + (g.min & 0xfffn);
  }
  return a => {
    const g = groups.find(x => a >= x.min && a <= x.max);
    return g ? g.base + (a - g.min) : a;
  };
}

function rebaseMarked(stdout: string): string {
  const spans = [...stdout.matchAll(/\x1e([^\x1e\x1f]*)\x1f/g)].map(m => classifyPointerText(m[1]));
  const addrs = spans.flatMap(c => (c.kind === 'addr' ? [BigInt(`0x${c.key}`)] : []));
  const map = rebaseGroups(addrs);
  return stripMarkers(stdout.replace(/\x1e([^\x1e\x1f]*)\x1f/g, (_m, inner: string) => {
    const c = classifyPointerText(inner);
    if (c.kind !== 'addr') return inner;
    const lead = /^\s*/.exec(inner)![0];
    const trail = /\s*$/.exec(inner)![0];
    return `${lead}0x${map(BigInt(`0x${c.key}`)).toString(16)}${trail}`;
  }));
}

export function rebaseHeuristic(text: string): string {
  const addrs = (text.match(HEUR_ADDR_RE) ?? []).map(h => BigInt(h));
  const map = rebaseGroups(addrs);
  return text.replace(HEUR_ADDR_RE, h => `0x${map(BigInt(h)).toString(16)}`);
}

// ---------- diffs ----------

/** Line-level LCS diff for reports ("  same", "- left", "+ right"). Samples are short. */
export function lineDiff(a: string, b: string): string {
  const A = a.split('\n');
  const B = b.split('\n');
  const dp = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push(`  ${A[i]}`); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${A[i++]}`);
    else out.push(`+ ${B[j++]}`);
  }
  while (i < A.length) out.push(`- ${A[i++]}`);
  while (j < B.length) out.push(`+ ${B[j++]}`);
  return out.join('\n');
}
