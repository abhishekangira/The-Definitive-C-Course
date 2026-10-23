import { describe, expect, it } from 'vitest';
import type { SampleResult, SamplesFile } from '../content-model/types';
import { emptyProgress, type SampleProgress } from './store';
import { coursePredictionStats, lessonPredictionStats, perfectHint, scoredItemsLabel } from './perfect';

const sample = (id: string, extra: Partial<SampleResult> = {}): SampleResult => ({
  id, module: 'm', lesson: 'lesson', code: '', meta: { id, predict: 'output' }, hash: '', flagged: false, results: {},
  answer: { stdout: '', outcome: 'runs' }, ...extra,
});
const file = (...samples: SampleResult[]): SamplesFile => ({ module: 'm', generatedBy: 'test', samples: Object.fromEntries(samples.map(s => [s.id, s])) });
const entry = (extra: Partial<SampleProgress> = {}): SampleProgress => ({ prediction: 'answer', correct: true, verdict: 'exact', at: new Date().toISOString(), ...extra });

describe('perfect lessons are derived from first-try predictions', () => {
  it.each(['exact', 'close', 'wrong'] as const)('counts only exact, never %s as a pass by correct alone', verdict => {
    const p = emptyProgress(); p.samples = { a: entry(), b: entry({ verdict }) };
    expect(lessonPredictionStats(file(sample('a'), sample('b')), 'lesson', p)).toMatchObject({ right: verdict === 'exact' ? 2 : 1, total: 2, perfect: verdict === 'exact' });
  });
  it('includes outcome and choice, ignores quizzes, other lessons and predict=none', () => {
    const p = emptyProgress(); p.samples.a = entry(); p.samples.b = entry();
    const samples = file(sample('a', { meta: { id: 'a', predict: 'outcome' } }), sample('b', { meta: { id: 'b', predict: 'choice' } }), sample('q', { lesson: 'quiz:lesson' }), sample('other', { lesson: 'other' }), sample('none', { meta: { id: 'none', predict: 'none' } }));
    expect(lessonPredictionStats(samples, 'lesson', p)).toMatchObject({ right: 2, total: 2, perfect: true });
    expect(lessonPredictionStats(samples, 'quiz:lesson', p).total).toBe(0);
  });
  it.each([undefined, 'none', 'What prints?'])('counts a 64-bit question only when flagged and asked (%s)', predict64 => {
    const p = emptyProgress(); p.samples.a = entry({ predict64Correct: true });
    for (const flagged of [false, true]) {
      const samples = file(sample('a', { flagged, meta: { id: 'a', predict: 'output', predict64 } }));
      const total = flagged && predict64 && predict64 !== 'none' ? 2 : 1;
      expect(lessonPredictionStats(samples, 'lesson', p)).toMatchObject({ right: total, total, perfect: true });
      p.samples.a.predict64Verdict = 'close';
      expect(lessonPredictionStats(samples, 'lesson', p).perfect).toBe(total === 1);
      delete p.samples.a.predict64Verdict;
    }
  });
  it('supports old correct entries, excludes cleared and missing answers, and missing native answers', () => {
    const p = emptyProgress(); p.samples.a = entry({ verdict: undefined });
    const samples = file(sample('a', { flagged: true, meta: { id: 'a', predict: 'output', predict64: 'Question' } }), sample('missing'));
    expect(lessonPredictionStats(samples, 'lesson', p)).toMatchObject({ right: 1, total: 3, perfect: false });
    p.samples.a.cleared = true;
    expect(lessonPredictionStats(samples, 'lesson', p).right).toBe(0);
  });
  it('excludes lessons with no predictions from course totals', () => {
    const p = emptyProgress(); p.samples.a = entry();
    expect(coursePredictionStats([{ samples: file(sample('a')), lessons: [{ stem: 'lesson' }, { stem: 'empty' }] }, { samples: null, lessons: [{ stem: 'missing' }] }], p)).toEqual({ perfect: 1, total: 1 });
    expect(lessonPredictionStats(null, 'empty', p).perfect).toBe(false);
  });
});

it('an omitted prediction kind uses the same output default as CodeSample', () => {
  const p = emptyProgress(); p.samples.a = entry();
  expect(lessonPredictionStats(file(sample('a', { meta: { id: 'a' } })), 'lesson', p)).toMatchObject({ right: 1, total: 1, perfect: true });
});

