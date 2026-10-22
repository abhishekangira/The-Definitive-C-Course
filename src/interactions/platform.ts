import type { SampleResult, TargetId, RunOutcome } from '../content-model/types';
import type { Platform } from '../progress/store';

export const PLATFORM_LABEL: Record<Platform, string> = {
  'mac-arm': 'Mac with Apple Silicon (arm64)',
  'mac-intel': 'Intel Mac (x86-64)',
  wsl: 'Windows with WSL (x86-64 Linux)',
  'linux-x86': 'Linux on x86-64',
  'linux-arm': 'Linux on arm64 (or WSL on an ARM laptop)',
};

const TARGET_FOR: Record<Platform, TargetId[]> = {
  'mac-arm': ['macos-arm64-appleclang'],
  'mac-intel': ['linux-x86_64-clang22'],
  wsl: ['linux-x86_64-gcc13'],
  'linux-x86': ['linux-x86_64-gcc13'],
  'linux-arm': ['linux-aarch64-gcc'],
};

export const TARGET_LABEL: Record<TargetId, string> = {
  'wasm32-clang22': 'Your browser (wasm32, clang 22)',
  'linux-x86_64-gcc13': '64-bit Linux / WSL (x86-64, gcc 13)',
  'linux-x86_64-clang22': '64-bit Linux (x86-64, clang 22)',
  'macos-arm64-appleclang': 'macOS on Apple Silicon (arm64, Apple clang)',
  'linux-aarch64-gcc': '64-bit Linux on arm64 (gcc)',
  'windows-x64-msvc': 'Windows, native MSVC (x64)',
};

/** The stored native result to show for this learner, falling back to x86-64 Linux gcc. */
export function nativeFor(sample: SampleResult, platform: Platform | undefined): { target: TargetId; run?: RunOutcome; fallback: boolean } {
  const wanted = platform ? TARGET_FOR[platform] : [];
  for (const t of wanted) if (sample.results[t]) return { target: t, run: sample.results[t]!.run, fallback: false };
  return { target: 'linux-x86_64-gcc13', run: sample.results['linux-x86_64-gcc13']?.run, fallback: Boolean(platform) };
}

/** What to show where a stored run's output would go. Undefined-behaviour output is never stored, and never shown. */
export const UB_OUTPUT_NOTE = 'Undefined behaviour: the program has no defined output, and it can differ from run to run, so none is shown.';

/** The stored stdout of a sample's run, or a note for expect=ub samples (their output is garbage by definition). */
export function storedOutputText(sample: SampleResult, run: RunOutcome | undefined): string {
  if (!run) return '—';
  if (sample.meta.expect === 'ub') return UB_OUTPUT_NOTE;
  return (run.stdoutDisplay ?? run.stdout) || '(no output)';
}

export function describeOutcome(run: RunOutcome | undefined, compiled = true): string {
  if (!compiled) return 'Does not compile.';
  if (!run) return '—';
  if (run.signal) return `Crashes with ${run.signal}.`;
  if (run.trap) return `Stops with a runtime trap (${run.trap}).`;
  if (run.timedOut) return 'Runs forever (stopped by the time limit).';
  return `Exits with status ${run.exit}.`;
}

/** Normalises output for comparing a prediction: trailing spaces per line and at the end don't matter. */
export function normOutput(s: string): string {
  return s.replace(/\r/g, '').split('\n').map(l => l.trimEnd()).join('\n').trimEnd();
}

export type PredictionVerdict = 'exact' | 'close' | 'wrong';

/**
 * A token is a run of letters, digits, `_` and `.`, or any other single visible character.
 * Whitespace and these separators are dropped and only end a token: `,` `;` `:` `(` `)` `[` `]` `{` `}` `"` `'` and the backtick.
 * Keeping separators out of the tokens (instead of deleting them and joining what is left) is what makes `31` differ from `3 1`.
 */
const TOKEN_RE = /[A-Za-z0-9_.]+|[^\s,;:()[\]{}"'`]/g;

export function outputTokens(s: string): string[] {
  return normOutput(s).match(TOKEN_RE) ?? [];
}

/** exact when the normalised texts match; close when the token lists match; wrong otherwise. A prediction with no tokens is never close. Case matters. */
export function predictionVerdict(pred: string, actual: string): PredictionVerdict {
  const a = normOutput(pred);
  const b = normOutput(actual);
  if (a === b) return 'exact';
  const ta = a.match(TOKEN_RE) ?? [];
  const tb = b.match(TOKEN_RE) ?? [];
  if (ta.length === 0) return 'wrong';
  if (ta.length === tb.length && ta.every((t, i) => t === tb[i])) return 'close';
  return 'wrong';
}

/** `match=exact` turns a close result into wrong. Anything else leaves the verdict alone. */
export function applyMatch(verdict: PredictionVerdict, match: 'exact' | 'close' | undefined): PredictionVerdict {
  return verdict === 'close' && match === 'exact' ? 'wrong' : verdict;
}

export interface DiffChunk { text: string; mark: boolean }

/** One aligned row. `gap` is a side that has no line here. `blank` marks a missing or extra blank line. */
export interface DiffRow { gap: boolean; blank: boolean; chunks: DiffChunk[] }

export interface OutputDiff {
  /** normOutput of the prediction is empty, so the box shows "(nothing)". */
  predictedEmpty: boolean;
  actualEmpty: boolean;
  predicted: DiffRow[];
  actual: DiffRow[];
}

/** Above this, a line pair is marked whole. A character LCS is quadratic and a prediction has no length limit. */
const DIFF_CAP = 2000;

function chunksOf(text: string, marks: Uint8Array | null, markWhole: boolean): DiffChunk[] {
  if (markWhole) return [{ text, mark: true }];
  if (!marks || text.length === 0) return [{ text, mark: false }];
  const out: DiffChunk[] = [];
  let i = 0;
  while (i < text.length) {
    const mark = marks[i] === 1;
    let j = i + 1;
    while (j < text.length && (marks[j] === 1) === mark) j++;
    out.push({ text: text.slice(i, j), mark });
    i = j;
  }
  return out;
}

/** Character LCS. The whole line is marked when either side is over {@link DIFF_CAP}. */
function charMarks(a: string, b: string): { a: DiffChunk[]; b: DiffChunk[] } {
  if (a.length > DIFF_CAP || b.length > DIFF_CAP) {
    const changed = a !== b;
    return { a: [{ text: a, mark: changed }], b: [{ text: b, mark: changed }] };
  }
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * w + j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1)
        ? dp[(i - 1) * w + (j - 1)] + 1
        : Math.max(dp[(i - 1) * w + j], dp[i * w + (j - 1)]);
    }
  }
  const am = new Uint8Array(n);
  const bm = new Uint8Array(m);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) && dp[i * w + j] === dp[(i - 1) * w + (j - 1)] + 1) {
      i--; j--;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
      am[i - 1] = 1; i--;
    } else {
      bm[j - 1] = 1; j--;
    }
  }
  while (i > 0) { am[i - 1] = 1; i--; }
  while (j > 0) { bm[j - 1] = 1; j--; }
  return { a: chunksOf(a, am, false), b: chunksOf(b, bm, false) };
}

