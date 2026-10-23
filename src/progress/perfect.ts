import type { SamplesFile } from '../content-model/types';
import { choiceKey, firstSample64Verdict, firstSampleVerdict, type ProgressV1 } from './store';

/** The lesson's "Check your understanding" questions: its id (the key prefix in `progress.choices`) and each question's `qid`. */
export interface LessonQuiz { lessonId: string; qids: readonly string[] }

/**
 * A lesson is perfect when every scored item was right on the first try: every prediction (and every 64-bit
 * prediction of a flagged sample) exact the first time it was revealed, and every quiz question ("Check your
 * understanding", `<Choice>`) right on its first submission. "Predict again" and "Check again" do not reset that.
 * Predictions belong to lesson file stems, never quiz samples. A lesson with no scored items is never perfect.
 * Saved progress from before first tries were kept has no `first`: the current answer stands in for it. A quiz
 * question with no saved answer is not right, so an old lesson with quiz questions is not perfect until they are answered.
 */
export function lessonPredictionStats(samples: SamplesFile | null, stem: string, progress: Pick<ProgressV1, 'samples'> & Partial<Pick<ProgressV1, 'choices'>>, quiz?: LessonQuiz) {
  let right = 0, total = 0, predictions = 0, questions = 0, answered = 0;
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
  return { right, total, predictions, questions, answered, perfect: total > 0 && right === total };
}

/** "predictions and quiz questions", or just the kind the lesson has. */
export function scoredItemsLabel(stats: { predictions: number; questions: number; total: number }): string {
  const plural = stats.total === 1 ? '' : 's';
  if (stats.questions === 0) return `prediction${plural}`;
  if (stats.predictions === 0) return `quiz question${plural}`;
  return 'predictions and quiz questions';
}

/** The celebration's hint: "Every prediction …", "Every quiz question …" or both, for the kinds the lesson scored. */
export function perfectHint(stats: { predictions: number; questions: number }): string {
  const what = stats.questions === 0 ? 'prediction' : stats.predictions === 0 ? 'quiz question' : 'prediction and quiz question';
  return `Every ${what} right on the first try.`;
}

/** The quiz question ids a lesson's frontmatter carries (the `?frontmatter` loader adds `choices`). */
export const lessonQuiz = (frontmatter: { id: string; choices?: readonly string[] } | undefined): LessonQuiz | undefined =>
  frontmatter && frontmatter.choices?.length ? { lessonId: frontmatter.id, qids: frontmatter.choices } : undefined;

export function coursePredictionStats(modules: Array<{ samples: SamplesFile | null; lessons: Array<{ stem: string; frontmatter?: { id: string; choices?: readonly string[] } }> }>, progress: Pick<ProgressV1, 'samples'> & Partial<Pick<ProgressV1, 'choices'>>) {
  let perfect = 0, total = 0;
  for (const m of modules) for (const lesson of m.lessons) {
    const stats = lessonPredictionStats(m.samples, lesson.stem, progress, lessonQuiz(lesson.frontmatter));
    if (stats.total > 0) total++;
    if (stats.perfect) perfect++;
  }
  return { perfect, total };
}
