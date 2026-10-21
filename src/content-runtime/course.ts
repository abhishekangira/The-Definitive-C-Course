// Loads course content (content/**) and generated data (src/generated/**) through Vite globs.
// Text and metadata are eager (small); lesson components, sample results and traces are lazy.
import type { ComponentType } from 'react';
import type {
  CourseManifest, ExerciseMeta, LessonFrontmatter, ModuleMeta, SamplesFile, TestsSpec, TraceFile, VideoEntry,
} from '../content-model/types';
import courseYaml from '../../content/course.yaml';
import videosJson from '../../videos.json';
import { previewed } from './preview';
import { buildRegistry, indexExercises, type ModuleEntry } from './release';

export type { ExerciseEntry, ModuleEntry } from './release';
export { previewed };

export const course = courseYaml as CourseManifest;
export const videos = videosJson as VideoEntry[];

const moduleMetas = import.meta.glob<ModuleMeta>('/content/modules/*/module.yaml', { eager: true, import: 'default' });
const lessonFrontmatter = import.meta.glob<LessonFrontmatter>('/content/modules/*/lessons/*.mdx', { eager: true, query: '?frontmatter', import: 'default' });
const lessonComponents = import.meta.glob<{ default: ComponentType<{ components?: Record<string, unknown> }> }>('/content/modules/*/lessons/*.mdx');
const projectPages = import.meta.glob<{ default: ComponentType<{ components?: Record<string, unknown> }> }>('/content/modules/*/project/*/project.mdx');
const exerciseMetas = import.meta.glob<ExerciseMeta>(['/content/modules/*/exercises/**/exercise.yaml', '/content/modules/*/project/*/exercise.yaml'], { eager: true, import: 'default' });
// Project reference solutions (project/*/solution/) are never bundled.
const exerciseFiles = import.meta.glob<string>(['/content/modules/*/{exercises,project}/**/*.{c,h,json,txt,md,mk}', '!**/project/*/solution/**'], { query: '?raw', import: 'default' });
const makefiles = import.meta.glob<string>(['/content/modules/*/project/**/Makefile', '!**/project/*/solution/**'], { query: '?raw', import: 'default' });
const quizFiles = import.meta.glob<QuizItem[]>('/content/modules/*/quizzes/*.yaml', { eager: true, import: 'default' });
const sampleFiles = import.meta.glob<SamplesFile>('/src/generated/samples/*.json', { import: 'default' });
const traceFiles = import.meta.glob<TraceFile>('/src/generated/traces/*.json', { import: 'default' });

export interface QuizItem {
  id: string;
  type: 'predict' | 'outcome' | 'choice' | 'ce' | 'md' | 'sp' | 'exercise' | 'np' | 'order';
  prompt: string;
  code?: string;
  meta?: string;
  choices?: string[];
  /** Index into choices, for conceptual items that have no code to run. */
  answer?: number;
  exercise?: string;
  transfer?: boolean;
  explain?: string;
  /** Module the item comes from (retrieval quizzes); "js" for the JS diagnostic. */
  from?: string;
  /** Extra data for typed items (e.g. ce: sample id; order: items). */
  sample?: string;
  items?: string[];
  /** md items: the line the diagram pauses before. */
  line?: number;
}

/** Folder files that are learner-provided support code (headers, harness helpers), not tests or solutions. */
export const isSupportFile = (path: string) => /\.(c|h)$/.test(path) && !/^(starter|solution)(\.c$|\/)/.test(path) && !path.startsWith('tests/');

/** The modules the app opens: the released ones, plus any `?preview=` names (release.ts). */
export const modules = buildRegistry(course.modules, moduleMetas, lessonFrontmatter, previewed);

export function moduleById(id: string): ModuleEntry | undefined { return modules[id]; }

export function lessonLoader(moduleId: string, stem: string) {
  const m = modules[moduleId];
  return m ? lessonComponents[`/content/modules/${m.dir}/lessons/${stem}.mdx`] : undefined;
}

export function projectLoader(moduleId: string) {
  const m = modules[moduleId];
  return m ? projectPages[`/content/modules/${m.dir}/project/${m.meta.project}/project.mdx`] : undefined;
}

export const exercises = indexExercises(exerciseMetas, modules);

/** Loads all raw files of an exercise/project folder: { "starter.c": "...", "tests.json": "..." }. */
export async function folderFiles(moduleId: string, folder: string): Promise<Record<string, string>> {
  const m = modules[moduleId];
  if (!m) return {};
  const prefix = `/content/modules/${m.dir}/${folder}/`;
  const out: Record<string, string> = {};
  const loaders = { ...exerciseFiles, ...makefiles };
  await Promise.all(
    Object.entries(loaders)
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).startsWith('variants/'))
      .map(async ([p, load]) => { out[p.slice(prefix.length)] = await load(); }),
  );
  return out;
}

export async function testsFor(moduleId: string, folder: string): Promise<TestsSpec | null> {
  const files = await folderFiles(moduleId, folder);
  const text = files['tests.json'] ?? files['check.json'];
  return text ? (JSON.parse(text) as TestsSpec) : null;
}

/** The starter text for a learner file: "starter.c" (exercises) or "starter/<file>" (projects). */
export function starterOf(files: Record<string, string>, fileName: string): string {
  return files['starter.c'] ?? files[`starter/${fileName}`] ?? '';
}

export function quizFor(moduleId: string, name: 'retrieval' | 'checkpoint'): QuizItem[] {
  const m = modules[moduleId];
  if (!m) return [];
  return quizFiles[`/content/modules/${m.dir}/quizzes/${name}.yaml`] ?? [];
}

const sampleCache = new Map<string, Promise<SamplesFile | null>>();
export function samplesFor(moduleId: string): Promise<SamplesFile | null> {
  if (!sampleCache.has(moduleId)) {
    const load = sampleFiles[`/src/generated/samples/${moduleId}.json`];
    sampleCache.set(moduleId, load ? load() : Promise.resolve(null));
  }
  return sampleCache.get(moduleId)!;
}

export async function traceFor(sampleId: string): Promise<TraceFile | null> {
  const load = traceFiles[`/src/generated/traces/${sampleId}.json`];
  return load ? load() : null;
}

export function videoByKey(key: string): VideoEntry | undefined { return videos.find(v => v.key === key); }

/** Every course.yaml entry in order, with its registry entry when the app opens that module. */
export function orderedModules(): Array<{ entry: CourseManifest['modules'][number]; module?: ModuleEntry }> {
  return course.modules.map(entry => ({ entry, module: modules[entry.id] }));
}
