// Operator-restricted exercises: a token scan of ONE function in the learner's file.
// Pure TypeScript (no DOM, no Node), so the browser runner, tools/exercises and check.mjs share it.
//
// Why not a regex: comments, strings and `#define` aliases defeat one. The scan first blanks comments
// (newlines kept, so line numbers stay right), then tokenises, then walks the body of the named function.
//
// Rules for the body: only the function's parameters, the locals it declares, type names and `return`;
// integer literals up to `maxLiteral`; only the operators in `allow`; at most `maxOps` operator tokens
// (assignment `=`, parentheses, braces, commas and semicolons are free). No calls, no control flow,
// no `?:`, no `#`. Anywhere in the file, only `#include` lines are accepted (an alias such as
// `#define AND &` would let a forbidden operator hide behind a name).
//
// Ways to hide code from this scan are rejected, wherever they appear in the file: the digraph `%:` (a `#`),
// the other digraphs and trigraphs, a backslash-newline (line splicing can end a comment the scan did not see
// end), a second definition of the scanned function (the compiler may build another one than the one scanned),
// and casts inside the body (a narrowing cast is an AND in disguise). The unit tests of such an exercise print
// their results to stdout, so the file may not contain `@`, `__attribute__`, inline assembly, `_Pragma`, or a
// call to exit/_exit/abort: that blocks a constructor that prints a forged "all passed" report. This is a
// mitigation inside the exercise (src/testing/harness.ts trusts stdout lines), not a proof.

export interface ScanRules {
  /** Name of the function to scan. */
  function: string;
  /** Operator tokens that may appear (for example ["~", "|"]). */
  allow: string[];
  /** Largest number of operator tokens in the body. */
  maxOps: number;
  /** Largest integer literal allowed (default 255). */
  maxLiteral?: number;
  /**
   * Names of the only functions the file may define (the puzzle functions); `main` is allowed too. When set, the whole file is
   * restricted: the only directive is `#include <stdint.h>`, every top-level item is a definition of one of these functions (or
   * `main`) with plain integer types, and there are no strings or character literals anywhere. Nothing at file scope is left
   * for the learner to redefine a library function or run code before `main`.
   */
  exclusive?: string[];
}

export interface ScanResult {
  ok: boolean;
  /** One plain sentence when not ok. */
  message?: string;
  /** Line (1-based) of the offending token, when there is one. */
  line?: number;
  /** Operator tokens counted in the body (set when the function was found). */
  ops?: number;
}

export const DEFAULT_MAX_LITERAL = 255;

type Tok = { t: 'id' | 'num' | 'op' | 'str' | 'hash'; s: string; line: number };

const TYPE_WORDS = new Set([
  'void', 'char', 'short', 'int', 'long', 'signed', 'unsigned', 'const', '_Bool',
  'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'size_t', 'intmax_t', 'uintmax_t',
]);
const CONTROL_WORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'goto', 'break', 'continue', 'sizeof', '_Generic', 'asm']);
/** Free tokens: they never count and never need to be in `allow`. */
const FREE_OPS = new Set(['=', '(', ')', '{', '}', ',', ';']);
const OPERATORS = [
  '<<=', '>>=', '...', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '->',
  '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':', '.', '[', ']', '(', ')', '{', '}', ',', ';',
];

/** Replaces comments with spaces (newlines kept). String and character literals are kept as they are. */
function blankComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < src.length) { out += '  '; i += 2; }
    } else if (c === '"' || c === "'") {
      const q = c;
      out += c; i++;
      while (i < src.length && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < src.length) { out += src[i]; i++; }
        out += src[i]; i++;
      }
      if (i < src.length && src[i] === q) { out += q; i++; }
    } else { out += c; i++; }
  }
  return out;
}

