// Compiles and runs one sample on every target (PLAN §3.1 steps 2–5) and returns raw, normalised
// results. All judgement lives in checks.ts; this file only produces facts.
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { RunOutcome, TargetId } from '../../src/content-model/types';
import type { DiscoveredSample } from './discover';
import { expectFor, warningsAllowed } from './meta';
import { compileNative, runNative, writeSources, SANITIZER_ENV, type NativeToolchain } from './native';
import { markPointerConversions, normaliseRun, pointerMode, remapColumns, type Insertion, type MarkedSource, type PointerMode } from './normalise';
import { parseSanitizer } from './sanitizer';
import { canonicalUb } from './ub';
import { WASM_TARGET, type SampleRuns, type VerifiedTargetResult } from './types';
import type { WasmTarget } from './wasm';

export const DEFAULT_TIMEOUT_MS = 3000;
/** expect=ub samples run this many times per target (PLAN §3.4). */
export const UB_RUNS = 3;

export interface RunContext {
  native: NativeToolchain[];
  wasm: WasmTarget | null;
  tmpRoot: string;
  /** Skip the ASan+UBSan run (used by --target-run, which only records compile+run). */
  noSanitizer?: boolean;
  /** Never add -Werror (--target-run records what a platform does; warnings stay in diagnostics). */
  noWerror?: boolean;
}

interface RawRun { stdout: string; stderr: string; exit: number | null; signal: string | null; trap?: string | null; timedOut: boolean }

function outcome(raw: RawRun, mode: PointerMode, rebase: 'linux-x86_64' | 'none', insertions: Insertion[]): RunOutcome {
  const n = normaliseRun(raw.stdout, remapColumns(raw.stderr, insertions), mode, rebase);
  const o: RunOutcome = { stdout: n.stdout, stderr: n.stderr, exit: raw.exit, signal: raw.signal ?? null };
  if (n.stdoutDisplay !== undefined && n.stdoutDisplay !== n.stdout) o.stdoutDisplay = n.stdoutDisplay;
  if (raw.trap) o.trap = raw.trap;
  if (raw.timedOut) o.timedOut = true;
  return o;
}

const isLinuxX64 = (t: TargetId) => t === 'linux-x86_64-gcc13' || t === 'linux-x86_64-clang22';

async function runNativeTarget(s: DiscoveredSample, tc: NativeToolchain, mode: PointerMode, marked: MarkedSource | null, ctx: RunContext, out: SampleRuns): Promise<VerifiedTargetResult> {
  const { meta } = s;
  const dir = path.join(ctx.tmpRoot, s.id, tc.target);
  rmSync(dir, { recursive: true, force: true });
  writeSources(dir, { 'main.c': s.code });
  const werror = !ctx.noWerror && !warningsAllowed(meta, s.ext, tc.target);
  const exe = tc.kind === 'msvc' ? 'prog.exe' : 'prog';
  const c = await compileNative(tc, { dir, sources: ['main.c'], exe, werror, posix: meta.posix });
  const result: VerifiedTargetResult = { target: tc.target, compiler: tc.version, compile: { ok: c.ok, diagnostics: c.diagnostics, raw: c.raw } };
  if (!c.ok) return result;

  // The run uses the marked build (same file name, own directory) so %p output can be located.
  let runDir = dir;
  let insertions: Insertion[] = [];
  let runMode = mode;
  if (marked) {
    const mdir = path.join(dir, 'marked');
    writeSources(mdir, { 'main.c': marked.code });
    const mc = await compileNative(tc, { dir: mdir, sources: ['main.c'], exe, werror: false, posix: meta.posix });
    if (mc.ok) { runDir = mdir; insertions = marked.insertions; } else {
      runMode = 'heuristic';
      out.notes.push(`${tc.target}: the %p-marked build failed to compile; used the heuristic normaliser\n${mc.raw}`);
    }
  }
  const timeoutMs = meta.timeout ?? DEFAULT_TIMEOUT_MS;
  const rebase = isLinuxX64(tc.target) ? 'linux-x86_64' : 'none';
  const once = async (stdoutMode: 'tty' | 'pipe') =>
    outcome(await runNative({ dir: runDir, exe, stdin: meta.stdin, args: meta.args, timeoutMs, stdoutMode }), runMode, rebase, insertions);

  const mainMode = meta.stdoutMode === 'pipe' ? 'pipe' : 'tty';
  const runs: RunOutcome[] = [];
  const ub = expectFor(meta, s.ext, tc.target) === 'ub' || meta.expect === 'ub';
  for (let k = 0; k < (ub ? UB_RUNS : 1); k++) runs.push(await once(mainMode));
  if (ub) Object.assign(result, canonicalUb(runs));
  else result.run = runs[0];
  if (meta.stdoutMode === 'both') result.runPipe = await once('pipe');

  if (!ctx.noSanitizer && meta.sanitize !== false) {
    if (!tc.sanitizers) out.notes.push(`${tc.target}: sanitizer runtime not available here; ASan/UBSan run skipped`);
    else {
      const sc = await compileNative(tc, { dir, sources: ['main.c'], exe: 'prog-san', werror: false, posix: meta.posix, sanitize: true });
      if (!sc.ok) out.errors.push(`${tc.target}: sanitizer build failed:\n${sc.raw}`);
      else {
        const r = await runNative({ dir, exe: 'prog-san', stdin: meta.stdin, args: meta.args, timeoutMs: timeoutMs * 3, stdoutMode: 'pipe', env: SANITIZER_ENV });
        result.sanitizer = r.timedOut ? { ok: false, kind: 'timeout', report: 'timed out under ASan/UBSan' } : parseSanitizer(r.stderr);
      }
    }
  }
  return result;
}

