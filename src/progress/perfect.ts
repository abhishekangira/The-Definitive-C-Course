import type { SamplesFile } from '../content-model/types';
import { choiceKey, compilerErrorKey, firstSample64Verdict, firstSampleVerdict, type ProgressV1 } from './store';

/**
 * The lesson's "Check your understanding" questions: its id (the key prefix in `progress.choices` and
 * `progress.compilerErrors`), each `<Choice>` question's `qid`, and each compiler-error question's
 * `<instance>:<kind>` id. All come from the `?frontmatter` loader.
 */
export interface LessonQuiz { lessonId: string; qids: readonly string[]; compilerErrors?: readonly string[] }

/**
 * A lesson is perfect when every scored item was right on the first try: every prediction (and every 64-bit
 * prediction of a flagged sample) exact the first time it was revealed, every quiz question ("Check your
 * understanding", `<Choice>`) right on its first submission, and every question a `<CompilerError>` asks (the line
 * clicked, the option submitted, the stage chosen) right on its first answer. "Predict again", "Check again" and a
 * retried line or option do not reset that. Predictions belong to lesson file stems, never quiz samples. A lesson
 * with no scored items is never perfect. Saved progress from before first tries were kept has no `first`: the
 * current answer stands in for it. A question with no saved answer is not right, so an old lesson is not perfect
 * until they are answered.
 */
export function lessonPredictionStats(
  samples: SamplesFile | null,
  stem: string,
  progress: Pick<ProgressV1, 'samples'> & Partial<Pick<ProgressV1, 'choices' | 'compilerErrors'>>,
  quiz?: LessonQuiz,
) {
  let right = 0, total = 0, predictions = 0, questions = 0, compilerErrors = 0, answered = 0;
  for (const s of Object.values(samples?.samples ?? {})) {
    if (s.lesson.startsWith('quiz:') || s.lesson !== stem) continue;
    const saved = Object.hasOwn(progress.samples, s.id) ? progress.samples[s.id] : undefined;
    const kind = s.meta.predict ?? 'output';
    if (kind !== 'none') {
      total++; predictions++;
      const first = saved && firstSampleVerdict(saved);
      if (first) answered++;
      if (first === 'exact') right++;
    }
    if (s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none') {
      total++; predictions++;
      const first = saved && firstSample64Verdict(saved);
      if (first) answered++;
      if (first === 'exact') right++;
    }
  }
  const choices = progress.choices ?? {};
  for (const qid of quiz?.qids ?? []) {
    total++; questions++;
    const key = choiceKey(quiz!.lessonId, qid);
    const saved = Object.hasOwn(choices, key) ? choices[key] : undefined;
    if (saved) answered++;
    if (saved?.correct) right++;
  }
  const reports = progress.compilerErrors ?? {};
  for (const qid of quiz?.compilerErrors ?? []) {
    total++; compilerErrors++;
    const key = compilerErrorKey(quiz!.lessonId, qid);
    const saved = Object.hasOwn(reports, key) ? reports[key] : undefined;
    if (saved) answered++;
    if (saved?.correct) right++;
  }
  return { right, total, predictions, questions, compilerErrors, answered, perfect: total > 0 && right === total };
}

/** The scored kinds a lesson has, plural when it has more than one kind or more than one of that kind. */
function scoredKinds(stats: { predictions: number; questions: number; compilerErrors: number }): string[] {
  // Two kinds always mean at least two items ("3 of 3 prediction and compiler-error questions" reads wrong).
  const many = [stats.predictions, stats.questions, stats.compilerErrors].filter(n => n > 0).length > 1;
  const out: string[] = [];
  if (stats.predictions) out.push(`prediction${many || stats.predictions > 1 ? 's' : ''}`);
  if (stats.questions) out.push(`quiz question${many || stats.questions > 1 ? 's' : ''}`);
  if (stats.compilerErrors) out.push(`compiler-error question${many || stats.compilerErrors > 1 ? 's' : ''}`);
  return out;
}

/** "predictions and quiz questions", the one kind the lesson scored, or "questions" when it scores all three. */
export function scoredItemsLabel(stats: { predictions: number; questions: number; compilerErrors: number; total: number }): string {
  const kinds = scoredKinds(stats);
  if (kinds.length === 3) return 'questions';
  if (kinds.length === 2) return `${kinds[0]} and ${kinds[1]}`;
  return kinds[0] ?? `question${stats.total === 1 ? '' : 's'}`;
}

/** The celebration's hint: "Every prediction …" (and so on), or "Every question …" when listing all three is clumsy. */
export function perfectHint(stats: { predictions: number; questions: number; compilerErrors: number }): string {
  const kinds = scoredKinds(stats).map(kind => kind.replace(/s$/, ''));
  const what = kinds.length === 3 || kinds.length === 0 ? 'question' : kinds.join(' and ');
  return `Every ${what} right on the first try.`;
}

/** The lesson's scored question ids its frontmatter carries (the `?frontmatter` loader adds `choices` and `compilerErrors`). */
export const lessonQuiz = (frontmatter: { id: string; choices?: readonly string[]; compilerErrors?: readonly string[] } | undefined): LessonQuiz | undefined => {
  if (!frontmatter) return undefined;
  const qids = frontmatter.choices ?? [];
  const compilerErrors = frontmatter.compilerErrors ?? [];
  return qids.length || compilerErrors.length ? { lessonId: frontmatter.id, qids, compilerErrors } : undefined;
};

export function coursePredictionStats(modules: Array<{ samples: SamplesFile | null; lessons: Array<{ stem: string; frontmatter?: { id: string; choices?: readonly string[]; compilerErrors?: readonly string[] } }> }>, progress: Pick<ProgressV1, 'samples'> & Partial<Pick<ProgressV1, 'choices' | 'compilerErrors'>>) {
  let perfect = 0, total = 0;
  for (const m of modules) for (const lesson of m.lessons) {
    const stats = lessonPredictionStats(m.samples, lesson.stem, progress, lessonQuiz(lesson.frontmatter));
    if (stats.total > 0) total++;
    if (stats.perfect) perfect++;
  }
  return { perfect, total };
}