function tokenize(clean: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let i = 0;
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  while (i < clean.length) {
    const c = clean[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { toks.push({ t: 'hash', s: '#', line }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < clean.length && clean[j] !== c && clean[j] !== '\n') { if (clean[j] === '\\') j++; j++; }
      toks.push({ t: 'str', s: clean.slice(i, j + 1), line });
      i = j + 1;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < clean.length && /[A-Za-z0-9_]/.test(clean[j])) j++;
      toks.push({ t: 'id', s: clean.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(clean[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < clean.length && /[A-Za-z0-9_.]/.test(clean[j])) j++;
      toks.push({ t: 'num', s: clean.slice(i, j), line });
      i = j;
      continue;
    }
    const op = OPERATORS.find(o => clean.startsWith(o, i));
    if (op) { toks.push({ t: 'op', s: op, line }); i += op.length; continue; }
    toks.push({ t: 'op', s: c, line });
    i++;
  }
  return toks;
}

/** Value of a plain integer literal (decimal, hex, octal, binary, optional u/l suffixes), or undefined. */
function integerValue(s: string): bigint | undefined {
  const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uUlL]*)$/.exec(s);
  if (!m) return undefined;
  const d = m[1];
  if (/^0[0-7]+$/.test(d)) return BigInt('0o' + d.slice(1));
  if (/^0[0-9]+$/.test(d)) return undefined;
  return BigInt(d);
}

/** Identifiers that no scanned exercise file may contain (see the header). */
const BANNED_WORDS = new Set([
  '__attribute__', '__attribute', 'asm', '__asm', '__asm__', '_Pragma', '__builtin_trap', 'exit', '_exit', '_Exit', 'quick_exit', 'abort', 'raise', 'kill', 'fork', 'execve', 'syscall',
]);

/** `src` with every string and character literal reduced to nothing, so a digraph inside one is not mistaken for code. */
function withoutLiterals(clean: string): string {
  let out = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < clean.length && clean[j] !== c && clean[j] !== '\n') { if (clean[j] === '\\') j++; j++; }
      out += c + c;
      i = j;
    } else out += c;
  }
  return out;
}

/** The whole-file rule behind `exclusive` (see ScanRules). Returns a failure, or undefined when the file only holds what it may. */
function checkExclusive(toks: Tok[], names: string[]): ScanResult | undefined {
  const allowed = new Set([...names, 'main']);
  const bad = (line: number, message: string): ScanResult => ({ ok: false, message: `line ${line}: ${message}`, line });
  for (const tk of toks) {
    if (tk.t === 'str') return bad(tk.line, `a string or character literal (${tk.s}) is not allowed anywhere in this file`);
  }
  let k = 0;
  while (k < toks.length) {
    const tk = toks[k];
    if (tk.t === 'hash') {
      const rest = toks.slice(k, k + 7);
      const ok = rest.length === 7 && rest.every(t => t.line === tk.line) && rest.map(t => t.s).join('') === '#include<stdint.h>';
      if (!ok) return bad(tk.line, 'only the line #include <stdint.h> is allowed at the top of this file');
      k += 7;
      continue;
    }
    // type words, then the function name and its parameter list
    const start = k;
    while (k < toks.length && toks[k].t === 'id' && TYPE_WORDS.has(toks[k].s)) k++;
    const name = toks[k];
    if (k === start || name?.t !== 'id' || toks[k + 1]?.s !== '(') {
      return bad(tk.line, `only the puzzle functions (${names.join(', ')}) and main may be defined in this file; "${tk.s}" starts something else`);
    }
    if (!allowed.has(name.s)) return bad(name.line, `${name.s}() is not one of the puzzle functions (${names.join(', ')}); this file may not define anything else`);
    k += 2;
    const params: Tok[] = [];
    while (k < toks.length && toks[k].s !== ')') params.push(toks[k++]);
    if (k >= toks.length) return bad(name.line, `the parameter list of ${name.s}() is not closed`);
    k++;
    const text = params.map(t => (t.t === 'id' && TYPE_WORDS.has(t.s) ? 'T' : t.t === 'id' ? 'N' : t.s)).join(' ');
    const shape = /^(T )*T N( , (T )*T N)*$/.test(text) || text === 'T' && params[0].s === 'void' || text === '';
    if (!shape) return bad(name.line, `the parameters of ${name.s}() must be plain integer types and names`);
    if (toks[k]?.s !== '{') return bad(name.line, `${name.s}() must be defined here, with its body`);
    let d = 0;
    for (; k < toks.length; k++) {
      if (toks[k].t !== 'op') continue;
      if (toks[k].s === '{') d++;
      else if (toks[k].s === '}' && --d === 0) { k++; break; }
    }
    if (d !== 0) return bad(name.line, `${name.s}() has no closing brace`);
  }
  return undefined;
}

