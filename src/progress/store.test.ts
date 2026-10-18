import { describe, expect, it } from 'vitest';
import {
  daysSinceExport, emptyProgress, exerciseProgress, getProgress, mergeProgress, markCard, migrate, summarise, update,
  type ExerciseProgress, type ProgressV1, type ProjectProgress, type QuizProgress, type SampleProgress,
} from './store';
import type { StreakData } from './streak';

const SEED = '0123456789abcdef';
const at = '2026-01-01T00:00:00.000Z';

function doc(patch: Partial<ProgressV1> = {}): ProgressV1 {
  return { ...emptyProgress(), seed: SEED, createdAt: at, ...patch };
}

const ex = (patch: Partial<ExerciseProgress> = {}): ExerciseProgress => ({ ...exerciseProgress(doc(), 'x'), ...patch });

describe('migrate', () => {
  it('accepts a valid document and fills in missing sections', () => {
    const p = migrate({ version: 1, seed: SEED, createdAt: at });
    expect(p.cards).toEqual({});
    expect(p.exercises).toEqual({});
    expect(p.settings).toEqual({});
    expect(p.seed).toBe(SEED);
  });

  it('keeps the data it was given', () => {
    const p = migrate({ version: 1, seed: SEED, createdAt: at, lessons: { 'm01-l1': { completedAt: at } }, settings: { platform: 'wsl' } });
    expect(Object.keys(p.lessons)).toEqual(['m01-l1']);
    expect(p.settings.platform).toBe('wsl');
  });

  it('keeps every field of every record: a field missing from the whitelist would be dropped on every load', () => {
    // `satisfies Required<...>` makes the compiler ask for a value here when a field is added to a record type,
    // and then this test fails until migrate() keeps that field too.
    const full = {
      version: 1, seed: SEED, createdAt: at, lastExportedAt: at,
      settings: { platform: 'wsl', storedOutputMode: true, stdinMode: 'preset' },
      cards: { 'm01-l1': [0, 1, 2] },
      lessons: { 'm01-l1': { completedAt: at } },
      samples: { s1: { prediction: 'x', correct: true, predict64: 'y', predict64Correct: false, at } satisfies Required<SampleProgress> },
      exercises: {
        e1: {
          attempts: 3, substantive: 2, lastCodeHash: 'abc', code: 'int main(void) { return 0; }', activeMs: 5, hintsViewed: 1, passed: true,
          solutionViewed: true, variant: 'e1/variants/1', variantsTried: ['e1/variants/1'], mastered: false, codes: ['TDCC1-R1-e1-DONE-00000000'], tutorAsks: 4,
        } satisfies Required<ExerciseProgress>,
      },
      quizzes: { q1: { score: 3, total: 4, passed: false, at, answers: { a: 1, b: 'x' } } satisfies Required<QuizProgress> },
      projects: { p1: { passed: true, at, token: 'TDCC1-R1-p1-DONE-00000000' } satisfies Required<ProjectProgress> },
      streak: { days: ['2026-01-01', '2026-01-02', '2026-01-04'], longest: 5 } satisfies StreakData,
    } satisfies ProgressV1;
    expect(migrate(structuredClone(full))).toEqual(full);
  });

  it.each([
    ['null', null],
    ['a string', 'progress'],
    ['an unknown version', { version: 2, seed: SEED }],
    ['a missing version', { seed: SEED }],
    ['a missing seed', { version: 1 }],
    ['a malformed seed', { version: 1, seed: 'not-hex' }],
    ['an uppercase seed', { version: 1, seed: SEED.toUpperCase().replace('0X', 'F') }],
  ])('rejects %s with a readable message', (_name, raw) => {
    expect(() => migrate(raw)).toThrow(/progress|seed|version/i);
  });
});

describe('streak in a progress document', () => {
  it('a document from before the streak existed gets an empty one', () => {
    expect(migrate({ version: 1, seed: SEED }).streak).toEqual({ days: [], longest: 0 });
  });

  it('keeps only real calendar days, sorted and unique, and a longest run that is at least what the days show', () => {
    const p = migrate({ version: 1, seed: SEED, streak: { days: ['2026-02-03', '2026-02-02', '2026-02-02', '2026-02-30', 'yesterday', 7, null, '2026-2-3'], longest: -4 } });
    expect(p.streak.days).toEqual(['2026-02-02', '2026-02-03']);
    expect(p.streak.longest).toBe(2);
  });

  it.each([['a string', 'hello'], ['an array', [1, 2]], ['a number', 3], ['null', null]])('replaces %s with an empty streak', (_n, junk) => {
    expect(migrate({ version: 1, seed: SEED, streak: junk }).streak).toEqual({ days: [], longest: 0 });
  });

  it('caps a hostile document: huge longest and a huge day list', () => {
    const days = Array.from({ length: 20_000 }, (_, i) => `2025-01-${String((i % 28) + 1).padStart(2, '0')}`);
    const p = migrate({ version: 1, seed: SEED, streak: { days, longest: 1e12 } });
    expect(p.streak.longest).toBeLessThanOrEqual(100_000);
    expect(p.streak.days.length).toBeLessThanOrEqual(400);
  });

  it('merge unions both histories and keeps the longest run from either side', () => {
    const a = doc({ streak: { days: ['2026-03-01', '2026-03-02'], longest: 2 } });
    const b = doc({ streak: { days: ['2026-03-03', '2026-04-10'], longest: 9 } });
    const m = mergeProgress(a, b);
    expect(m.streak.days).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-04-10']);
    expect(m.streak.longest).toBe(9);
    expect(a.streak.days).toEqual(['2026-03-01', '2026-03-02']); // inputs untouched
  });
});

