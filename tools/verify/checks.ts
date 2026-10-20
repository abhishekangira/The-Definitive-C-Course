// Pure checks over one sample's results (PLAN §3.1 step 6, §3.2, §3.4). No I/O, so every rule is
// unit-testable: expectations per target, gcc/clang agreement, sanitizer/guardrail agreement,
// the automatic browser-vs-64-bit flag, platform/predict64 rules, and the canonical answer.
import type { Diagnostic, RunOutcome, SampleMeta, SampleResult, TargetId, TargetResult } from '../../src/content-model/types';
import { expectFor, requiredWarnings, warningsAllowed, type ExtMeta } from './meta';
import { lineDiff } from './normalise';
import { isUbsanKind, parseSanitizer, sanitizerKey } from './sanitizer';
import { TARGET_LABEL, WASM_TARGET, type VerifiedTargetResult } from './types';

export type Outcome = SampleResult['answer']['outcome'];

export interface CheckInput {
  id: string;
  code: string;
  meta: SampleMeta;
  ext: ExtMeta;
  results: Partial<Record<TargetId, VerifiedTargetResult>>;
  /** Stored outputs of other targets (only those whose hash matches this sample's code). */
  stored?: Array<{ target: TargetId; result: TargetResult }>;
}

export interface CheckOutput {
  problems: string[];
  notes: string[];
  flagged: boolean;
  diffs: Array<{ target: TargetId; diff: string }>;
  answer: SampleResult['answer'];
}

const GCC: TargetId = 'linux-x86_64-gcc13';
const CLANG: TargetId = 'linux-x86_64-clang22';

/** Outcome of one run (or of the compile when it failed). */
export function runOutcome(r: RunOutcome | undefined): Outcome {
  if (!r) return 'runs';
  if (r.timedOut || r.signal || r.trap) return 'runtime-error';
  if (r.exit === 0) return 'runs';
  return `exit:${r.exit ?? 0}`;
}

export function outcomeOf(t: TargetResult | undefined): Outcome {
  if (!t) return 'runs';
  if (!t.compile.ok) return 'compile-error';
  return runOutcome(t.run);
}

/** Every run of a target (UB samples keep one output-free entry per outcome category, see ub.ts). */
export function allRuns(t: TargetResult): RunOutcome[] {
  return t.observed?.length ? t.observed : t.run ? [t.run] : [];
}

/**
 * The text two targets are compared on. UB samples compare only the set of outcome categories
 * (garbage values are never asked); predict=outcome compares the outcome; everything else compares
 * outcome + normalised stdout.
 */
export function comparable(meta: SampleMeta, t: TargetResult): string {
  if (!t.compile.ok) return 'outcome: compile-error';
  if (meta.expect === 'ub') {
    const set = [...new Set(allRuns(t).map(runOutcome))].sort();
    return `outcomes: ${set.join(', ')}`;
  }
  const head = `outcome: ${outcomeOf(t)}`;
  return meta.predict === 'outcome' ? head : `${head}\n${t.run?.stdout ?? ''}`;
}

const fmtDiag = (d: Diagnostic) => `${d.file}:${d.line}:${d.col}: ${d.severity}: ${d.message}${d.flag ? ` [${d.flag}]` : ''}`;

/**
 * Diagnostics are compared by (line, severity, normalised flag): message text differs between
 * compilers. An error that carries a -W flag is a warning promoted by -Werror (or a warning that
 * is an error by default), so it is compared as a warning.
 */
export function diagnosticKey(d: Diagnostic): string {
  const sev = d.severity === 'fatal error' ? 'error' : d.severity;
  return `${d.line}:${sev === 'error' && d.flag ? 'warning' : sev}:${d.flag ?? ''}`;
}

export function diagnosticDiff(a: Diagnostic[], b: Diagnostic[]): { onlyA: string[]; onlyB: string[] } {
  const keys = (ds: Diagnostic[]) => new Set(ds.filter(d => d.severity !== 'note').map(diagnosticKey));
  const A = keys(a);
  const B = keys(b);
  return { onlyA: [...A].filter(k => !B.has(k)).sort(), onlyB: [...B].filter(k => !A.has(k)).sort() };
}

const indent = (s: string) => s.replace(/\n$/, '').replace(/^/gm, '  ');

