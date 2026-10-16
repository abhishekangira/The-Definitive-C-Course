import { describe, expect, it, vi } from 'vitest';
import { emptyProgress, type ExerciseProgress, type ProgressV1 } from './store';

// Fixture course so the rules are tested at their boundaries independent of the real content:
// m01, m02 and m04 are built; m03 is listed in the manifest between them but not built yet.
vi.mock('../content-runtime/course', () => {
  const mod = (id: string, lessons: string[], core: string[], project: string) => ({
    dir: id,
    meta: { id, project, coreExercises: core, lessons },
    lessons: lessons.map(stem => ({ stem, frontmatter: { id: `${id}-${stem}` } })),
  });
  return {
    course: { modules: [{ id: 'm01' }, { id: 'm02' }, { id: 'm03' }, { id: 'm04' }] },
    modules: {
      m01: mod('m01', ['a', 'b'], ['ex1', 'ex2'], 'proj1'),
      m02: mod('m02', ['a'], [], 'proj2'),
      m04: mod('m04', ['a'], [], 'proj4'),
    },
    // m01 has a retrieval quiz; m02 has none.
    quizFor: (id: string, name: string) => (id === 'm01' && name === 'retrieval' ? [{ id: 'q' }] : []),
  };
});

import {
  CHECKPOINT_PASS, isCheckpointUnlocked, isLessonComplete, isMastered, isModuleUnlocked, lessonIdOf, moduleStatus, quizKey, solutionGate,
} from './gating';

const at = '2026-01-01T00:00:00.000Z';
const doc = (patch: Partial<ProgressV1> = {}): ProgressV1 => ({ ...emptyProgress(), seed: '0123456789abcdef', createdAt: at, ...patch });
const ex = (patch: Partial<ExerciseProgress> = {}): ExerciseProgress => ({
  attempts: 0, substantive: 0, activeMs: 0, hintsViewed: 0, passed: false, solutionViewed: false, mastered: false, ...patch,
});
const MIN = 60000;
// `passed` is stored data here (QuizRunner decides it in the app); tests pass it explicitly instead of recomputing the rule.
const checkpoint = (score: number, passed: boolean, total = 10) => ({ score, total, passed, at, answers: {} });

/** A fully complete m01: lessons, retrieval, checkpoint, project, core exercises mastered. */
const completeM01 = (patch: Partial<ProgressV1> = {}): ProgressV1 => doc({
  lessons: { 'm01-a': { completedAt: at }, 'm01-b': { completedAt: at } },
  quizzes: { [quizKey('m01', 'retrieval')]: checkpoint(8, true), [quizKey('m01', 'checkpoint')]: checkpoint(8, true) },
  projects: { proj1: { passed: true, at } },
  exercises: { ex1: ex({ passed: true }), ex2: ex({ passed: true }) },
  ...patch,
});

// The 80% comparison itself lives in QuizRunner.tsx (a component), not in gating.ts, so it is not tested here.
describe('CHECKPOINT_PASS', () => {
  it('is 0.8 (the value QuizRunner compares against)', () => {
    expect(CHECKPOINT_PASS).toBe(0.8);
  });
  it('moduleStatus follows the stored passed flag, not the score', () => {
    expect(moduleStatus(doc({ quizzes: { 'm01:checkpoint': checkpoint(7, false) } }), 'm01').checkpointPassed).toBe(false);
    expect(moduleStatus(doc({ quizzes: { 'm01:checkpoint': checkpoint(8, true) } }), 'm01').checkpointPassed).toBe(true);
  });
});

describe('lesson helpers', () => {
  it('lessonIdOf resolves a stem to the frontmatter id, with a fallback for unknown stems', () => {
    expect(lessonIdOf('m01', 'b')).toBe('m01-b');
    expect(lessonIdOf('m01', 'zzz')).toBe('m01:zzz');
    expect(lessonIdOf('nope', 'a')).toBe('nope:a');
  });
  it('isLessonComplete reads the lessons record', () => {
    expect(isLessonComplete(doc(), 'm01-a')).toBe(false);
    expect(isLessonComplete(doc({ lessons: { 'm01-a': { completedAt: at } } }), 'm01-a')).toBe(true);
  });
});