async function runWasmTarget(s: DiscoveredSample, wasm: WasmTarget, mode: PointerMode, marked: MarkedSource | null, out: SampleRuns): Promise<VerifiedTargetResult> {
  const { meta } = s;
  const c = await wasm.compile(s.code);
  const result: VerifiedTargetResult = { target: WASM_TARGET, compiler: wasm.version, compile: { ok: c.ok, diagnostics: c.diagnostics, raw: c.raw } };
  if (!c.ok) return result;
  let bin = c.wasm!;
  let insertions: Insertion[] = [];
  let runMode = mode;
  if (marked) {
    const mc = await wasm.compile(marked.code);
    if (mc.ok) { bin = mc.wasm!; insertions = marked.insertions; } else {
      runMode = 'heuristic';
      out.notes.push(`${WASM_TARGET}: the %p-marked build failed to compile; used the heuristic normaliser\n${mc.raw}`);
    }
  }
  const timeoutMs = meta.timeout ?? DEFAULT_TIMEOUT_MS;
  const ub = expectFor(meta, s.ext, WASM_TARGET) === 'ub' || meta.expect === 'ub';
  const runs: RunOutcome[] = [];
  for (let k = 0; k < (ub ? UB_RUNS : 1); k++) runs.push(outcome(await wasm.run(bin, { stdin: meta.stdin, args: meta.args, timeoutMs }), runMode, 'none', insertions));
  if (ub) Object.assign(result, canonicalUb(runs));
  else result.run = runs[0];

  if (meta.guardrail) {
    const src = marked && runMode === 'markers' ? marked.code : s.code;
    const g = await wasm.compile(src, { guardrail: true });
    if (!g.ok) out.errors.push(`${WASM_TARGET}: guardrail build failed:\n${g.raw}`);
    else result.guardrail = outcome(await wasm.run(g.wasm!, { stdin: meta.stdin, args: meta.args, timeoutMs }), runMode, 'none', runMode === 'markers' ? insertions : []);
  }
  return result;
}

/** Compiles and runs one sample on the native toolchains in ctx and (unless target=native) in the browser toolchain. */
export async function runSample(s: DiscoveredSample, ctx: RunContext): Promise<SampleRuns> {
  const out: SampleRuns = { results: {}, pointerMode: pointerMode(s.code, s.meta.norm), notes: [], errors: [] };
  const marked = out.pointerMode === 'markers' ? markPointerConversions(s.code) : null;
  mkdirSync(ctx.tmpRoot, { recursive: true });
  // Targets run concurrently: native work happens in child processes, wasm in this process.
  const jobs: Array<[TargetId, () => Promise<VerifiedTargetResult>]> = ctx.native.map(tc => [tc.target, () => runNativeTarget(s, tc, out.pointerMode, marked, ctx, out)]);
  if (ctx.wasm && s.meta.target !== 'native') jobs.push([WASM_TARGET, () => runWasmTarget(s, ctx.wasm!, out.pointerMode, marked, out)]);
  const settled = await Promise.allSettled(jobs.map(([, job]) => job()));
  settled.forEach((r, i) => {
    const target = jobs[i][0];
    if (r.status === 'fulfilled') out.results[target] = r.value;
    else out.errors.push(`${target}: ${(r.reason as Error)?.message ?? r.reason}`);
  });
  rmSync(path.join(ctx.tmpRoot, s.id), { recursive: true, force: true });
  return out;
}
