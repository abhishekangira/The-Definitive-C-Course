// Gating rules (PLAN.md §2.5), as pure functions of progress + content.
import { course, modules, quizFor } from '../content-runtime/course';
import type { ProgressV1, ExerciseProgress } from './store';

export const CHECKPOINT_PASS = 0.8;

export const quizKey = (moduleId: string, kind: 'retrieval' | 'checkpoint') => `${moduleId}:${kind}`;

export function lessonIdOf(moduleId: string, stem: string): string {
  return modules[moduleId]?.lessons.find(l => l.stem === stem)?.frontmatter.id ?? `${moduleId}:${stem}`;
}

export function isLessonComplete(p: ProgressV1, lessonId: string): boolean {
  return Boolean(p.lessons[lessonId]);
}

/** Mastered = passed without viewing the solution, or passed the assigned variant afterwards. */
export function isMastered(e: ExerciseProgress | undefined): boolean {
  return Boolean(e && (e.mastered || (e.passed && !e.solutionViewed)));
}

export interface ModuleStatus {
  retrievalDone: boolean;
  lessonsDone: number;
  lessonsTotal: number;
  checkpointPassed: boolean;
  projectPassed: boolean;
  outstandingVariants: string[];
  complete: boolean;
}

export function moduleStatus(p: ProgressV1, moduleId: string): ModuleStatus {
  const m = modules[moduleId];
  if (!m) return { retrievalDone: false, lessonsDone: 0, lessonsTotal: 0, checkpointPassed: false, projectPassed: false, outstandingVariants: [], complete: false };
  const retrievalDone = quizFor(moduleId, 'retrieval').length === 0 || Boolean(p.quizzes[quizKey(moduleId, 'retrieval')]);
  const lessonsDone = m.lessons.filter(l => isLessonComplete(p, l.frontmatter.id)).length;
  const checkpointPassed = Boolean(p.quizzes[quizKey(moduleId, 'checkpoint')]?.passed);
  const projectPassed = Boolean(p.projects[m.meta.project]?.passed);
  const outstandingVariants = m.meta.coreExercises.filter(id => {
    const e = p.exercises[id];
    return e?.solutionViewed && !isMastered(e);
  });
  return {
    retrievalDone,
    lessonsDone,
    lessonsTotal: m.lessons.length,
    checkpointPassed,
    projectPassed,
    outstandingVariants,
    complete: checkpointPassed && projectPassed && outstandingVariants.length === 0,
  };
}

/** A module is unlocked when every earlier available module is complete. */
export function isModuleUnlocked(p: ProgressV1, moduleId: string): boolean {
  for (const entry of course.modules) {
    if (entry.id === moduleId) return Boolean(modules[moduleId]);
    if (!modules[entry.id]) return false; // an earlier module isn't built yet
    if (!moduleStatus(p, entry.id).complete) return false;
  }
  return false;
}

export function isCheckpointUnlocked(p: ProgressV1, moduleId: string): boolean {
  const s = moduleStatus(p, moduleId);
  return s.retrievalDone && s.lessonsDone === s.lessonsTotal;
}

export interface SolutionGate { unlocked: boolean; reason?: string }

/** Solution unlock (PLAN §2.5): H3 viewed AND (≥2 substantive attempts OR ≥1 attempt + 20 min active). */
export function solutionGate(e: ExerciseProgress, isVariant: boolean): SolutionGate {
  if (isVariant) return { unlocked: false, reason: 'Variants are solved without a solution, so the skill counts as yours.' };
  if (e.hintsViewed < 3) return { unlocked: false, reason: 'Open all three hints first.' };
  const minutes = e.activeMs / 60000;
  if (e.substantive >= 2 || (e.substantive >= 1 && minutes >= 20)) return { unlocked: true };
  if (e.substantive === 0) return { unlocked: false, reason: 'Make a real attempt first: change the code and run the tests.' };
  const left = Math.ceil(20 - minutes);
  return { unlocked: false, reason: `One more changed attempt (or ${left} more ${left === 1 ? 'minute' : 'minutes'} of work) unlocks the solution.` };
}