describe('solutionGate', () => {
  const unlocked = (e: Partial<ExerciseProgress>, variant = false) => solutionGate(ex(e), variant).unlocked;

  it('never unlocks for a variant, even with everything satisfied', () => {
    const g = solutionGate(ex({ hintsViewed: 3, substantive: 5, activeMs: 60 * MIN }), true);
    expect(g.unlocked).toBe(false);
    expect(g.reason).toMatch(/variant/i);
  });

  it('needs all three hints: 2 of 3 is not enough', () => {
    const g = solutionGate(ex({ hintsViewed: 2, substantive: 5, activeMs: 60 * MIN }), false);
    expect(g.unlocked).toBe(false);
    expect(g.reason).toMatch(/hints/i);
  });

  it('with 3 hints, 0 substantive attempts stays locked even with lots of time', () => {
    const g = solutionGate(ex({ hintsViewed: 3, substantive: 0, activeMs: 60 * MIN }), false);
    expect(g.unlocked).toBe(false);
    expect(g.reason).toMatch(/attempt/i);
  });

  it('plain attempts that are not substantive do not count', () => {
    expect(unlocked({ hintsViewed: 3, attempts: 10, substantive: 0, activeMs: 60 * MIN })).toBe(false);
  });

  it('1 substantive attempt with little time is locked; 2 unlocks', () => {
    expect(unlocked({ hintsViewed: 3, substantive: 1, activeMs: 0 })).toBe(false);
    expect(unlocked({ hintsViewed: 3, substantive: 2, activeMs: 0 })).toBe(true);
  });

  it('1 attempt + 20 minutes unlocks, 19 minutes 59 seconds does not', () => {
    expect(unlocked({ hintsViewed: 3, substantive: 1, activeMs: 20 * MIN })).toBe(true);
    expect(unlocked({ hintsViewed: 3, substantive: 1, activeMs: 19 * MIN })).toBe(false);
    expect(unlocked({ hintsViewed: 3, substantive: 1, activeMs: 20 * MIN - 1000 })).toBe(false);
  });

  it('pins the lock-message rounding: the remaining minutes are rounded up', () => {
    const reason = (activeMs: number) => solutionGate(ex({ hintsViewed: 3, substantive: 1, activeMs }), false).reason;
    expect(reason(0)).toContain('20 more minutes');
    expect(reason(15 * MIN)).toContain('5 more minutes'); // exactly 5:00 left
    expect(reason(15 * MIN + 1)).toContain('5 more minutes'); // 4:59.999 left rounds up to 5, not down to 4
    expect(reason(15 * MIN - 1)).toContain('6 more minutes'); // 5:00.001 left rounds up to 6
    expect(reason(19 * MIN)).toContain('1 more minutes');
    expect(reason(20 * MIN - 1)).toContain('1 more minutes'); // 1 ms short still says 1, never 0
  });

  it('more than the minimum stays unlocked', () => {
    expect(unlocked({ hintsViewed: 3, substantive: 9, activeMs: 999 * MIN })).toBe(true);
  });

  it('does not set a reason when unlocked', () => {
    expect(solutionGate(ex({ hintsViewed: 3, substantive: 2 }), false).reason).toBeUndefined();
  });
});

describe('isMastered', () => {
  it('is false for no progress and for an unpassed exercise', () => {
    expect(isMastered(undefined)).toBe(false);
    expect(isMastered(ex())).toBe(false);
  });
  it('passed without viewing the solution is mastered', () => {
    expect(isMastered(ex({ passed: true }))).toBe(true);
  });
  it('passed after viewing the solution is not mastered until the variant is passed', () => {
    expect(isMastered(ex({ passed: true, solutionViewed: true }))).toBe(false);
    expect(isMastered(ex({ passed: true, solutionViewed: true, variant: 'v1' }))).toBe(false);
    expect(isMastered(ex({ passed: true, solutionViewed: true, variant: 'v1', mastered: true }))).toBe(true);
  });
});

