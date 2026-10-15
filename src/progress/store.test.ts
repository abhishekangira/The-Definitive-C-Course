import { describe, expect, it } from 'vitest';
import { daysSinceExport, emptyProgress, exerciseProgress, mergeProgress, migrate, summarise, type ExerciseProgress, type ProgressV1 } from './store';

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
