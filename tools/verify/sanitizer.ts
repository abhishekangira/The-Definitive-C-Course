// Condenses ASan / UBSan / LSan reports (native gcc/clang, and the browser guardrail runtime,
// whose messages imitate UBSan's) to what verification compares: (file, line, kind). Columns,
// addresses, PIDs and stack frames are ignored (PLAN §3.1 step 6).

export interface SanitizerSummary {
  ok: boolean;
  /** e.g. "heap-buffer-overflow", "signed-integer-overflow", "null-pointer-use", "memory-leak". */
  kind?: string;
  file?: string;
  line?: number;
  /** One-line, path- and address-free description (the SUMMARY or runtime-error line). */
  report?: string;
}

/** UBSan message → check name (the -fsanitize= names where one exists). Order matters. */
const UBSAN_KINDS: Array<[RegExp, string]> = [
  [/^(signed|unsigned) integer overflow|^negation of /, 'signed-integer-overflow'],
  [/^(load of|store to|member access within|member call on|reference binding to|access to) (misaligned address)/, 'alignment'],
  [/^(load of|store to|member access within|member call on|reference binding to|access to) null pointer/, 'null-pointer-use'],
  [/^(load of|store to|member access within) address .* with insufficient space/, 'object-size'],
  [/^index -?\d+ out of bounds/, 'array-bounds'],
  [/^(shift exponent|left shift of)/, 'shift'],
  [/^division by zero|^division of .* cannot be represented/, 'integer-divide-by-zero'],
  [/^applying (non-)?zero offset|^pointer index expression with base/, 'pointer-overflow'],
  [/is outside the range of representable values/, 'float-cast-overflow'],
  [/^load of value .*, which is not a valid value for type '(_Bool|bool)'/, 'bool'],
  [/^load of value .*, which is not a valid value for type/, 'enum'],
  [/^execution reached the end of a value-returning function/, 'return'],
  [/^execution reached an unreachable program point/, 'unreachable'],
  [/^variable length array bound/, 'vla-bound'],
  [/^null pointer passed as argument/, 'nonnull-attribute'],
  [/^null pointer returned from function/, 'returns-nonnull-attribute'],
  [/^call to function .* through pointer to incorrect function type/, 'function'],
  [/^implicit conversion from type/, 'implicit-conversion'],
  [/^passing zero to __builtin_(clz|ctz)/, 'builtin'],
  [/^assumption/, 'alignment-assumption'],
];

export function ubsanKind(message: string): string {
  return UBSAN_KINDS.find(([re]) => re.test(message))?.[1]
    ?? message.replace(/'[^']*'|"[^"]*"|-?\d+(\.\d+)?|0x[0-9a-f]+/gi, '').trim().split(/\s+/).slice(0, 4).join('-').toLowerCase();
}

const UBSAN_RE = /^(?:.*\/)?([^/\s:]+):(\d+):(\d+): runtime error: (.*)$/m;
const ASAN_RE = /ERROR: AddressSanitizer: ([\w-]+)/;
const LSAN_RE = /ERROR: LeakSanitizer: detected memory leaks/;
const FRAME_RE = /^\s*#\d+ 0x[0-9a-f]+ in \S+ (?:.*\/)?([^/\s:]+):(\d+)(?::\d+)?\s*$/gm;

/**
 * Parses a sanitizer report from stderr. `sources` are the sample's own file names: the reported
 * line is the first stack frame in one of them (not in libc or an interceptor).
 */
export function parseSanitizer(stderr: string, sources: string[] = ['main.c']): SanitizerSummary {
  const ub = UBSAN_RE.exec(stderr);
  const asan = ASAN_RE.exec(stderr);
  const lsan = LSAN_RE.test(stderr);
  // UBSan prints first when both fire (halt_on_error stops at the first report).
  if (ub && (!asan || ub.index < asan.index)) {
    const message = ub[4].trim();
    return { ok: false, kind: ubsanKind(message), file: ub[1], line: Number(ub[2]), report: `runtime error: ${message.replace(/0x[0-9a-f]+/gi, '<addr>')}` };
  }
  const firstUserFrame = (from: number) => {
    FRAME_RE.lastIndex = from;
    for (let m; (m = FRAME_RE.exec(stderr)); ) if (sources.includes(m[1])) return { file: m[1], line: Number(m[2]) };
    return undefined;
  };
  if (asan) {
    const kind = asan[1]; // heap-buffer-overflow, stack-buffer-overflow, heap-use-after-free, SEGV, …
    const where = firstUserFrame(asan.index);
    const summary = /^SUMMARY: AddressSanitizer: ([\w-]+)/m.exec(stderr);
    return { ok: false, kind, ...where, report: `AddressSanitizer: ${summary?.[1] ?? kind}${where ? ` ${where.file}:${where.line}` : ''}` };
  }
  if (lsan) {
    const idx = stderr.search(LSAN_RE);
    const where = firstUserFrame(idx);
    const bytes = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked in (\d+) allocation/.exec(stderr);
    return { ok: false, kind: 'memory-leak', ...where, report: `LeakSanitizer: ${bytes ? `${bytes[1]} byte(s) leaked in ${bytes[2]} allocation(s)` : 'memory leak'}${where ? ` ${where.file}:${where.line}` : ''}` };
  }
  return { ok: true };
}

/** Key used to compare reports across compilers and against the browser guardrail. */
export function sanitizerKey(s: SanitizerSummary | undefined): string {
  if (!s || s.ok) return 'clean';
  return `${s.file ?? '?'}:${s.line ?? '?'}:${s.kind ?? '?'}`;
}

/** Kinds UBSan (and so the browser guardrail runtime) can report. */
export function isUbsanKind(kind: string | undefined): boolean {
  return !!kind && UBSAN_KINDS.some(([, k]) => k === kind);
}
