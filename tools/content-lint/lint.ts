// npm run lint:content: the whole run, without any printing (cli.ts prints). See README.md for the rules.
//
// Layout it expects (the same as the app and the other tools; every path is relative to the content root's
// parent, so test fixtures are small "sites" with their own content/, videos.json and public/):
//   <site>/content/course.yaml
//   <site>/content/modules/<mNN-name>/{module.yaml, lessons/*.mdx, exercises/<id>/exercise.yaml, quizzes/*.yaml, project/<id>/}
//   <site>/videos.json   <site>/public/animations/<id>/steps.json   <site>/animations/<id>/
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CourseManifest, VideoEntry } from '../../src/content-model/types';
import { moduleIdOf, type ExerciseInfo, type ModuleCtx, type SiteCtx } from './context';
import { checkLesson, checkModuleVideos, loadLesson, type LessonStats, type LoadedLesson } from './lesson';
import { Collector, sortMessages, type LintMessage } from './messages';
import { checkCourse, checkModule, loadModuleYaml } from './module';
import { checkQuiz, loadQuiz, type QuizDoc } from './quiz';

export interface LintOptions {
  /** The directory that contains modules/ and course.yaml (default in the CLI: <repo>/content). */
  contentRoot: string;
  videosFile?: string;
  publicRoot?: string;
  animationsRoot?: string;
  /** Only report this module (id "m01" or directory name). Cross-module checks still look at everything. */
  module?: string;
}

export interface LintResult {
  messages: LintMessage[];
  errors: number;
  warnings: number;
  /** Notes, mostly what a draft (unreleased) module is still missing. They never fail a run. */
  infos: number;
  stats: { modules: number; lessons: number; cards: number; quizItems: number; samples: number };
  /** Per lesson: card count and the prose words of each card (for --stats). */
  lessons: Array<LessonStats & { file: string; module: string; minutes?: number }>;
  site: SiteCtx;
}

const subdirs = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter(n => !n.startsWith('.') && statSync(path.join(dir, n)).isDirectory()).sort() : []);
const files = (dir: string, re: RegExp) => (existsSync(dir) ? readdirSync(dir).filter(n => re.test(n) && statSync(path.join(dir, n)).isFile()).sort() : []);

function readYamlValue(file: string): unknown {
  try { return parseYaml(readFileSync(file, 'utf8')) ?? null; } catch { return null; }
}

/** Every exercise, variant and project folder of a module, keyed the way lessons and quizzes refer to them. */
function indexExercises(mod: ModuleCtx): Map<string, ExerciseInfo> {
  const out = new Map<string, ExerciseInfo>();
  const add = (id: string, dir: string) => {
    const file = path.join(dir, 'exercise.yaml');
    if (!existsSync(file)) return;
    const v = readYamlValue(file) as { kind?: unknown; variants?: unknown } | null;
    out.set(id, {
      id,
      dir,
      file,
      kind: typeof v?.kind === 'string' ? v.kind : undefined,
      variants: Array.isArray(v?.variants) ? v!.variants.map(String) : [],
    });
  };
  for (const id of subdirs(path.join(mod.dir, 'exercises'))) {
    const dir = path.join(mod.dir, 'exercises', id);
    add(id, dir);
    for (const n of subdirs(path.join(dir, 'variants'))) add(`${id}/variants/${n}`, path.join(dir, 'variants', n));
  }
  for (const id of subdirs(path.join(mod.dir, 'project'))) add(`project/${id}`, path.join(mod.dir, 'project', id));
  return out;
}

function loadVideos(site: SiteCtx, rep: Collector): void {
  if (!existsSync(site.videosFile)) return;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(site.videosFile, 'utf8'));
  } catch (e) {
    rep.at(site.videosFile).error(1, 'videos-json', `videos.json is not valid JSON: ${(e as Error).message}`);
    return;
  }
  if (!Array.isArray(data)) {
    rep.at(site.videosFile).error(1, 'videos-json', 'videos.json must be an array of entries (run npm run videos:check)');
    return;
  }
  // Only the keys matter here; the full schema is checked by tools/videos/check.ts.
  site.videos = new Map(data.filter((v): v is VideoEntry => !!v && typeof (v as VideoEntry).key === 'string').map(v => [v.key, v]));
}

function loadCourse(site: SiteCtx): void {
  const file = path.join(site.contentRoot, 'course.yaml');
  if (!existsSync(file)) return;
  const v = readYamlValue(file) as CourseManifest | null;
  if (v && typeof v === 'object' && Array.isArray(v.modules)) site.course = v;
}

