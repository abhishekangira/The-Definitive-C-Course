// The questions a <CompilerError> asks, and the stable ids their first answers are saved under. The `?frontmatter`
// loader (which tells the perfect-lesson count what the lesson asks before anything is answered) and the component
// both use this module, so an id the loader counts is an id the component can save. A lesson whose ids differed
// could never be perfect; tools/mdx/lesson-qids.test.ts checks the compiled `ceid`s against the loader's.

/** One scored question of a compiler-error exercise. The line question is not asked for a link error (no source line). */
export type CompilerErrorQuestion = 'line' | 'kind' | 'stage';

/**
 * The questions an instance asks, in the order the component numbers them: which line, what is wrong, and which
 * stage failed when the author set `stage` (`stage="link"` asks no line; see content/AGENTS.md).
 */
export function compilerErrorQuestions(stage: string | undefined): CompilerErrorQuestion[] {
  return [...(stage === 'link' ? [] : ['line' as const]), 'kind', ...(stage === undefined ? [] : ['stage' as const])];
}

/** A question's id within its lesson: the exercise's stable id and the kind, e.g. `missing-semicolon:line`. */
export const compilerErrorQid = (instanceId: string, question: CompilerErrorQuestion) => `${instanceId}:${question}`;
