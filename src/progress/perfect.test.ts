import { describe, expect, it } from 'vitest';
import type { SampleResult, SamplesFile } from '../content-model/types';
import { emptyProgress, type SampleProgress } from './store';
import { coursePredictionStats, lessonPredictionStats } from './perfect';

const sample = (id: string, extra: Partial<SampleResult> = {}): SampleResult => ({
  id, module: 'm', lesson: 'lesson', code: '', meta: { id, predict: 'output' }, hash: '', flagged: false, results: {},
  answer: { stdout: '', outcome: 'runs' }, ...extra,
});
const file = (...samples: SampleResult[]): SamplesFile => ({ module: 'm', generatedBy: 'test', samples: Object.fromEntries(samples.map(s => [s.id, s])) });
const entry = (extra: Partial<SampleProgress> = {}): SampleProgress => ({ prediction: 'answer', correct: true, verdict: 'exact', at: new Date().toISOString(), ...extra });

describe('perfect lessons are derived from current predictions', () => {
  it.each(['exact', 'close', 'wrong'] as const)('counts only exact, never %s as a pass by correct alone', verdict => {
    const p = emptyProgress(); p.samples = { a: entry(), b: entry({ verdict }) };
    expect(lessonPredictionStats(file(sample('a'), sample('b')), 'lesson', p)).toEqual({ right: verdict === 'exact' ? 2 : 1, total: 2, perfect: verdict === 'exact' });
  });
  it('includes outcome and choice, ignores quizzes, other lessons and predict=none', () => {
    const p = emptyProgress(); p.samples.a = entry(); p.samples.b = entry();
    const samples = file(sample('a', { meta: { id: 'a', predict: 'outcome' } }), sample('b', { meta: { id: 'b', predict: 'choice' } }), sample('q', { lesson: 'quiz:lesson' }), sample('other', { lesson: 'other' }), sample('none', { meta: { id: 'none', predict: 'none' } }));
    expect(lessonPredictionStats(samples, 'lesson', p)).toEqual({ right: 2, total: 2, perfect: true });
    expect(lessonPredictionStats(samples, 'quiz:lesson', p).total).toBe(0);
  });
  it.each([undefined, 'none', 'What prints?'])('counts a 64-bit question only when flagged and asked (%s)', predict64 => {
    const p = emptyProgress(); p.samples.a = entry({ predict64Correct: true });
    for (const flagged of [false, true]) {
      const samples = file(sample('a', { flagged, meta: { id: 'a', predict: 'output', predict64 } }));
      const total = flagged && predict64 && predict64 !== 'none' ? 2 : 1;
      expect(lessonPredictionStats(samples, 'lesson', p)).toEqual({ right: total, total, perfect: true });
      p.samples.a.predict64Verdict = 'close';
      expect(lessonPredictionStats(samples, 'lesson', p).perfect).toBe(total === 1);
      delete p.samples.a.predict64Verdict;
    }
  });
  it('supports old correct entries, excludes cleared and missing answers, and missing native answers', () => {
    const p = emptyProgress(); p.samples.a = entry({ verdict: undefined });
    const samples = file(sample('a', { flagged: true, meta: { id: 'a', predict: 'output', predict64: 'Question' } }), sample('missing'));
    expect(lessonPredictionStats(samples, 'lesson', p)).toEqual({ right: 1, total: 3, perfect: false });
    p.samples.a.cleared = true;
    expect(lessonPredictionStats(samples, 'lesson', p).right).toBe(0);
  });
  it('excludes lessons with no predictions from course totals', () => {
    const p = emptyProgress(); p.samples.a = entry();
    expect(coursePredictionStats([{ samples: file(sample('a')), lessons: [{ stem: 'lesson' }, { stem: 'empty' }] }, { samples: null, lessons: [{ stem: 'missing' }] }], p)).toEqual({ perfect: 1, total: 1 });
    expect(lessonPredictionStats(null, 'empty', p).perfect).toBe(false);
  });
});