export function lintContent(o: LintOptions): LintResult {
  const rep = new Collector();
  const contentRoot = path.resolve(o.contentRoot);
  const siteRoot = path.dirname(contentRoot);
  const site: SiteCtx = {
    contentRoot,
    siteRoot,
    publicRoot: path.resolve(o.publicRoot ?? path.join(siteRoot, 'public')),
    animationsRoot: path.resolve(o.animationsRoot ?? path.join(siteRoot, 'animations')),
    videosFile: path.resolve(o.videosFile ?? path.join(siteRoot, 'videos.json')),
    videos: null,
    course: null,
    modules: [],
    lessonIds: new Map(),
  };
  loadVideos(site, rep);
  loadCourse(site);
  // A module course.yaml does not release is a draft: what it is still missing is a note, not an error (see FileReporter.gap).
  for (const e of site.course?.modules ?? []) if (e.available === false) rep.drafts.add(e.id);

  const modulesDir = path.join(contentRoot, 'modules');
  if (!existsSync(modulesDir)) {
    rep.at(modulesDir).error(0, 'content-root', `no modules/ directory under ${contentRoot}`);
  }
  for (const name of subdirs(modulesDir)) {
    const id = moduleIdOf(name);
    if (!id) {
      rep.at(path.join(modulesDir, name)).error(0, 'module-dir', 'module directory must start with mNN- (or cap-)');
      continue;
    }
    const mod: ModuleCtx = {
      id, name, dir: path.join(modulesDir, name),
      lessonStems: files(path.join(modulesDir, name, 'lessons'), /\.mdx$/).map(f => f.replace(/\.mdx$/, '')),
      exercises: new Map(), samples: new Map(), videosUsed: new Map(), exerciseRefs: new Set(),
    };
    mod.exercises = indexExercises(mod);
    site.modules.push(mod);
  }

  // Phase 1: read everything, so that references can be resolved against complete module contents.
  interface Loaded { mod: ModuleCtx; moduleYaml: ReturnType<typeof loadModuleYaml>; lessons: Map<string, LoadedLesson>; quizzes: QuizDoc[] }
  const loaded: Loaded[] = site.modules.map(mod => {
    const moduleYaml = loadModuleYaml(mod, rep);
    const lessons = new Map<string, LoadedLesson>();
    for (const stem of mod.lessonStems) lessons.set(stem, loadLesson(path.join(mod.dir, 'lessons', `${stem}.mdx`), mod, rep));
    const quizzes: QuizDoc[] = [];
    const quizDir = path.join(mod.dir, 'quizzes');
    for (const f of files(quizDir, /\.ya?ml$/)) {
      const kind = f === 'checkpoint.yaml' ? 'checkpoint' : f === 'retrieval.yaml' ? 'retrieval' : null;
      if (!kind) {
        rep.at(path.join(quizDir, f), mod.id).warn(1, 'quiz-file', `unexpected quiz file: the app reads only quizzes/checkpoint.yaml and quizzes/retrieval.yaml`);
        continue;
      }
      quizzes.push(loadQuiz(path.join(quizDir, f), kind, mod, rep));
    }
    return { mod, moduleYaml, lessons, quizzes };
  });

  // Sample ids name generated files, so they are unique across the whole course (tools/verify checks the same).
  const firstSeen = new Map<string, { file: string; line: number }>();
  for (const { mod } of loaded) {
    for (const [id, list] of mod.samples) {
      for (const s of list) {
        const prev = firstSeen.get(id);
        if (prev && !(prev.file === s.file && prev.line === s.line)) {
          rep.at(s.file, mod.id).error(s.line, 'duplicate-sample', `duplicate sample id "${id}" (also at ${path.relative(siteRoot, prev.file)}:${prev.line}): ids name generated files and must be unique`);
        } else if (!prev) firstSeen.set(id, { file: s.file, line: s.line });
      }
    }
  }

  // Exercise ids are global too: the app keys an exercise by its folder name without the module (src/content-runtime/release.ts),
  // so a second module with the same name would replace the first one's exercise. This applies to drafts as well.
  const exerciseOwner = new Map<string, ModuleCtx>();
  for (const { mod } of loaded) {
    for (const ex of mod.exercises.values()) {
      if (ex.id.includes('/variants/')) continue; // a variant collides only when its exercise does
      const first = exerciseOwner.get(ex.id);
      if (!first) exerciseOwner.set(ex.id, mod);
      else if (first.id !== mod.id) {
        rep.at(ex.file, mod.id).error(1, 'duplicate-exercise', `duplicate exercise id "${ex.id}" (also in ${first.name}): the app keys exercises by folder name across all modules, so one would replace the other; give this folder a name no other module uses (new modules prefix theirs, for example ${mod.id}-gdb-hunt)`);
      }
    }
  }

  // Phase 2: the rules.
  let cardCount = 0;
  let quizItems = 0;
  const lessonStats: LintResult['lessons'] = [];
  for (const { mod, moduleYaml, lessons, quizzes } of loaded) {
    for (const lesson of lessons.values()) {
      const st = checkLesson(lesson, mod, site, rep);
      cardCount += st.cards;
      const minutes = lesson.frontmatter?.minutes;
      lessonStats.push({ ...st, file: lesson.file, module: mod.id, minutes: typeof minutes === 'number' ? minutes : undefined });
    }
    checkModuleVideos(mod, rep);
    const seenIds = new Map<string, { file: string; line: number }>();
    for (const q of quizzes) { checkQuiz(q, mod, site, rep, seenIds); quizItems += q.items.length; }
    checkModule(mod, moduleYaml, site, lessons, quizzes.find(q => q.kind === 'retrieval'), rep);
  }
  checkCourse(site, rep);

  const selected = o.module ? site.modules.find(m => m.id === o.module || m.name === o.module) : undefined;
  if (o.module && !selected) rep.at(modulesDir).error(0, 'content-root', `no module "${o.module}" under ${modulesDir}`);
  const messages = sortMessages(rep.messages.filter(m => !o.module || m.module === selected?.id || (m.module === undefined && !selected)));
  const count = (severity: LintMessage['severity']) => messages.filter(m => m.severity === severity).length;
  const errors = count('error');
  return {
    messages,
    errors,
    warnings: count('warning'),
    infos: count('info'),
    stats: {
      modules: site.modules.length,
      lessons: loaded.reduce((n, l) => n + l.lessons.size, 0),
      cards: cardCount,
      quizItems,
      samples: [...firstSeen.keys()].length,
    },
    lessons: lessonStats,
    site,
  };
}
