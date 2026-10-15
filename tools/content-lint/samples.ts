// A C sample found in a lesson fence or a quiz item, and the rules that apply to its fence meta
// (PLAN §2.4 table, §3.2, §3.4, §4.4). Compilation and output checks belong to tools/verify; these are
// the authoring rules that can be decided from the text alone.
import type { SampleMeta } from '../../src/content-model/types';
import type { FileReporter } from './messages';

export interface SampleInfo {
  id: string;
  /** Absolute path of the lesson or quiz file. */
  file: string;
  line: number;
  module: string;
  where: 'lesson' | 'quiz';
  meta: SampleMeta;
  code: string;
  /** The fence lists required warnings (`warn=-Wformat`, `warn.clang=…`): the sample is expected to produce diagnostics. */
  warns: boolean;
}

/** Modules allowed to use POSIX APIs (PLAN §4.4: M11 dlopen, M13, and the capstone's provided memlib). */
export const POSIX_MODULES = new Set(['m11', 'm13', 'cap']);

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface SampleCheckContext {
  moduleId: string;
  /**
   * True for a fence that stands alone at the top level of a lesson: it becomes its own predict-before-run
   * interaction. Fences nested in a component (CompilerError, Stepper, PipelineExplorer, ...) are driven by
   * that component, and quiz items by their type, so they may be `predict=none`.
   */
  standalone: boolean;
}

export function checkSampleMeta(meta: SampleMeta, code: string, line: number, r: FileReporter, ctx: SampleCheckContext): void {
  if (!ID_RE.test(meta.id)) {
    r.error(line, 'sample-id', `sample id "${meta.id}" must be lower-case kebab-case (it names generated files)`);
  }
  if (ctx.standalone && meta.predict === 'none') {
    r.error(line, 'predict-before-run',
      `sample "${meta.id}" runs without a prediction (predict=none / run). Every id fence is predict-before-run; ` +
      'run-only is allowed only inside CT/FB editors and components such as <Stepper> or <CompilerError>. Nest the fence in one, or give it a prediction');
  }
  const ub = meta.expect === 'ub' || Object.values(meta.expectBy ?? {}).includes('ub');
  if (ub && meta.predict === 'output') {
    r.error(line, 'ub-prediction',
      `sample "${meta.id}" has undefined behaviour (expect=ub) but asks for its exact output. A UB question must be categorical: ` +
      'use predict=outcome or choices="…|…" (crash? same value every run? what does UBSan report?)');
  }
  if (meta.platform && meta.predict64 === undefined) {
    r.error(line, 'platform-predict64', `sample "${meta.id}" is marked platform but has no predict64="<question>" or predict64=none reason="…" (PLAN §3.2)`);
  }
  if (meta.predict64 !== undefined && !meta.platform) {
    r.error(line, 'platform-predict64', `sample "${meta.id}" has predict64 but is not marked platform: add the platform flag`);
  }
  if (meta.predict64 === 'none' && !meta.predict64Reason) {
    r.error(line, 'platform-predict64', `sample "${meta.id}": predict64=none needs reason="…"`);
  }
  if (meta.posix && !POSIX_MODULES.has(ctx.moduleId)) {
    r.error(line, 'posix-scope', `sample "${meta.id}" is marked posix, but POSIX appears only in M11, M13 and the capstone (PLAN §4.4)`);
  }
  if (!meta.posix && /^\s*#\s*define\s+_POSIX_C_SOURCE\b/m.test(code)) {
    r.error(line, 'posix-flag', `sample "${meta.id}" defines _POSIX_C_SOURCE: mark the fence posix (and keep POSIX to M11, M13 and the capstone)`);
  }
}
