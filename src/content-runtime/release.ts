// Which modules the app opens. A module is open when content/course.yaml says `available: true`. A module that is on disk
// but not released (a draft being built) stays out of the app, so nothing half-built reaches a learner; `?preview=m03`
// opens it for review and e2e. Pure functions, so tests can feed them a fake manifest (the Vite globs are in course.ts).
import type { CourseModuleEntry, ExerciseMeta, LessonFrontmatter, ModuleMeta } from '../content-model/types';

type ManifestEntry = Pick<CourseModuleEntry, 'id' | 'dir' | 'available'>;

/** Glob keys look like /content/modules/<dir>/…: the module directory is the fourth segment. */
export const dirOf = (path: string): string => path.split('/')[3];

/**
 * The modules `?preview=m03,m04` opens: only ids that course.yaml lists as unreleased and that have a folder. A released
 * id, an unknown id and an id with no folder are ignored, so a preview link that outlives the release does nothing.
 */
export function previewedModules(search: string, manifest: readonly ManifestEntry[], dirsOnDisk: ReadonlySet<string>): string[] {
  const asked = (new URLSearchParams(search).get('preview') ?? '').split(',');
  return manifest.filter(e => !e.available && dirsOnDisk.has(e.dir) && asked.includes(e.id)).map(e => e.id);
}

/** What the registry reads from a module.yaml; the app passes the whole `ModuleMeta`. */
type RegistryMeta = Pick<ModuleMeta, 'id' | 'lessons'>;

export interface ModuleEntry<M extends RegistryMeta = ModuleMeta> {
  dir: string;
  meta: M;
  lessons: Array<{ stem: string; frontmatter: LessonFrontmatter }>;
}

/**
 * The modules the app knows, by id. Gating, "up next", the map and every page look modules up here, so a module that is
 * not in this record is not openable, not unlocked and not counted. A draft is skipped before its lessons are read, so a
 * half-built one cannot make the app throw while it loads (a previewed one still does, which is what a reviewer wants).
 */
export function buildRegistry<M extends RegistryMeta>(
  manifest: readonly ManifestEntry[],
  metas: Record<string, M>,
  lessonFrontmatter: Record<string, LessonFrontmatter>,
  previewed: readonly string[] = [],
): Record<string, ModuleEntry<M>> {
  const out: Record<string, ModuleEntry<M>> = {};
  for (const [path, meta] of Object.entries(metas)) {
    const entry = manifest.find(e => e.id === meta.id);
    if (!entry || !(entry.available || previewed.includes(entry.id))) continue;
    const dir = dirOf(path);
    const lessons = meta.lessons.map(stem => {
      const fm = lessonFrontmatter[`/content/modules/${dir}/lessons/${stem}.mdx`];
      if (!fm) throw new Error(`module ${meta.id}: lesson "${stem}" not found`);
      return { stem, frontmatter: fm };
    });
    out[meta.id] = { dir, meta, lessons };
  }
  return out;
}

export interface ExerciseEntry<E = ExerciseMeta> {
  id: string;
  moduleId: string;
  /** Folder (relative to the module) e.g. "exercises/hello-its-me" or "exercises/cash/variants/2". */
  folder: string;
  meta: E;
}

/**
 * Exercises by key, for the modules in `registry` only, so an unreleased module's exercises are not indexed unless it is
 * previewed. The key is the folder name without the module, so two modules that use one name would replace each other
 * (even in a preview, which opens the draft); lint reports it as `duplicate-exercise`.
 */
export function indexExercises<E>(metas: Record<string, E>, registry: Record<string, ModuleEntry<RegistryMeta>>): Record<string, ExerciseEntry<E>> {
  const out: Record<string, ExerciseEntry<E>> = {};
  for (const [path, meta] of Object.entries(metas)) {
    const dir = dirOf(path);
    const moduleId = Object.values(registry).find(m => m.dir === dir)?.meta.id;
    if (!moduleId) continue;
    const folder = path.split('/').slice(4, -1).join('/');
    // Variants are addressed as "<exercise>/variants/<n>"; projects as "project/<id>".
    const key = folder.replace(/^exercises\//, '');
    out[key] = { id: key, moduleId, folder, meta };
  }
  return out;
}