describe('mergeProgress', () => {
  it('unions completed cards and keeps them sorted', () => {
    const a = doc({ cards: { l1: [0, 2] } });
    const b = doc({ cards: { l1: [1, 2], l2: [0] } });
    expect(mergeProgress(a, b).cards).toEqual({ l1: [0, 1, 2], l2: [0] });
  });

  it('keeps the furthest exercise progress from both sides', () => {
    const a = doc({ exercises: { cash: ex({ attempts: 5, hintsViewed: 1, passed: false, activeMs: 1000 }) } });
    const b = doc({ exercises: { cash: ex({ attempts: 2, hintsViewed: 3, passed: true, solutionViewed: true, activeMs: 9000, codes: ['c1'] }) } });
    const m = mergeProgress(a, b).exercises.cash;
    expect(m).toMatchObject({ attempts: 5, hintsViewed: 3, passed: true, solutionViewed: true, activeMs: 9000, codes: ['c1'] });
  });

  it('keeps the higher tutorAsks and does not treat it as attempts', () => {
    const a = doc({ exercises: { cash: ex({ tutorAsks: 1, attempts: 2 }) } });
    const b = doc({ exercises: { cash: ex({ tutorAsks: 4, attempts: 1 }) } });
    expect(mergeProgress(a, b).exercises.cash).toMatchObject({ tutorAsks: 4, attempts: 2 });
    expect(mergeProgress(b, a).exercises.cash.tutorAsks).toBe(4);
  });

  it('never loses a passed checkpoint, even when the other side scored higher without passing', () => {
    const passed = { score: 8, total: 10, passed: true, at, answers: {} };
    const higherButNotPassed = { score: 9, total: 10, passed: false, at, answers: {} };
    const merged = mergeProgress(doc({ quizzes: { 'm01:checkpoint': passed } }), doc({ quizzes: { 'm01:checkpoint': higherButNotPassed } }));
    expect(merged.quizzes['m01:checkpoint'].passed).toBe(true);
    expect(merged.quizzes['m01:checkpoint'].score).toBe(9);
  });

  it('takes a pass from the other side', () => {
    const merged = mergeProgress(
      doc({ quizzes: { 'm01:checkpoint': { score: 5, total: 10, passed: false, at, answers: {} } } }),
      doc({ quizzes: { 'm01:checkpoint': { score: 8, total: 10, passed: true, at, answers: {} } } }),
    );
    expect(merged.quizzes['m01:checkpoint']).toMatchObject({ score: 8, passed: true });
  });

  it('keeps a passed project', () => {
    const merged = mergeProgress(doc({ projects: { 'mario-more': { passed: true, at } } }), doc({ projects: { 'mario-more': { passed: false, at } } }));
    expect(merged.projects['mario-more'].passed).toBe(true);
  });

  it('does not mutate either input', () => {
    const a = doc({ cards: { l1: [0] } });
    const b = doc({ cards: { l1: [1] } });
    const before = JSON.stringify([a, b]);
    mergeProgress(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('summarise', () => {
  it('counts lessons, passed exercises and passed checkpoints', () => {
    const p = doc({
      lessons: { a: { completedAt: at }, b: { completedAt: at } },
      exercises: { x: ex({ passed: true }), y: ex({ passed: false }) },
      quizzes: {
        'm01:checkpoint': { score: 9, total: 10, passed: true, at, answers: {} },
        'm02:checkpoint': { score: 4, total: 10, passed: false, at, answers: {} },
        'm01:retrieval': { score: 3, total: 3, passed: true, at, answers: {} },
      },
    });
    const s = summarise(p);
    expect(s).toMatchObject({ lessons: 2, exercisesPassed: 1, modulesPassed: ['m01'] });
  });
});

describe('daysSinceExport', () => {
  it('is null before the first export', () => {
    expect(daysSinceExport(doc())).toBeNull();
  });

  it('counts whole days', () => {
    const p = doc({ lastExportedAt: '2026-01-01T00:00:00.000Z' });
    expect(daysSinceExport(p, Date.parse('2026-01-01T12:00:00.000Z'))).toBe(0);
    expect(daysSinceExport(p, Date.parse('2026-01-09T00:00:00.000Z'))).toBe(8);
  });
});

describe('exerciseProgress', () => {
  it('returns an empty record for exercises the learner has not touched', () => {
    expect(exerciseProgress(doc(), 'nope')).toMatchObject({ attempts: 0, passed: false, solutionViewed: false, mastered: false, hintsViewed: 0 });
  });
});

describe('update', () => {
  it('keeps the same state object when the updater changes nothing', () => {
    // Components re-render on every new state object; an effect that "ensures" a value would loop forever
    // (React error 185) if a no-op update still produced a new object.
    const before = getProgress();
    update(p => { p.lessons['already-there'] ??= { completedAt: at }; });
    const afterFirst = getProgress();
    expect(afterFirst).not.toBe(before);
    update(p => { p.lessons['already-there'] ??= { completedAt: at }; });
    expect(getProgress()).toBe(afterFirst);
    markCard('lesson-x', 2);
    const afterCard = getProgress();
    markCard('lesson-x', 2);
    expect(getProgress()).toBe(afterCard);
  });
});