describe('moduleStatus', () => {
  it('returns an empty, incomplete status for an unknown module', () => {
    expect(moduleStatus(doc(), 'zzz')).toMatchObject({ lessonsTotal: 0, complete: false, outstandingVariants: [] });
  });

  it('counts completed lessons', () => {
    const s = moduleStatus(doc({ lessons: { 'm01-a': { completedAt: at } } }), 'm01');
    expect(s).toMatchObject({ lessonsDone: 1, lessonsTotal: 2 });
  });

  it('retrieval is done when recorded, or when the module has no retrieval quiz', () => {
    expect(moduleStatus(doc(), 'm01').retrievalDone).toBe(false);
    expect(moduleStatus(doc({ quizzes: { 'm01:retrieval': checkpoint(1, true) } }), 'm01').retrievalDone).toBe(true);
    expect(moduleStatus(doc(), 'm02').retrievalDone).toBe(true);
  });

  describe('outstandingVariants', () => {
    const outstanding = (exercises: Record<string, ExerciseProgress>) => moduleStatus(doc({ exercises }), 'm01').outstandingVariants;

    it('is empty when nothing was viewed', () => {
      expect(outstanding({})).toEqual([]);
    });
    it('lists a core exercise whose solution was viewed and is not mastered', () => {
      expect(outstanding({ ex1: ex({ solutionViewed: true }) })).toEqual(['ex1']);
      expect(outstanding({ ex1: ex({ solutionViewed: true, passed: true }) })).toEqual(['ex1']);
    });
    it('drops it once the assigned variant is passed (viewed then variant-passed)', () => {
      expect(outstanding({ ex1: ex({ solutionViewed: true, passed: true, variant: 'v1', mastered: true }) })).toEqual([]);
    });
    it('keeps core order and ignores exercises that are not core', () => {
      expect(outstanding({ other: ex({ solutionViewed: true }), ex2: ex({ solutionViewed: true }), ex1: ex({ solutionViewed: true }) })).toEqual(['ex1', 'ex2']);
    });
  });

  describe('complete', () => {
    it('is true when checkpoint and project passed and there are no outstanding variants', () => {
      expect(moduleStatus(completeM01(), 'm01').complete).toBe(true);
    });
    it('is false at 7/10 on the checkpoint', () => {
      const p = completeM01({ quizzes: { 'm01:retrieval': checkpoint(8, true), 'm01:checkpoint': checkpoint(7, false) } });
      expect(moduleStatus(p, 'm01').complete).toBe(false);
    });
    it('is false without a passed project', () => {
      expect(moduleStatus(completeM01({ projects: { proj1: { passed: false, at } } }), 'm01').complete).toBe(false);
      expect(moduleStatus(completeM01({ projects: {} }), 'm01').complete).toBe(false);
    });
    it('is false while a variant is outstanding, and true again once it is mastered', () => {
      const blocked = completeM01({ exercises: { ex1: ex({ passed: true, solutionViewed: true }), ex2: ex({ passed: true }) } });
      expect(moduleStatus(blocked, 'm01')).toMatchObject({ complete: false, outstandingVariants: ['ex1'] });
      const cleared = completeM01({ exercises: { ex1: ex({ passed: true, solutionViewed: true, variant: 'v', mastered: true }), ex2: ex({ passed: true }) } });
      expect(moduleStatus(cleared, 'm01').complete).toBe(true);
    });
  });
});

describe('isCheckpointUnlocked', () => {
  const lessons = (...ids: string[]) => Object.fromEntries(ids.map(i => [i, { completedAt: at }]));
  it('needs retrieval done and every lesson complete', () => {
    const retrieval = { 'm01:retrieval': checkpoint(8, true) };
    expect(isCheckpointUnlocked(doc(), 'm01')).toBe(false);
    expect(isCheckpointUnlocked(doc({ quizzes: retrieval, lessons: lessons('m01-a') }), 'm01')).toBe(false);
    expect(isCheckpointUnlocked(doc({ lessons: lessons('m01-a', 'm01-b') }), 'm01')).toBe(false);
    expect(isCheckpointUnlocked(doc({ quizzes: retrieval, lessons: lessons('m01-a', 'm01-b') }), 'm01')).toBe(true);
  });
  it('does not need a retrieval quiz when the module has none', () => {
    expect(isCheckpointUnlocked(doc({ lessons: lessons('m02-a') }), 'm02')).toBe(true);
  });
  it('is locked for an unknown module', () => {
    expect(isCheckpointUnlocked(doc(), 'zzz')).toBe(false);
  });
});

describe('isModuleUnlocked', () => {
  const completeM02 = (patch: Partial<ProgressV1> = {}): ProgressV1 => completeM01({
    lessons: { 'm01-a': { completedAt: at }, 'm01-b': { completedAt: at }, 'm02-a': { completedAt: at } },
    quizzes: { 'm01:retrieval': checkpoint(8, true), 'm01:checkpoint': checkpoint(8, true), 'm02:checkpoint': checkpoint(9, true) },
    projects: { proj1: { passed: true, at }, proj2: { passed: true, at } },
    ...patch,
  });
  it('the first module is always unlocked', () => {
    expect(isModuleUnlocked(doc(), 'm01')).toBe(true);
  });
  it('the second module is locked until the first is complete', () => {
    expect(isModuleUnlocked(doc(), 'm02')).toBe(false);
    expect(isModuleUnlocked(completeM01(), 'm02')).toBe(true);
  });
  it('stays locked for each missing completion requirement of the earlier module', () => {
    expect(isModuleUnlocked(completeM01({ projects: {} }), 'm02')).toBe(false);
    expect(isModuleUnlocked(completeM01({ quizzes: { 'm01:checkpoint': checkpoint(7, false) } }), 'm02')).toBe(false);
    expect(isModuleUnlocked(completeM01({ exercises: { ex1: ex({ passed: true, solutionViewed: true }) } }), 'm02')).toBe(false);
  });
  it('a listed but unbuilt module (m03) is locked even when every built module before it is complete', () => {
    expect(isModuleUnlocked(completeM02(), 'm03')).toBe(false);
  });
  it('a built module behind an unbuilt one (m04 after m03) stays locked even though m01 and m02 are complete', () => {
    expect(isModuleUnlocked(completeM02(), 'm04')).toBe(false);
  });
  it('an unknown module is locked', () => {
    expect(isModuleUnlocked(completeM02(), 'zzz')).toBe(false);
  });
});