const list = (ops: string[]) => (ops.length ? ops.join(' ') : 'none');

/** Scans one function of `source` against `rules`. */
export function scanFunction(source: string, rules: ScanRules): ScanResult {
  const fn = rules.function;
  const maxLiteral = BigInt(rules.maxLiteral ?? DEFAULT_MAX_LITERAL);
  const toks = tokenize(blankComments(source));
  const fail = (message: string, line?: number, ops?: number): ScanResult => ({ ok: false, message, line, ops });

  // Spellings that hide a directive or an operator from a token scan.
  if (/\\\r?\n/.test(source)) return fail('a backslash at the end of a line (a line continuation) is not allowed in this exercise');
  const bare = withoutLiterals(blankComments(source));
  const alt = /\?\?|%:|<:|:>|<%|%>/.exec(bare);
  if (alt) {
    const line = bare.slice(0, alt.index).split('\n').length;
    return fail(`line ${line}: the digraph or trigraph "${alt[0]}" is not allowed in this exercise (it could hide a "#" or an operator)`, line);
  }
  for (const tk of toks) {
    if (tk.t === 'id' && BANNED_WORDS.has(tk.s)) return fail(`line ${tk.line}: "${tk.s}" is not allowed in this exercise`, tk.line);
    if (tk.t === 'str' && tk.s.includes('@')) return fail(`line ${tk.line}: the character @ is not allowed in a string in this exercise (it is reserved for the test report)`, tk.line);
  }

  if (rules.exclusive) {
    const r = checkExclusive(toks, rules.exclusive);
    if (r) return r;
  }

  // Only #include lines may exist anywhere in the file.
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].t !== 'hash') continue;
    const word = toks[k + 1]?.line === toks[k].line ? toks[k + 1].s : '';
    if (word !== 'include') return fail(`line ${toks[k].line}: "#${word}" is not allowed in this exercise (only #include lines; a macro could hide an operator)`, toks[k].line);
  }

  // Find the definition `fn ( ... ) {` at brace depth 0.
  let depth = 0;
  let open = -1;
  let paramEnd = -1;
  let paramStart = -1;
  let defs = 0;
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === 'op' && tk.s === '{') depth++;
    else if (tk.t === 'op' && tk.s === '}') depth--;
    else if (depth === 0 && tk.t === 'id' && tk.s === fn && toks[k + 1]?.s === '(') {
      let d = 0;
      let j = k + 1;
      for (; j < toks.length; j++) {
        if (toks[j].s === '(' && toks[j].t === 'op') d++;
        else if (toks[j].s === ')' && toks[j].t === 'op') { d--; if (d === 0) break; }
      }
      if (j < toks.length && toks[j + 1]?.s === '{') {
        defs++;
        if (open < 0) { paramStart = k + 2; paramEnd = j; open = j + 1; }
      }
    }
  }
  if (open < 0) return fail(`the function ${fn}() was not found: define it with exactly that name`);
  if (defs > 1) return fail(`the function ${fn}() is defined ${defs} times: define it once (the compiler might build a different one than the one checked)`);

  let close = -1;
  for (let k = open, d = 0; k < toks.length; k++) {
    if (toks[k].t !== 'op') continue;
    if (toks[k].s === '{') d++;
    else if (toks[k].s === '}') { d--; if (d === 0) { close = k; break; } }
  }
  if (close < 0) return fail(`the function ${fn}() has no closing brace`);

  const names = new Set<string>();
  for (let k = paramStart; k < paramEnd; k++) if (toks[k].t === 'id' && !TYPE_WORDS.has(toks[k].s)) names.add(toks[k].s);

  const allow = new Set(rules.allow);
  let ops = 0;
  let inDecl = false;
  let prev: Tok | undefined;
  for (let k = open + 1; k < close; k++) {
    const tk = toks[k];
    const next = toks[k + 1];
    const at = `line ${tk.line}`;
    if (tk.t === 'hash') return fail(`${at}: "#" is not allowed inside ${fn}()`, tk.line, ops);
    if (tk.t === 'str') return fail(`${at}: ${fn}() uses the literal ${tk.s}, which is not allowed here`, tk.line, ops);
    if (tk.t === 'num') {
      const v = integerValue(tk.s);
      if (v === undefined) return fail(`${at}: ${fn}() uses the number ${tk.s}, which is not a plain integer`, tk.line, ops);
      if (v > maxLiteral) return fail(`${at}: ${fn}() uses the constant ${tk.s}, but constants may be at most ${maxLiteral}`, tk.line, ops);
    } else if (tk.t === 'id') {
      if (CONTROL_WORDS.has(tk.s)) return fail(`${at}: ${fn}() uses "${tk.s}", which is not allowed here (no loops, branches or sizeof)`, tk.line, ops);
      if (TYPE_WORDS.has(tk.s)) {
        if (prev?.t === 'op' && prev.s === '(' && !(tk.s === 'void' && next?.s === ')')) return fail(`${at}: ${fn}() contains a cast; casts are not allowed here (a cast to a narrow type works like an AND)`, tk.line, ops);
        if (prev === undefined || (prev.t === 'op' && (prev.s === ';' || prev.s === '{' || prev.s === '}' || prev.s === '('))) inDecl = true;
      } else if (tk.s === 'return') {
        inDecl = false;
      } else if (next?.t === 'op' && next.s === '(') {
        return fail(`${at}: ${fn}() calls ${tk.s}(), and function calls are not allowed here`, tk.line, ops);
      } else if (inDecl && prev && ((prev.t === 'id' && TYPE_WORDS.has(prev.s)) || (prev.t === 'op' && prev.s === ',') || (prev.t === 'op' && prev.s === '*'))) {
        names.add(tk.s);
      } else if (!names.has(tk.s)) {
        return fail(`${at}: ${fn}() uses "${tk.s}", which is not one of its parameters or local variables`, tk.line, ops);
      }
    } else if (tk.t === 'op') {
      if (tk.s === ';') inDecl = false;
      if (!FREE_OPS.has(tk.s)) {
        if (tk.s === '?' || tk.s === ':') return fail(`${at}: ${fn}() uses "${tk.s}" (the ?: operator), which is not allowed here`, tk.line, ops);
        if (!allow.has(tk.s)) return fail(`${at}: ${fn}() uses ${tk.s}, which is not allowed here (allowed: ${list(rules.allow)})`, tk.line, ops);
        ops++;
        if (ops > rules.maxOps) return fail(`${at}: ${fn}() uses more than ${rules.maxOps} operators (the limit; = ( ) , ; and braces are free)`, tk.line, ops);
      }
    }
    prev = tk;
  }
  // In an exclusive file `main` is held to the same body rules (no calls, no strings, no operators).
  if (rules.exclusive && fn !== 'main' && toks.some((t, i) => t.t === 'id' && t.s === 'main' && toks[i + 1]?.s === '(')) {
    const m = scanFunction(source, { function: 'main', allow: [], maxOps: 1, maxLiteral: rules.maxLiteral });
    if (!m.ok) return { ...m, ops };
  }
  return { ok: true, ops };
}