describe('quiz questions count toward a perfect lesson', () => {
  const quiz = { lessonId: 'm-l1', qids: ['qaaaa0001', 'qbbbb0002'] };
  const right = (at = new Date().toISOString()) => ({ picked: 0, correct: true, at });
  it('is perfect only when every prediction and every quiz question was right on the first try', () => {
    const p = emptyProgress(); p.samples.a = entry();
    const samples = file(sample('a'));
    // The M1 L1 bug: one exact prediction is not a perfect lesson while its questions are unanswered.
    expect(lessonPredictionStats(samples, 'lesson', p, quiz)).toMatchObject({ right: 1, total: 3, predictions: 1, questions: 2, answered: 1, perfect: false });
    p.choices['m-l1#qaaaa0001'] = right();
    expect(lessonPredictionStats(samples, 'lesson', p, quiz).perfect).toBe(false);
    p.choices['m-l1#qbbbb0002'] = right();
    expect(lessonPredictionStats(samples, 'lesson', p, quiz)).toMatchObject({ right: 3, total: 3, answered: 3, perfect: true });
    p.choices['m-l1#qbbbb0002'] = { picked: 2, correct: false, at: new Date().toISOString() };
    expect(lessonPredictionStats(samples, 'lesson', p, quiz)).toMatchObject({ right: 2, perfect: false });
  });
  it('a lesson with only quiz questions can be perfect; one with no scored items never is', () => {
    const p = emptyProgress(); p.choices['m-l1#qaaaa0001'] = right(); p.choices['m-l1#qbbbb0002'] = right();
    expect(lessonPredictionStats(null, 'lesson', p, quiz)).toMatchObject({ total: 2, perfect: true });
    expect(lessonPredictionStats(null, 'lesson', p, { lessonId: 'm-l1', qids: [] })).toMatchObject({ total: 0, perfect: false });
    expect(lessonPredictionStats(file(sample('n', { meta: { id: 'n', predict: 'none' } })), 'lesson', p)).toMatchObject({ total: 0, perfect: false });
  });
  it('reads answers by question id, so a key for a question the lesson no longer has (or a position key) does not count', () => {
    const p = emptyProgress(); p.choices['m-l1#0'] = right(); p.choices['m-l1#1'] = right(); p.choices['m-l1#qgone0003'] = right();
    expect(lessonPredictionStats(null, 'lesson', p, quiz)).toMatchObject({ right: 0, answered: 0, total: 2, perfect: false });
    // A question added before the others does not move them: their answers stay under their own ids.
    p.choices['m-l1#qaaaa0001'] = right(); p.choices['m-l1#qbbbb0002'] = right();
    expect(lessonPredictionStats(null, 'lesson', p, { lessonId: 'm-l1', qids: ['qnew00003', ...quiz.qids] })).toMatchObject({ right: 2, total: 3, perfect: false });
  });
  it('another lesson\'s answers do not count', () => {
    const p = emptyProgress(); p.choices['m-l2#qaaaa0001'] = right(); p.choices['m-l2#qbbbb0002'] = right();
    expect(lessonPredictionStats(null, 'lesson', p, quiz).right).toBe(0);
  });
  it('counts quiz questions in course totals from the lesson frontmatter', () => {
    const p = emptyProgress(); p.samples.a = entry();
    const modules = [{ samples: file(sample('a')), lessons: [{ stem: 'lesson', frontmatter: { id: 'm-l1', choices: ['qaaaa0001', 'qbbbb0002'] } }] }];
    expect(coursePredictionStats(modules, p)).toEqual({ perfect: 0, total: 1 });
    p.choices['m-l1#qaaaa0001'] = right(); p.choices['m-l1#qbbbb0002'] = right();
    expect(coursePredictionStats(modules, p)).toEqual({ perfect: 1, total: 1 });
  });
  it('the celebration hint names only the kinds the lesson scored', () => {
    expect(perfectHint({ predictions: 2, questions: 3 })).toBe('Every prediction and quiz question right on the first try.');
    expect(perfectHint({ predictions: 1, questions: 0 })).toBe('Every prediction right on the first try.');
    expect(perfectHint({ predictions: 0, questions: 2 })).toBe('Every quiz question right on the first try.');
  });
  it('names what was scored', () => {
    expect(scoredItemsLabel({ predictions: 2, questions: 3, total: 5 })).toBe('predictions and quiz questions');
    expect(scoredItemsLabel({ predictions: 1, questions: 0, total: 1 })).toBe('prediction');
    expect(scoredItemsLabel({ predictions: 0, questions: 2, total: 2 })).toBe('quiz questions');
  });
});

describe('first try only', () => {
  it('a missed first try stays missed after Predict again and a right second answer', () => {
    const p = emptyProgress(); p.samples.a = entry({ first: 'wrong' });
    expect(lessonPredictionStats(file(sample('a')), 'lesson', p)).toMatchObject({ right: 0, perfect: false });
  });
  it('a right first try still counts while the prediction is cleared by Predict again', () => {
    const p = emptyProgress(); p.samples.a = { prediction: '', correct: false, cleared: true, first: 'exact', at: new Date().toISOString() };
    expect(lessonPredictionStats(file(sample('a')), 'lesson', p)).toMatchObject({ right: 1, perfect: true });
  });
  it('a close first try is not perfect, and the 64-bit question has its own first try', () => {
    const p = emptyProgress(); p.samples.a = entry({ first: 'close' });
    expect(lessonPredictionStats(file(sample('a')), 'lesson', p).perfect).toBe(false);
    p.samples.a = entry({ first: 'exact', predict64: '8', predict64Correct: true, predict64Verdict: 'exact', first64: 'wrong' });
    const flagged = file(sample('a', { flagged: true, meta: { id: 'a', predict: 'output', predict64: 'What prints?' } }));
    expect(lessonPredictionStats(flagged, 'lesson', p)).toMatchObject({ right: 1, total: 2, perfect: false });
  });
  it('progress saved before first tries were kept reads the current answer (backward compatible)', () => {
    const p = emptyProgress(); p.samples.a = entry();
    expect(lessonPredictionStats(file(sample('a')), 'lesson', p).perfect).toBe(true);
    p.samples.a = { prediction: '', correct: false, cleared: true, at: new Date().toISOString() };
    expect(lessonPredictionStats(file(sample('a')), 'lesson', p).perfect).toBe(false);
  });
});
