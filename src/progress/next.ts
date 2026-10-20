// "Up next" on the course map: the one thing to do from here, found from progress alone (the first module that is not
// complete, and the first step of it that is not done). The order is the module page's: warm-up, lessons, project, checkpoint.
import { course, modules, type ModuleEntry } from '../content-runtime/course';
import type { CourseModuleEntry } from '../content-model/types';
import { isLessonComplete, moduleStatus } from './gating';
import type { ProgressV1 } from './store';

export type NextKind = 'warmup' | 'lesson' | 'project' | 'checkpoint' | 'variants' | 'done';

export interface NextStep {
  kind: NextKind;
  moduleId: string | null;
  /** What to do, in the course's words: a lesson title, "Warm-up quiz", "Project". */
  title: string;
  /** Where it sits: "Module 1 · Lesson 3 of 6 · 40 min". */
  where: string;
  /** The route to open, or null when there is nothing left to open. */
  to: string | null;
  /** The label of the button that opens it. */
  verb: string;
}

export const moduleLabel = (entry: CourseModuleEntry): string => (entry.number === 'cap' ? 'Capstone' : `Module ${entry.number}`);

export function nextStep(p: ProgressV1): NextStep {
  for (const entry of course.modules) {
    const m: ModuleEntry | undefined = modules[entry.id];
    if (!m) break; // this and every later module is not built yet
    const st = moduleStatus(p, entry.id);
    if (st.complete) continue;
    const label = moduleLabel(entry);
    const base = `/m/${entry.id}`;
    if (!st.retrievalDone) return { kind: 'warmup', moduleId: entry.id, title: 'Warm-up quiz', where: label, to: `${base}/retrieval`, verb: 'Start the warm-up' };
    const at = m.lessons.findIndex(l => !isLessonComplete(p, l.frontmatter.id));
    if (at >= 0) {
      const l = m.lessons[at];
      const started = st.lessonsDone > 0 || (p.cards[l.frontmatter.id]?.length ?? 0) > 0;
      return {
        kind: 'lesson', moduleId: entry.id, title: l.frontmatter.title,
        where: `${label} · Lesson ${at + 1} of ${m.lessons.length} · ${l.frontmatter.minutes} min`,
        to: `${base}/${l.stem}`, verb: started ? 'Continue' : 'Start',
      };
    }
    if (!st.projectPassed) return { kind: 'project', moduleId: entry.id, title: 'Project', where: label, to: `${base}/project`, verb: 'Open the project' };
    if (!st.checkpointPassed) return { kind: 'checkpoint', moduleId: entry.id, title: 'Checkpoint', where: label, to: `${base}/checkpoint`, verb: 'Take the checkpoint' };
    return { kind: 'variants', moduleId: entry.id, title: 'Practice variants', where: label, to: base, verb: 'See what is left' };
  }
  return { kind: 'done', moduleId: null, title: 'Everything built so far is done', where: 'More modules are on the way', to: null, verb: '' };
}
