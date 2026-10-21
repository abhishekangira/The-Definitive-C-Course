import { describe, expect, it, vi } from 'vitest';
import { emptyProgress, type ProgressV1 } from './store';

// A fixture course, so the order of steps is tested without depending on the real content. The modules go through the app's
// own registry (release.ts): m01 (with a retrieval quiz) and m02 are released; m03 has a folder on disk (a draft) but is not.
vi.mock('../content-runtime/course', async () => {
  const { buildRegistry } = await import('../content-runtime/release');
  const mod = (id: string, lessons: Array<[string, string, number]>, project: string) => ({ id, project, coreExercises: [], lessons: lessons.map(l => l[0]) });
  const lessons: Record<string, Array<[string, string, number]>> = {
    m01: [['a', 'Alpha', 30], ['b', 'Beta', 45]],
    m02: [['a', 'Gamma', 20]],
    m03: [['a', 'Draft lesson', 25]],
  };
  const manifest = [
    { id: 'm01', dir: 'm01', number: 1, title: 'One', available: true },
    { id: 'm02', dir: 'm02', number: 2, title: 'Two', available: true },
    { id: 'm03', dir: 'm03', number: 3, title: 'Three', available: false },
  ];
  const metas = Object.fromEntries(Object.entries(lessons).map(([id, ls]) => [`/content/modules/${id}/module.yaml`, mod(id, ls, `proj${Number(id.slice(1))}`)]));
  const frontmatter = Object.fromEntries(Object.entries(lessons).flatMap(([id, ls]) => ls.map(([stem, title, minutes]) =>
    [`/content/modules/${id}/lessons/${stem}.mdx`, { id: `${id}-${stem}`, title, minutes, summary: '' }])));
  return {
    course: { modules: manifest },
    modules: buildRegistry(manifest, metas, frontmatter),
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

  it('is done when every released module is complete, and does not point at the unreleased one that is on disk', () => {
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
