// Output comparison and failure explanations shared by the in-browser runner, the exercise
// verifier and check.mjs. Environment-neutral: no DOM and no Node imports.
import type { TextExpect } from '../content-model/types';

// ---------------------------------------------------------------- decoding and display

const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** U+DC80..U+DCFF stand for raw bytes 0x80..0xFF that are not valid UTF-8 (Python's "surrogateescape"). */
const ESCAPED_BYTE_BASE = 0xdc00;

/**
 * Decodes program output without losing bytes. Valid UTF-8 decodes normally; every byte that is not
 * part of a valid sequence becomes a lone surrogate U+DC80+byte, which escapeForDisplay() shows as
 * \xNN. (A plain TextDecoder would turn them into U+FFFD, so a char pushed past 'z' would be invisible.)
 * Expected strings never contain lone surrogates, so such output can never compare equal by accident.
 */
export function decodeBytes(bytes: Uint8Array): string {
  try {
    return FATAL_UTF8.decode(bytes);
  } catch {
    // fall through to the byte-preserving decoder
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let min = 0;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; min = 0x10000; }
    let ok = need > 0 && i + need < bytes.length;
    for (let k = 1; ok && k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) ok = false;
      else cp = (cp << 6) | (c & 0x3f);
    }
    if (ok && cp >= min && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
      out += String.fromCodePoint(cp);
      i += need + 1;
    } else {
      out += String.fromCharCode(ESCAPED_BYTE_BASE + b);
      i++;
    }
  }
  return out;
}

/** Escapes one character the way C would write it inside a string literal. */
function escapeChar(ch: string, quote: '"' | "'"): string {
  const c = ch.codePointAt(0)!;
  if (ch === '\\') return '\\\\';
  if (ch === quote) return '\\' + quote;
  if (ch === '\n') return '\\n';
  if (ch === '\t') return '\\t';
  if (ch === '\r') return '\\r';
  if (c === 0) return '\\0';
  if (c >= 0xdc80 && c <= 0xdcff) return '\\x' + (c - ESCAPED_BYTE_BASE).toString(16).padStart(2, '0');
  if (c < 0x20 || c === 0x7f) return '\\x' + c.toString(16).padStart(2, '0');
  return ch;
}

/**
 * Quotes text for display: "a\tb\n" with \n, \t, \r, \0, control characters and invalid bytes
 * (\xNN) escaped. Long text is cut after `max` characters with an ellipsis.
 */
export function escapeForDisplay(s: string, max = 400): string {
  const chars = Array.from(s);
  const cut = chars.length > max;
  const body = (cut ? chars.slice(0, max) : chars).map(ch => escapeChar(ch, '"')).join('');
  return `"${body}"${cut ? '…' : ''}`;
}

/** One character for a message such as "expected 'o', got '\x89'"; undefined means end of text. */
export function describeChar(ch: string | undefined): string {
  if (ch === undefined) return 'the end of the output';
  return `'${escapeChar(ch, "'")}'`;
}

// ---------------------------------------------------------------- first difference

export interface FirstDiff {
  /** Index into the expected/actual strings (UTF-16 code units, which equal characters for ASCII). */
  index: number;
  /** 1-based line and column of the difference. */
  line: number;
  column: number;
  /** The differing line in each string (raw, not escaped), and the differing character (undefined = end). */
  expectedLine: string;
  actualLine: string;
  expectedChar?: string;
  actualChar?: string;
  /** Plain-English summary, e.g. "first difference on line 1, character 15: expected 'o', got '\x89'". */
  summary: string;
}

function lineAt(s: string, index: number): string {
  const start = s.lastIndexOf('\n', index - 1) + 1;
  const end = s.indexOf('\n', index);
  return s.slice(start, end < 0 ? s.length : end);
}