type LineOp = { kind: 'eq' | 'del' | 'ins'; line: string };

/** Line LCS, then a delete run paired with the insert run beside it so differing lines can be compared character by character. */
function alignLines(a: string[], b: string[]): Array<{ p?: string; a?: string; equal: boolean }> {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * w + j] = a[i - 1] === b[j - 1]
        ? dp[(i - 1) * w + (j - 1)] + 1
        : Math.max(dp[(i - 1) * w + j], dp[i * w + (j - 1)]);
    }
  }
  const ops: LineOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1] && dp[i * w + j] === dp[(i - 1) * w + (j - 1)] + 1) {
      ops.push({ kind: 'eq', line: a[i - 1] }); i--; j--;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
      ops.push({ kind: 'del', line: a[i - 1] }); i--;
    } else {
      ops.push({ kind: 'ins', line: b[j - 1] }); j--;
    }
  }
  while (i > 0) { ops.push({ kind: 'del', line: a[i - 1] }); i--; }
  while (j > 0) { ops.push({ kind: 'ins', line: b[j - 1] }); j--; }
  ops.reverse();
  const out: Array<{ p?: string; a?: string; equal: boolean }> = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].kind === 'eq') { out.push({ p: ops[k].line, a: ops[k].line, equal: true }); k++; continue; }
    const dels: string[] = [];
    const ins: string[] = [];
    while (k < ops.length && ops[k].kind !== 'eq') {
      if (ops[k].kind === 'del') dels.push(ops[k].line);
      else ins.push(ops[k].line);
      k++;
    }
    const pairs = Math.max(dels.length, ins.length);
    for (let t = 0; t < pairs; t++) out.push({ p: dels[t], a: ins[t], equal: false });
  }
  return out;
}

function side(line: string | undefined, otherBlank: boolean, chunks?: DiffChunk[]): DiffRow {
  if (line === undefined) return { gap: true, blank: otherBlank, chunks: [] };
  return { gap: false, blank: line === '' && otherBlank, chunks: chunks ?? [{ text: line, mark: line !== '' }] };
}

/**
 * Line-level diff of the two normOutput texts, then a character diff inside lines that both exist and differ.
 * A line pair over 2,000 characters is marked whole. An empty side is `predictedEmpty` / `actualEmpty` (the box shows "(nothing)").
 */
export function outputDiff(pred: string, actual: string): OutputDiff {
  const p = normOutput(pred);
  const a = normOutput(actual);
  if (p === '' && a === '') return { predictedEmpty: true, actualEmpty: true, predicted: [], actual: [] };
  if (p === '') {
    return {
      predictedEmpty: true,
      actualEmpty: false,
      predicted: [],
      actual: a.split('\n').map(line => ({ gap: false, blank: false, chunks: [{ text: line, mark: true }] })),
    };
  }
  if (a === '') {
    return {
      predictedEmpty: false,
      actualEmpty: true,
      predicted: p.split('\n').map(line => ({ gap: false, blank: false, chunks: [{ text: line, mark: true }] })),
      actual: [],
    };
  }
  const predicted: DiffRow[] = [];
  const actualRows: DiffRow[] = [];
  for (const pair of alignLines(p.split('\n'), a.split('\n'))) {
    if (pair.p !== undefined && pair.a !== undefined && pair.equal) {
      predicted.push({ gap: false, blank: false, chunks: [{ text: pair.p, mark: false }] });
      actualRows.push({ gap: false, blank: false, chunks: [{ text: pair.a, mark: false }] });
    } else if (pair.p !== undefined && pair.a !== undefined) {
      const c = charMarks(pair.p, pair.a);
      predicted.push({ gap: false, blank: false, chunks: c.a });
      actualRows.push({ gap: false, blank: false, chunks: c.b });
    } else if (pair.p !== undefined) {
      const blank = pair.p === '';
      predicted.push(side(pair.p, blank, blank ? [{ text: '', mark: true }] : undefined));
      actualRows.push(side(undefined, blank));
    } else {
      const blank = pair.a === '';
      predicted.push(side(undefined, blank));
      actualRows.push(side(pair.a, blank, blank ? [{ text: '', mark: true }] : undefined));
    }
  }
  return { predictedEmpty: false, actualEmpty: false, predicted, actual: actualRows };
}
