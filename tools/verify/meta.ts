// Fence meta for the verifier: the shared parser (src/content-model/fence-meta.ts, which already
// handles expect.<compiler>=… into meta.expectBy) plus keys only the verifier needs. These are
// stripped before calling toSampleMeta():
//   warn=-Wa,-Wb               warnings that must appear on every compiled target
//   warn.<compiler>=-Wa        warnings that must appear on one target (implies warnings are allowed there)
//   fragment=partial           an illustration that is not even syntax-checked (listed in the report)
// <compiler> is a CompilerKey (gcc, clang, wasm, apple, msvc), as for expect.<compiler>.
import { parseRawMeta, toSampleMeta, FenceMetaError, type RawMeta } from '../../src/content-model/fence-meta';
import { COMPILER_TARGET, type CompilerKey, type Expect, type SampleMeta, type TargetId } from '../../src/content-model/types';

export interface ExtMeta {
  /** meta.expectBy keyed by target id. */
  expectByTarget: Partial<Record<TargetId, Expect>>;
  /** Required warning flags (normalised, e.g. "-Wformat"); key '*' applies to every target. */
  warnByTarget: Partial<Record<TargetId | '*', string[]>>;
  fragmentPartial: boolean;
}

export interface ParsedMeta {
  /** null: a C fence with neither id= nor fragment (an error in lessons). */
  meta: SampleMeta | null;
  ext: ExtMeta;
  raw: RawMeta;
}

function compilerTarget(key: string, full: string): TargetId {
  const t = COMPILER_TARGET[key as CompilerKey];
  if (!t) throw new FenceMetaError(`unknown compiler in "${full}" (use ${Object.keys(COMPILER_TARGET).join(', ')})`);
  return t;
}

const splitFlags = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean).map(f => (f.startsWith('-W') ? f : `-W${f}`));

export function parseFenceMeta(metaString: string | null | undefined): ParsedMeta {
  const raw = parseRawMeta(metaString);
  const shared: RawMeta = {};
  const ext: ExtMeta = { expectByTarget: {}, warnByTarget: {}, fragmentPartial: false };
  for (const [k, v] of Object.entries(raw)) {
    const warnFor = /^warn\.(.+)$/.exec(k);
    if (warnFor) {
      if (typeof v !== 'string') throw new FenceMetaError(`${k} needs a value, e.g. ${k}=-Wformat`);
      ext.warnByTarget[compilerTarget(warnFor[1], k)] = splitFlags(v);
    } else if (k === 'warn') {
      if (typeof v !== 'string') throw new FenceMetaError('warn needs a value, e.g. warn=-Wformat');
      ext.warnByTarget['*'] = splitFlags(v);
    } else if (k === 'fragment' && v === 'partial') {
      ext.fragmentPartial = true;
      shared.fragment = true;
    } else shared[k] = v;
  }
  const meta = toSampleMeta(shared);
  for (const [key, e] of Object.entries(meta?.expectBy ?? {})) ext.expectByTarget[compilerTarget(key, `expect.${key}`)] = e;
  return { meta, ext, raw };
}

/** The expectation that applies to one target. */
export function expectFor(meta: SampleMeta, ext: ExtMeta, target: TargetId): Expect {
  return ext.expectByTarget[target] ?? meta.expect ?? 'success';
}

/** Warning flags that must appear on one target (target-specific list wins over warn=). */
export function requiredWarnings(ext: ExtMeta, target: TargetId): string[] {
  return ext.warnByTarget[target] ?? ext.warnByTarget['*'] ?? [];
}

/** Whether warnings are acceptable on a target (no -Werror natively, no "must be warning-free" in wasm). */
export function warningsAllowed(meta: SampleMeta, ext: ExtMeta, target: TargetId): boolean {
  const e = expectFor(meta, ext, target);
  return e === 'warning' || e === 'compile-error' || e === 'ub' || requiredWarnings(ext, target).length > 0;
}