function checkTarget(i: CheckInput, target: TargetId, t: VerifiedTargetResult, problems: string[]): void {
  const label = TARGET_LABEL[target];
  const e = expectFor(i.meta, i.ext, target);
  const warnings = t.compile.diagnostics.filter(d => d.severity === 'warning');
  const errors = t.compile.diagnostics.filter(d => d.severity === 'error' || d.severity === 'fatal error');
  if (e === 'compile-error') {
    if (t.compile.ok) problems.push(`${label}: expected a compile error, but it compiled`);
    return;
  }
  if (!t.compile.ok) {
    const why = errors.length && /-Werror|warnings being treated as errors/.test(t.compile.raw) ? ' (warnings are errors unless expect=warning|ub)' : '';
    problems.push(`${label}: compile failed${why}\n${indent(t.compile.raw)}`);
    return;
  }
  if (e === 'warning' && warnings.length === 0) problems.push(`${label}: expected a warning, got none`);
  for (const flag of requiredWarnings(i.ext, target)) {
    if (!warnings.some(d => d.flag === flag)) problems.push(`${label}: expected warning ${flag}, got [${warnings.map(d => d.flag ?? '?').join(', ')}]`);
  }
  if (warnings.length && !warningsAllowed(i.meta, i.ext, target)) {
    const what = target === WASM_TARGET ? 'the browser compile must be warning-free unless warnings are expected' : 'warnings are not allowed';
    problems.push(`${label}: ${what}:\n${indent(warnings.map(fmtDiag).join('\n'))}`);
  }
  for (const r of allRuns(t)) {
    if (r.timedOut) { problems.push(`${label}: timed out (raise timeout= or fix the loop)`); return; }
    if (r.signal === 'output-limit') { problems.push(`${label}: produced more than 1 MiB of output`); return; }
  }
  const r = t.run;
  if (!r) return;
  const got = runOutcome(r);
  const detail = () => `${r.signal ?? r.trap ?? `exit ${r.exit}`}${r.stderr ? `\n${indent(r.stderr)}` : ''}`;
  if (e === 'runtime-error') {
    if (got === 'runs') problems.push(`${label}: expected a runtime error (non-zero exit, signal or trap), but it exited 0`);
  } else if (e === 'success' || e === 'warning') {
    if (got !== 'runs') problems.push(`${label}: expected exit 0, got ${detail()}`);
  } else if (e.startsWith('exit:')) {
    if (got !== e) problems.push(`${label}: expected ${e}, got ${detail()}`);
  }
  // Native sanitizer run: must be clean unless the sample is about UB/crashes or opted out.
  if (t.sanitizer && !t.sanitizer.ok && e !== 'ub' && e !== 'runtime-error' && i.meta.sanitize !== false) {
    problems.push(`${label}: ASan/UBSan is not clean: ${t.sanitizer.report ?? t.sanitizer.kind} (fix it, or mark expect=ub|runtime-error or sanitize=off)`);
  }
}

