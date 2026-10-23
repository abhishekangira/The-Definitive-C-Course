import type { SamplesFile } from '../content-model/types';
import { sample64Verdict, sampleVerdict, type ProgressV1 } from './store';

/** Predictions belong to lesson file stems, never quiz samples. A native question counts separately. */
export function lessonPredictionStats(samples: SamplesFile | null, stem: string, progress: Pick<ProgressV1, 'samples'>) {
  let right = 0, total = 0;
  for (const s of Object.values(samples?.samples ?? {})) {
    if (s.lesson.startsWith('quiz:') || s.lesson !== stem) continue;
    const saved = Object.hasOwn(progress.samples, s.id) ? progress.samples[s.id] : undefined;
    const answered = saved && !saved.cleared;
    if (s.meta.predict === 'output' || s.meta.predict === 'outcome' || s.meta.predict === 'choice') {
      total++;
      if (answered && sampleVerdict(saved) === 'exact') right++;
    }
    if (s.flagged && s.meta.predict64 && s.meta.predict64 !== 'none') {
      total++;
      if (answered && sample64Verdict(saved) === 'exact') right++;
    }
  }
  return { right, total, perfect: total > 0 && right === total };
}

export function coursePredictionStats(modules: Array<{ samples: SamplesFile | null; lessons: Array<{ stem: string }> }>, progress: Pick<ProgressV1, 'samples'>) {
  let perfect = 0, total = 0;
  for (const m of modules) for (const lesson of m.lessons) {
    const stats = lessonPredictionStats(m.samples, lesson.stem, progress);
    if (stats.total > 0) total++;
    if (stats.perfect) perfect++;
  }
  return { perfect, total };
}
