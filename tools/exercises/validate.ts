// exercise.yaml validation (ExerciseMeta in src/content-model/types.ts, plus the optional
// parsons.accepted documented in tools/exercises/README.md).
import type { ExerciseKind, ExerciseMeta } from '../../src/content-model/types';

export interface MetaProblems {
  errors: string[];
  warnings: string[];
}

/** ExerciseMeta with the Parsons extension this verifier understands. */
export type VerifiedMeta = ExerciseMeta & { parsons?: { distractors: string[]; indent: boolean; accepted?: string[] } };

const KINDS: ExerciseKind[] = ['ct', 'fb', 'pa', 'lt'];
const KNOWN = ['id', 'kind', 'title', 'prompt', 'runsIn', 'hints', 'file', 'variants', 'parsons', 'sampleStdin'];
const SUGGEST: Record<string, string> = { 'runs-in': 'runsIn', runs_in: 'runsIn', hint: 'hints', variant: 'variants', 'sample-stdin': 'sampleStdin' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function validateExerciseMeta(raw: unknown, folderName: string): MetaProblems & { meta?: VerifiedMeta } {
  const p: MetaProblems = { errors: [], warnings: [] };
  if (!isObj(raw)) return { ...p, errors: ['exercise.yaml must be a mapping'] };
  for (const k of Object.keys(raw)) {
    if (!KNOWN.includes(k)) p.warnings.push(`unknown key "${k}"${SUGGEST[k] ? ` (did you mean "${SUGGEST[k]}"?)` : ''}`);
  }
  if (!nonEmpty(raw.id)) p.errors.push('"id" is required');
  else if (raw.id !== folderName) p.errors.push(`"id" is "${raw.id}" but the folder is "${folderName}"`);
  if (!KINDS.includes(raw.kind as ExerciseKind)) p.errors.push(`"kind" must be one of ${KINDS.join(', ')}`);
  if (!nonEmpty(raw.title)) p.errors.push('"title" is required');
  if (!nonEmpty(raw.prompt)) p.errors.push('"prompt" is required');
  if (raw.runsIn !== 'browser' && raw.runsIn !== 'native') p.errors.push('"runsIn" must be "browser" or "native"');
  if (raw.kind === 'lt' && raw.runsIn !== 'native') p.errors.push('LT (local task) exercises must have runsIn: native');
  if (raw.kind === 'pa' && raw.runsIn !== 'browser') p.errors.push('Parsons exercises must have runsIn: browser');

  if (!Array.isArray(raw.hints)) p.errors.push('"hints" must be a list of exactly 3 hints (nudge, concept, partial code)');
  else {
    if (raw.hints.length !== 3) p.errors.push(`"hints" must have exactly 3 tiers, found ${raw.hints.length}`);
    raw.hints.forEach((h, i) => { if (!nonEmpty(h)) p.errors.push(`hint ${i + 1} is empty`); });
  }
  if (!Array.isArray(raw.variants) || !raw.variants.every(nonEmpty)) p.errors.push('"variants" must be a list of variant folder names ([] for none)');
  else if (new Set(raw.variants).size !== raw.variants.length) p.errors.push('"variants" lists a folder twice');
  if (raw.file !== undefined && !(nonEmpty(raw.file) && /\.c$/.test(raw.file))) p.errors.push('"file" must be a .c file name');
  if (raw.sampleStdin !== undefined && typeof raw.sampleStdin !== 'string') p.errors.push('"sampleStdin" must be a string');

  if (raw.kind === 'pa') {
    const pa = raw.parsons;
    if (!isObj(pa)) p.errors.push('Parsons exercises need a "parsons" mapping (distractors, indent)');
    else {
      if (!Array.isArray(pa.distractors) || !pa.distractors.every(nonEmpty)) p.errors.push('"parsons.distractors" must be a list of lines ([] for none)');
      if (typeof pa.indent !== 'boolean') p.errors.push('"parsons.indent" must be true or false');
      if (pa.accepted !== undefined && !(Array.isArray(pa.accepted) && pa.accepted.every(nonEmpty))) {
        p.errors.push('"parsons.accepted" must be a list of alternative orderings (each a block of lines)');
      }
      for (const k of Object.keys(pa)) if (!['distractors', 'indent', 'accepted'].includes(k)) p.warnings.push(`unknown key "parsons.${k}"`);
    }
  } else if (raw.parsons !== undefined) p.warnings.push('"parsons" is only used by kind: pa');

  return p.errors.length ? p : { ...p, meta: raw as unknown as VerifiedMeta };
}