export function checkSample(i: CheckInput): CheckOutput {
  const problems: string[] = [];
  const notes: string[] = [];
  const { meta } = i;
  const res = i.results;

  if (meta.posix) {
    const firstCode = i.code.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).find(Boolean) ?? '';
    if (!/^#\s*define\s+_POSIX_C_SOURCE\s+200809L\b/.test(firstCode)) {
      problems.push('posix samples must start with `#define _POSIX_C_SOURCE 200809L` (content/AGENTS.md conventions)');
    }
  }
  if (meta.files?.length) problems.push('files= (multi-file samples) is not supported by tools/verify yet');

  // A target that already violates its expectation (wrong compile result, timeout, …) makes the
  // browser-vs-64-bit diff noise, so the flag problem waits until those are fixed.
  let targetsOk = true;
  for (const [target, t] of Object.entries(res) as Array<[TargetId, VerifiedTargetResult]>) {
    const before = problems.length;
    checkTarget(i, target, t, problems);
    if (problems.length > before) targetsOk = false;
  }

  const gcc = res[GCC];
  const clang = res[CLANG];
  const exempt = meta.platform || meta.expect === 'ub' || meta.expect === 'runtime-error';

  // gcc and clang must agree at runtime (after normalisation).
  if (gcc?.compile.ok && clang?.compile.ok && !exempt) {
    const a = comparable(meta, gcc);
    const b = comparable(meta, clang);
    if (a !== b) problems.push(`gcc and clang 22 disagree (add platform if this is a genuine ABI difference):\n${indent(lineDiff(a, b))}`);
  }
  // Sanitizer reports are compared by (file, line, kind).
  if (gcc?.sanitizer && clang?.sanitizer && meta.expect !== 'ub' && !meta.platform && meta.sanitize !== false) {
    const a = sanitizerKey(gcc.sanitizer);
    const b = sanitizerKey(clang.sanitizer);
    if (a !== b) problems.push(`gcc and clang 22 sanitizer reports differ: ${a} vs ${b}`);
  }
  // The browser guardrail must report what native UBSan reports.
  const wasm = res[WASM_TARGET];
  if (meta.guardrail && wasm?.guardrail && !meta.platform) {
    const native = gcc?.sanitizer ?? clang?.sanitizer;
    const g = parseSanitizer(wasm.guardrail.stderr);
    if (native && !native.ok && isUbsanKind(native.kind) && sanitizerKey({ ...g, file: g.file ?? native.file }) !== sanitizerKey(native)) {
      problems.push(`browser guardrail report differs from native UBSan: ${sanitizerKey(g)} vs ${sanitizerKey(native)}`);
    }
  }
  // Diagnostics: gcc and clang need not match, but the two clang 22 builds normally do.
  if (clang && wasm) {
    const d = diagnosticDiff(clang.compile.diagnostics, wasm.compile.diagnostics);
    if (d.onlyA.length || d.onlyB.length) notes.push(`clang 22 native vs browser diagnostics differ (line:severity:flag): native-only [${d.onlyA.join(', ')}], browser-only [${d.onlyB.join(', ')}]`);
  }

  // ---- §3.2: the automatic browser vs 64-bit flag ----
  const base: TargetId | null = meta.target === 'native' ? (gcc ? GCC : null) : wasm ? WASM_TARGET : null;
  const baseT = base ? res[base] : undefined;
  const diffs: CheckOutput['diffs'] = [];
  if (base && baseT) {
    const others: Array<{ target: TargetId; result: TargetResult }> = [];
    if (base === WASM_TARGET && gcc) others.push({ target: GCC, result: gcc });
    others.push(...(i.stored ?? []).filter(s => s.target !== base));
    const mine = comparable(meta, baseT);
    for (const o of others) {
      const theirs = comparable(meta, o.result);
      if (theirs !== mine) diffs.push({ target: o.target, diff: lineDiff(mine, theirs) });
    }
  }
  const flagged = diffs.length > 0;
  if (flagged) {
    const ack = meta.platform && meta.predict64 !== undefined && (meta.predict64 !== 'none' || !!meta.predict64Reason);
    if (!ack && targetsOk) {
      const vs = diffs.map(d => `${TARGET_LABEL[base!]} vs ${TARGET_LABEL[d.target]} ("-" = ${base}, "+" = ${d.target}):\n${indent(d.diff)}`).join('\n');
      problems.push('output differs between the browser and a 64-bit target; add `platform` and `predict64="<question>"` ' +
        `(or \`predict64=none reason="…"\`):\n${vs}`);
    }
  } else if (meta.platform) {
    notes.push('`platform` is declared but no target differs from the browser (yet)');
  }
  if (meta.predict64 === 'none' && !meta.predict64Reason) problems.push('predict64=none needs reason="…"');

  // ---- canonical answer ----
  const firstRun = (t?: TargetResult) => (t ? allRuns(t)[0] : undefined);
  const answer: SampleResult['answer'] = {
    stdout: baseT?.compile.ok ? (firstRun(baseT)?.stdout ?? '') : '',
    outcome: outcomeOf(baseT),
  };
  if (gcc) answer.native = { stdout: gcc.compile.ok ? (firstRun(gcc)?.stdout ?? '') : '', outcome: outcomeOf(gcc) };

  if (meta.predict === 'choice') {
    const choices = meta.choices ?? [];
    if (choices.length < 2) problems.push('predict=choice needs at least two choices');
    else {
      const actual = answer.stdout.trim();
      const hits = choices.filter(c => c.trim() === actual).length;
      if (hits !== 1) problems.push(`predict=choice: the browser output must equal exactly one choice (it matches ${hits}):\n  output: ${JSON.stringify(actual)}\n  choices: ${JSON.stringify(choices)}`);
    }
  }
  return { problems, notes, flagged, diffs, answer };
}
