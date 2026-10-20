import { describe, expect, it, vi } from 'vitest';
import { emptyProgress, type ProgressV1 } from './store';

// A fixture course, so the order of steps is tested without depending on the real content:
// m01 (with a retrieval quiz) and m02 are built; m03 is listed but not built.
vi.mock('../content-runtime/course', () => {
  const mod = (id: string, lessons: Array<[string, string, number]>, project: string) => ({
    dir: id,
    meta: { id, project, coreExercises: [], lessons: lessons.map(l => l[0]) },
    lessons: lessons.map(([stem, title, minutes]) => ({ stem, frontmatter: { id: `${id}-${stem}`, title, minutes } })),
  });
  return {
    course: {
      modules: [
        { id: 'm01', number: 1, title: 'One' },
        { id: 'm02', number: 2, title: 'Two' },
        { id: 'm03', number: 3, title: 'Three' },
      ],
    },
    modules: {
      m01: mod('m01', [['a', 'Alpha', 30], ['b', 'Beta', 45]], 'proj1'),
      m02: mod('m02', [['a', 'Gamma', 20]], 'proj2'),
    },
    quizFor: (id: string, name: string) => (id === 'm01' && name === 'retrieval' ? [{ id: 'q' }] : []),
  };
});

import { moduleLabel, nextStep } from './next';

const at = '2026-01-01T00:00:00.000Z';
const doc = (patch: Partial<ProgressV1> = {}): ProgressV1 => ({ ...emptyProgress(), seed: '0123456789abcdef', createdAt: at, ...patch });
const quiz = (passed: boolean) => ({ score: 1, total: 1, passed, at, answers: {} });
const lessonsDone = (...ids: string[]) => Object.fromEntries(ids.map(id => [id, { completedAt: at }]));

describe('nextStep', () => {
  it('sends a new learner to the warm-up of the first module', () => {
    expect(nextStep(doc())).toMatchObject({ kind: 'warmup', moduleId: 'm01', to: '/m/m01/retrieval', verb: 'Start the warm-up' });
  });

  it('opens the first lesson that is not done, and says where it sits', () => {
    const p = doc({ quizzes: { 'm01:retrieval': quiz(true) } });
    expect(nextStep(p)).toMatchObject({ kind: 'lesson', title: 'Alpha', where: 'Module 1 · Lesson 1 of 2 · 30 min', to: '/m/m01/a', verb: 'Start' });
    const p2 = doc({ quizzes: { 'm01:retrieval': quiz(true) }, lessons: lessonsDone('m01-a') });
    expect(nextStep(p2)).toMatchObject({ kind: 'lesson', title: 'Beta', where: 'Module 1 · Lesson 2 of 2 · 45 min', to: '/m/m01/b', verb: 'Continue' });
  });

  it('says Continue for a lesson that is begun but not finished', () => {
    const p = doc({ quizzes: { 'm01:retrieval': quiz(true) }, cards: { 'm01-a': [0, 1] } });
    expect(nextStep(p)).toMatchObject({ kind: 'lesson', title: 'Alpha', verb: 'Continue' });
  });

  it('goes to the project, then the checkpoint, once every lesson is done', () => {
    const base = { quizzes: { 'm01:retrieval': quiz(true) }, lessons: lessonsDone('m01-a', 'm01-b') };
    expect(nextStep(doc(base))).toMatchObject({ kind: 'project', to: '/m/m01/project' });
    expect(nextStep(doc({ ...base, projects: { proj1: { passed: true, at } } }))).toMatchObject({ kind: 'checkpoint', to: '/m/m01/checkpoint' });
  });

  it('moves on to the next module when one is complete', () => {
    const p = doc({
      quizzes: { 'm01:retrieval': quiz(true), 'm01:checkpoint': quiz(true) },
      lessons: lessonsDone('m01-a', 'm01-b'),
      projects: { proj1: { passed: true, at } },
    });
    expect(nextStep(p)).toMatchObject({ kind: 'lesson', moduleId: 'm02', title: 'Gamma', where: 'Module 2 · Lesson 1 of 1 · 20 min' });
  });

  it('is done when every built module is complete, and does not point at the unbuilt one', () => {
    const p = doc({
      quizzes: { 'm01:retrieval': quiz(true), 'm01:checkpoint': quiz(true), 'm02:checkpoint': quiz(true) },
      lessons: lessonsDone('m01-a', 'm01-b', 'm02-a'),
      projects: { proj1: { passed: true, at }, proj2: { passed: true, at } },
    });
    expect(nextStep(p)).toMatchObject({ kind: 'done', moduleId: null, to: null });
  });
});

describe('moduleLabel', () => {
  it('names a module by number and the capstone by name', () => {
    expect(moduleLabel({ id: 'm05', dir: 'x', number: 5, title: 'T', hours: 1, available: true })).toBe('Module 5');
    expect(moduleLabel({ id: 'cap', dir: 'x', number: 'cap', title: 'T', hours: 1, available: false })).toBe('Capstone');
  });
});
