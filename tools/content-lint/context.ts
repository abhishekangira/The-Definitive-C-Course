// Shared state for one lint run: the site (content root, videos.json, course.yaml) and the modules found
// under it, with the samples and exercises each module defines (so references can be resolved).
import type { CourseManifest, VideoEntry } from '../../src/content-model/types';
import type { SampleInfo } from './samples';

export interface ExerciseInfo {
  /** Key as lessons and quizzes write it: "cash", "cash/variants/1", "project/mario-more". */
  id: string;
  dir: string;
  file: string;
  /** `kind` from exercise.yaml (ct, fb, pa, lt), when readable. */
  kind?: string;
  /** Variant folder names listed in exercise.yaml. */
  variants: string[];
}

export interface ModuleCtx {
  /** "m01" (module.yaml `id` is checked against the directory name, which decides this). */
  id: string;
  /** Directory name, "m01-c-in-your-browser". */
  name: string;
  /** Absolute path. */
  dir: string;
  /** Lesson file stems found on disk, sorted. */
  lessonStems: string[];
  exercises: Map<string, ExerciseInfo>;
  /** Every non-fragment sample defined by the module's lessons and quizzes, by id. */
  samples: Map<string, SampleInfo[]>;
  /** Distinct <YouTube video> keys used by the module's lessons, with the first place each is used. */
  videosUsed: Map<string, { file: string; line: number }>;
  /** Exercise ids referenced from lessons and quizzes (to find unused ones). */
  exerciseRefs: Set<string>;
  /** module.yaml as parsed (undefined until loaded, or when missing/invalid). */
  meta?: Record<string, unknown>;
}

export interface SiteCtx {
  contentRoot: string;
  /** The directory that holds content/, videos.json, public/ and animations/ (the contentRoot's parent). */
  siteRoot: string;
  publicRoot: string;
  animationsRoot: string;
  videosFile: string;
  /** null when videos.json is missing or unreadable. */
  videos: Map<string, VideoEntry> | null;
  course: CourseManifest | null;
  modules: ModuleCtx[];
  /** Lesson frontmatter ids seen so far (ids must be unique: progress is keyed by them). */
  lessonIds: Map<string, { file: string; line: number }>;
}

export function moduleIdOf(dir: string): string | null {
  return /^(m\d{2}|cap)(?:-|$)/.exec(dir)?.[1] ?? null;
}

/** "m03" to 3, "cap" to "cap". */
export function moduleNumber(id: string): number | 'cap' {
  return id === 'cap' ? 'cap' : Number(id.slice(1));
}