/** Locates the first difference between expected and actual text. Returns undefined when equal. */
export function firstDifference(expected: string, actual: string): FirstDiff | undefined {
  if (expected === actual) return undefined;
  let i = 0;
  const n = Math.min(expected.length, actual.length);
  while (i < n && expected[i] === actual[i]) i++;
  const line = expected.slice(0, i).split('\n').length;
  const column = i - (expected.lastIndexOf('\n', i - 1) + 1) + 1;
  const expectedChar = i < expected.length ? Array.from(expected.slice(i))[0] : undefined;
  const actualChar = i < actual.length ? Array.from(actual.slice(i))[0] : undefined;
  let summary: string;
  if (i === actual.length) {
    const rest = expected.slice(i);
    summary = rest === '\n'
      ? 'your output is missing the final newline (\\n)'
      : `your output stops early: it is missing ${escapeForDisplay(rest, 60)}`;
  } else if (expected === '') {
    summary = `expected no output at all, but got ${escapeForDisplay(actual, 60)}`;
  } else if (i === expected.length) {
    const extra = actual.slice(i);
    summary = extra === '\n'
      ? 'your output has an extra newline (\\n) at the end'
      : `your output has extra text at the end: ${escapeForDisplay(extra, 60)}`;
  } else {
    summary = `first difference on line ${line}, character ${column}: expected ${describeChar(expectedChar)}, got ${describeChar(actualChar)}`;
  }
  return { index: i, line, column, expectedLine: lineAt(expected, i), actualLine: lineAt(actual, i), expectedChar, actualChar, summary };
}

// ---------------------------------------------------------------- text expectations

export type MatchHow = 'exactly' | 'containing' | 'not containing' | 'matching';

export type TextCheck =
  | { ok: true }
  | {
      ok: false;
      how: MatchHow;
      /** What was wanted: the exact text, the missing/forbidden substring, or "/pattern/". */
      expected: string;
      /** The text that was compared (after trimming when `trim` is set). */
      actual: string;
      firstDiff?: FirstDiff;
    };

interface NormalisedExpect {
  equals?: string;
  contains: string[];
  notContains: string[];
  matches?: string;
  trim: boolean;
}

function normalise(e: TextExpect): NormalisedExpect {
  if (typeof e === 'string') return { equals: e, contains: [], notContains: [], trim: false };
  // Tolerate a single string where a list is expected (the research prototype used one).
  const list = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [String(v)]);
  return { equals: e.equals, contains: list(e.contains), notContains: list(e.notContains), matches: e.matches, trim: !!e.trim };
}

/** Compiles a `matches` pattern. Plain JavaScript syntax, no flags: ^ and $ anchor the whole text. */
export function compilePattern(pattern: string): RegExp {
  return new RegExp(pattern);
}

/**
 * Evaluates one TextExpect against actual output. A string is shorthand for { equals }.
 * Checks run in a fixed order (equals, contains, notContains, matches) and the first failure is reported.
 * With `trim`, leading/trailing whitespace is removed from the actual text and from `equals`.
 */
