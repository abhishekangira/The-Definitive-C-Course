// What a <CompilerError session="…"> grades against: the stored native report (src/generated/sessions, written by
// tools/verify), never a value typed into MDX. Also the fix check that every CompilerError shares.
import type { SessionStepResult } from '../content-model/types';
import type { RunSummary } from '../runtime/useCRun';
import { normOutput } from './platform';

export const STAGES = ['preprocess', 'compile', 'assemble', 'link', 'run'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { preprocess: 'Preprocess', compile: 'Compile', assemble: 'Assemble', link: 'Link', run: 'Run' };

export interface Frame { file: string; line: number }

// `main.c:5:39` (compilers, ASan, UBSan), `(l.c:4)` (Valgrind), after a line start, a space, `(` or the run folder `<dir>/`.
// A library frame (`../csu/libc-start.c:360`, `vg_replace_malloc.c:393`) never names one of the session's files.
const FILE_LINE = /(?:^|[\s(]|<dir>\/)([\w.-]+\.[ch]):(\d+)/gm;

/** The report's first user frame: the first `file:line` that names one of the session's own sources, stderr before stdout. */
export function firstUserFrame(steps: SessionStepResult[], sources: Record<string, string>): Frame | undefined {
  for (const s of steps) {
    for (const text of [s.stderr, s.stdout]) {
      for (const m of text.matchAll(FILE_LINE)) if (Object.hasOwn(sources, m[1])) return { file: m[1], line: Number(m[2]) };
    }
  }
  return undefined;
}

/**
 * How the browser checks a fix: it compiles with no errors or warnings (`compile`), and also runs to the end under the
 * guardrail UBSan runtime (`ubsan`) or with no leak reported by leakcheck (`leak`). Anything else cannot be checked in
 * the browser, so that CompilerError has `fix={false}` and the next LT carries the fix.
 */
export type FixCheck = 'compile' | 'ubsan' | 'leak';

export const fixRunFlags = (check: FixCheck) => ({ guardrail: check === 'ubsan', leakcheck: check === 'leak' });

/**
 * What is still wrong with a fix, or null when it passes: a clean compile, a run to the end with no UBSan report (the
 * guardrail runtime prints `runtime error:` and exits 1), no leak, and the fixed reference's output when there is one.
 */
export function fixProblem(r: RunSummary, fixedOutput?: string): string | null {
  if (!r.compile.ok || r.compile.diagnostics.some(d => d.severity !== 'note')) return 'Still not clean: read the new message, which may point somewhere else.';
  if (r.result?.kind !== 'exit' || r.stderr.includes('runtime error:')) return 'It still stops with an error: read what the run says.';
  if (r.result.leakcheck?.length) return 'It still leaks: free every block you allocate.';
  if (fixedOutput !== undefined && normOutput(r.stdout) !== normOutput(fixedOutput)) return 'It compiles, but the output isn\'t right yet.';
  return null;
}
