// Stepper traces (PLAN §3.3): builds a sample with the heap shim, steps it under gdb with
// tracer.py and returns a TraceFile (src/content-model/types.ts). Labelled "x86-64 Linux (gcc)".
// TRACE_VALGRIND=1 (or { valgrind: true }) adds a memcheck pass whose definedness bits ("init",
// "vbits") and error messages ("errors") are merged into the native trace when both passes
// stepped through the same lines.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TraceFile, TraceStep, TraceVar } from '../../src/content-model/types';
import { writeSources } from '../verify/native';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TRACER_PY = path.join(HERE, 'tracer.py');
export const HEAP_SHIM_C = path.join(HERE, 'heap_shim.c');
export const MAX_STEPS = 1000;

export const TRACE_CFLAGS = ['-std=c17', '-g', '-O0', '-fno-omit-frame-pointer', '-fno-inline', '-fdiagnostics-color=never'];
export const TRACE_LDFLAGS = ['-Wl,--wrap=malloc,--wrap=free,--wrap=calloc,--wrap=realloc', '-lm'];

export interface TraceInput {
  id: string;
  code: string;
  stdin?: string;
  args?: string[];
}

export interface TraceOptions {
  workDir: string;
  valgrind?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
}

/** Extra per-step/per-var fields the tracer may emit beyond the shared TraceFile type. */
export type TraceStepExt = TraceStep & { errors?: string[] };
export type TraceVarExt = TraceVar & { vbits?: string };

export function toolVersions(): { gcc: string; gdb: string; valgrind: string } {
  const first = (cmd: string) => (spawnSync(cmd, ['--version'], { encoding: 'utf8' }).stdout ?? '').split('\n')[0].trim();
  return { gcc: first('gcc'), gdb: first('gdb'), valgrind: first('valgrind') };
}

function run(cmd: string, args: string[], opts: { cwd: string; env?: Record<string, string>; timeoutMs: number }) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: 'utf8', env: { ...process.env, ...opts.env }, timeout: opts.timeoutMs, maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' };
}

/** Builds the program for tracing and runs one tracer pass. Returns the parsed JSON. */
function tracePass(input: TraceInput, dir: string, o: TraceOptions, valgrind: boolean): TraceFile {
  const out = path.join(dir, valgrind ? 'trace.vg.json' : 'trace.json');
  const stdinFile = path.join(dir, 'stdin.txt');
  writeFileSync(stdinFile, input.stdin ?? '');
  const r = run('gdb', ['-q', '-nx', '-batch', '-x', TRACER_PY], {
    cwd: dir,
    timeoutMs: o.timeoutMs ?? (valgrind ? 120_000 : 30_000),
    env: {
      TRACE_PROG: path.join(dir, 'prog'),
      TRACE_SRC: path.join(dir, 'main.c'),
      TRACE_OUT: out,
      TRACE_SAMPLE: input.id,
      TRACE_STDIN: stdinFile,
      TRACE_ARGS: JSON.stringify(input.args ?? []),
      TRACE_MAX_STEPS: String(o.maxSteps ?? MAX_STEPS),
      TRACE_VALGRIND: valgrind ? '1' : '0',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  if (r.timedOut) throw new Error(`trace ${input.id}: gdb timed out`);
  if (!existsSync(out) || !/TRACE_OK/.test(r.out)) throw new Error(`trace ${input.id}: tracer failed\n${r.out.trim()}`);
  return JSON.parse(readFileSync(out, 'utf8')) as TraceFile;
}

/** Copies valgrind-only facts (init/vbits/errors) into the native trace. Returns false if the passes diverged. */
export function mergeValgrind(native: TraceFile, vg: TraceFile): boolean {
  const lines = (t: TraceFile) => t.steps.map(s => `${s.func}:${s.line}`).join(',');
  if (lines(native) !== lines(vg)) return false; // behaviour depends on uninitialised data: keep native only
  native.steps.forEach((a, i) => {
    const b = vg.steps[i] as TraceStepExt;
    if (b.errors) (a as TraceStepExt).errors = b.errors;
    a.stack.forEach((fa, fi) => {
      const byName = new Map((vg.steps[i].stack[fi]?.vars ?? []).map(v => [v.name, v as TraceVarExt]));
      for (const v of fa.vars as TraceVarExt[]) {
        const w = byName.get(v.name);
        if (w?.init !== undefined) v.init = w.init;
        if (w?.vbits !== undefined) v.vbits = w.vbits;
      }
    });
    const hb = new Map(b.heap.map(h => [h.id, h as typeof h & { vbits?: string }]));
    for (const h of a.heap as Array<(typeof a.heap)[number] & { vbits?: string }>) {
      const w = hb.get(h.id);
      if (w?.init !== undefined) h.init = w.init;
      if (w?.vbits !== undefined) h.vbits = w.vbits;
    }
  });
  return true;
}

export interface TraceResult {
  trace: TraceFile;
  /** Non-fatal remarks (e.g. the valgrind pass diverged and was dropped). */
  notes: string[];
}

export function generateTrace(input: TraceInput, o: TraceOptions): TraceResult {
  const dir = path.join(o.workDir, input.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeSources(dir, { 'main.c': input.code });
  const notes: string[] = [];
  // The shim is compiled without -g so `step` never enters it.
  const shim = run('gcc', ['-O1', '-c', HEAP_SHIM_C, '-o', path.join(dir, 'heap_shim.o')], { cwd: dir, timeoutMs: 30_000 });
  if (!shim.ok) throw new Error(`trace ${input.id}: heap shim failed to build\n${shim.out}`);
  const cc = run('gcc', [...TRACE_CFLAGS, 'main.c', 'heap_shim.o', '-o', 'prog', ...TRACE_LDFLAGS], { cwd: dir, timeoutMs: 30_000 });
  if (!cc.ok) throw new Error(`trace ${input.id}: compile failed\n${cc.out}`);
  const trace = tracePass(input, dir, o, false);
  const wantVg = o.valgrind ?? process.env.TRACE_VALGRIND === '1';
  if (wantVg) {
    try {
      const vg = tracePass(input, dir, o, true);
      if (!mergeValgrind(trace, vg)) notes.push(`${input.id}: valgrind pass stepped differently (behaviour depends on uninitialised data?); kept the native trace only`);
    } catch (err) {
      notes.push(`${input.id}: valgrind pass failed: ${(err as Error).message}`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return { trace, notes };
}