export function checkText(expect: TextExpect | undefined, actual: string): TextCheck {
  if (expect === undefined) return { ok: true };
  const e = normalise(expect);
  const a = e.trim ? actual.trim() : actual;
  if (e.equals !== undefined) {
    const want = e.trim ? e.equals.trim() : e.equals;
    if (a !== want) return { ok: false, how: 'exactly', expected: want, actual: a, firstDiff: firstDifference(want, a) };
  }
  for (const s of e.contains) if (!a.includes(s)) return { ok: false, how: 'containing', expected: s, actual: a };
  for (const s of e.notContains) if (a.includes(s)) return { ok: false, how: 'not containing', expected: s, actual: a };
  if (e.matches !== undefined && !compilePattern(e.matches).test(a)) {
    return { ok: false, how: 'matching', expected: `/${e.matches}/`, actual: a };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- exit codes

export type ExitExpect = number | 'nonzero' | undefined;

/** An omitted exit expectation means "exits with 0". */
export function checkExit(expect: ExitExpect, exit: number | null): { ok: boolean; expected: string } {
  const want = expect ?? 0;
  if (want === 'nonzero') return { ok: exit !== null && exit !== 0, expected: 'a non-zero exit code' };
  return { ok: exit === want, expected: `exit code ${want}` };
}

// ---------------------------------------------------------------- crashes

/** Plain-English explanations of the signals a learner's program is likely to die from. */
export const SIGNAL_EXPLANATIONS: Readonly<Record<string, string>> = {
  SIGSEGV: 'a segmentation fault: it touched memory it does not own (often a NULL, uninitialised or out-of-bounds pointer, or very deep recursion)',
  SIGBUS: 'a bus error: an invalid or misaligned memory access (on macOS, often writing to a string literal)',
  SIGFPE: 'an arithmetic exception: usually integer division or % by zero, or INT_MIN / -1',
  SIGABRT: 'an abort: a failed assert(), a call to abort(), or the C library detecting heap corruption such as a double free',
  SIGILL: 'an illegal instruction: usually a trap the compiler inserted for undefined behaviour, or a call through a corrupted function pointer',
  SIGTRAP: 'a trap instruction: on Apple Silicon this is how the compiler stops undefined behaviour such as falling off the end of a non-void function',
  SIGKILL: 'it was killed for running too long: an infinite loop, or waiting for input it never gets?',
  SIGPIPE: 'a broken pipe: it wrote to a pipe that nobody was reading',
  SIGTERM: 'it was asked to stop (SIGTERM)',
};

export function explainSignal(signal: string): string {
  return SIGNAL_EXPLANATIONS[signal] ?? `the signal ${signal}`;
}

/**
 * WebAssembly trap messages → explanations with the native equivalent. Keep the wording identical to
 * TRAP_HINTS in src/runtime/wasi-run.ts (compare.test.ts checks that the two agree).
 */
const TRAP_HINTS: Array<[RegExp, string]> = [
  [/unreachable/, 'The program called abort(), an assert() failed, or a check trapped. Natively this is SIGABRT.'],
  [/memory access out of bounds/, 'The program touched memory outside its address space (often a stack overflow or a wild pointer). Natively this is SIGSEGV.'],
  [/divide by zero/, 'Integer division by zero. Natively this is SIGFPE.'],
  [/divide result unrepresentable|integer overflow/, 'INT_MIN / -1 does not fit in an int. Natively this is SIGFPE.'],
  [/call stack|too much recursion/i, 'The call stack ran out (infinite or very deep recursion). Natively this is SIGSEGV.'],
  [/null function|signature mismatch/, 'A call through a NULL or wrongly typed function pointer. Natively this is usually SIGSEGV.'],
];

export function explainTrap(message: string): string {
  return TRAP_HINTS.find(([re]) => re.test(message))?.[1] ?? 'The program stopped with a runtime trap.';
}

/** The parts of a run that decide whether it crashed. */
export interface CrashInfo {
  signal?: string | null;
  trap?: string | null;
  timedOut?: boolean;
  outputLimit?: boolean;
}

/**
 * One sentence describing why a run did not finish normally, or undefined when it exited by itself.
 * `timeoutMs` is only used for the wording of timeouts.
 */
export function describeCrash(r: CrashInfo, timeoutMs?: number): string | undefined {
  if (r.timedOut) {
    const secs = timeoutMs ? `${+(timeoutMs / 1000).toFixed(2)} s` : 'the time limit';
    return `it was still running after ${secs}: an infinite loop, or is it waiting for input it never gets?`;
  }
  if (r.outputLimit) return 'it printed far too much output and was stopped (an infinite loop that prints?)';
  if (r.trap) return `it crashed: ${explainTrap(r.trap)} (WebAssembly trap: ${r.trap})`;
  if (r.signal) return `it crashed with ${explainSignal(r.signal)}`;
  return undefined;
}

/** First UBSan-style "file:line:col: runtime error: …" line in stderr (browser guardrail or native UBSan). */
export function findRuntimeError(stderr: string): { file: string; line: number; message: string } | undefined {
  const m = /^(?:.*[\\/])?([^\\/\n:]+):(\d+):\d+: runtime error: (.*)$/m.exec(stderr);
  return m ? { file: m[1], line: Number(m[2]), message: m[3] } : undefined;
}

/** "./caesar 23 hello" with arguments quoted like a shell would need them. */
export function commandLine(binary: string, args: string[] = []): string {
  const q = (a: string) => (a === '' || /[\s"'$`\\|&;<>()*?!#~]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a);
  return [`./${binary}`, ...args.map(q)].join(' ');
}
