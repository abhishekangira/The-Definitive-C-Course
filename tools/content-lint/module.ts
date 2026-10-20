// module.yaml rules (ModuleMeta in src/content-model/types.ts) and the cross-checks with course.yaml.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RunsIn } from '../../src/content-model/types';
import type { ExerciseInfo, ModuleCtx, SiteCtx } from './context';
import { moduleNumber } from './context';
import type { LoadedLesson } from './lesson';
import type { Collector, FileReporter } from './messages';
import type { QuizDoc } from './quiz';
import { YamlFile } from './yaml-file';

export const MAX_RESOURCES = 2;
/** Rounding slack for the +-0.1 h comparisons (10.1 - 10 is 0.0999999999999996, 2.1 - 2 is 0.1000000000000000888). */
const EPS = 1e-9;
const RUNS_IN = new Set<RunsIn>(['browser', 'native', 'both']);
const REQUIRED = ['id', 'number', 'title', 'why', 'hours', 'weeks', 'time', 'lessonsRunIn', 'projectRunsIn', 'successCriteria', 'resources', 'lessons', 'problemSet', 'project', 'coreExercises', 'retrieval'];
const OPTIONAL = new Set<string>();
const TIME_REQUIRED = ['lessons', 'project', 'variants', 'quizCheckpoint'];
const TIME_OPTIONAL = ['problemSet', 'other'];

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function moduleYamlPath(mod: ModuleCtx): string {
  return path.join(mod.dir, 'module.yaml');
}

/** Reads module.yaml into mod.meta. Syntax problems are reported here; field rules are in checkModule. */
export function loadModuleYaml(mod: ModuleCtx, rep: Collector): YamlFile | null {
  const file = moduleYamlPath(mod);
  const r = rep.at(file, mod.id);
  if (!existsSync(file)) {
    r.error(1, 'module-yaml', `${mod.name}/module.yaml is missing`);
    return null;
  }
  const y = YamlFile.read(file);
  if (!y.reportSyntax(r)) return null;
  const v = y.value;
  if (!isObj(v)) {
    r.error(1, 'module-yaml', 'module.yaml must be a YAML mapping');
    return null;
  }
  mod.meta = v;
  return y;
}

function checkExerciseList(mod: ModuleCtx, y: YamlFile, key: 'problemSet' | 'coreExercises', r: FileReporter): void {
  const list = mod.meta?.[key];
  if (!Array.isArray(list)) {
    r.error(y.lineOf([key]), 'module-yaml', `\`${key}\` must be a list of exercise ids`);
    return;
  }
  const seen = new Set<string>();
  list.forEach((id, i) => {
    const at = y.lineOf([key, i]);
    if (!text(id)) { r.error(at, 'module-yaml', `\`${key}\` entries must be exercise ids (strings)`); return; }
    if (seen.has(id)) { r.error(at, 'module-yaml', `"${id}" is listed twice in \`${key}\``); return; }
    seen.add(id);
    mod.exerciseRefs.add(id);
    const ex: ExerciseInfo | undefined = mod.exercises.get(id);
    if (!ex) {
      r.gap(at, 'module-exercise', `${key} lists exercise "${id}", but there is no exercises/${id}/exercise.yaml in ${mod.name}`);
    } else if (key === 'coreExercises' && ex.variants.length === 0) {
      r.gap(at, 'module-exercise', `core exercise "${id}" has no variants: viewing its solution assigns a variant to master (PLAN §2.5)`, 'warning');
    }
  });
}

/** Lesson minutes versus the module's `time.lessons` hours: a rough consistency check. */
function checkLessonTime(mod: ModuleCtx, y: YamlFile, lessons: Map<string, LoadedLesson>, r: FileReporter): void {
  const time = mod.meta?.time;
  const listed = mod.meta?.lessons;
  if (!isObj(time) || !num(time.lessons) || !Array.isArray(listed)) return;
  let minutes = 0;
  for (const stem of listed) {
    const m = lessons.get(String(stem))?.frontmatter?.minutes;
    if (!num(m)) return; // reported by the lesson rules
    minutes += m;
  }
  const hours = minutes / 60;
  if (Math.abs(hours - time.lessons) > 0.75) {
    r.gap(y.lineOf(['time', 'lessons']), 'module-time', `lesson minutes add up to ${hours.toFixed(1)} h but time.lessons is ${time.lessons} h`, 'warning');
  }
}

export function checkModule(mod: ModuleCtx, y: YamlFile | null, site: SiteCtx, lessons: Map<string, LoadedLesson>, retrieval: QuizDoc | undefined, rep: Collector): void {
  const file = moduleYamlPath(mod);
  const r = rep.at(file, mod.id);
  const quizzesDir = path.join(mod.dir, 'quizzes');
  for (const q of ['checkpoint', 'retrieval']) {
    if (!existsSync(path.join(quizzesDir, `${q}.yaml`))) {
      r.gap(1, 'quiz-missing', `${mod.name}/quizzes/${q}.yaml is missing: every module has a retrieval quiz and a checkpoint`);
    }
  }
  if (!y || !mod.meta) return;
  const meta = mod.meta;

  for (const k of REQUIRED) if (!(k in meta)) r.error(1, 'module-yaml', `module.yaml is missing \`${k}\``);
  for (const k of Object.keys(meta)) {
    if (!REQUIRED.includes(k) && !OPTIONAL.has(k)) r.warn(y.lineOf([k]), 'module-yaml', `unknown module.yaml field "${k}"`);
  }

  if ('id' in meta && meta.id !== mod.id) r.error(y.lineOf(['id']), 'module-yaml', `id "${String(meta.id)}" does not match the directory ${mod.name} (expected "${mod.id}")`);
  if ('number' in meta && meta.number !== moduleNumber(mod.id)) r.error(y.lineOf(['number']), 'module-yaml', `number ${JSON.stringify(meta.number)} does not match the directory ${mod.name} (expected ${JSON.stringify(moduleNumber(mod.id))})`);
  for (const k of ['title', 'why']) if (k in meta && !text(meta[k])) r.error(y.lineOf([k]), 'module-yaml', `\`${k}\` must be a non-empty string`);
  for (const k of ['hours', 'weeks']) if (k in meta && (!num(meta[k]) || (meta[k] as number) <= 0)) r.error(y.lineOf([k]), 'module-yaml', `\`${k}\` must be a positive number`);
  for (const k of ['lessonsRunIn', 'projectRunsIn']) {
    if (k in meta && !RUNS_IN.has(meta[k] as RunsIn)) r.error(y.lineOf([k]), 'module-yaml', `\`${k}\` must be browser, native or both`);
  }

  // hours and weeks follow course.yaml's hoursPerWeek
  if (num(meta.hours) && num(meta.weeks) && site.course && num(site.course.hoursPerWeek) && site.course.hoursPerWeek > 0) {
    const expected = meta.hours / site.course.hoursPerWeek;
    if (Math.abs(expected - meta.weeks) > 0.1 + EPS) {
      r.warn(y.lineOf(['weeks']), 'module-time', `weeks is ${meta.weeks} but ${meta.hours} h at ${site.course.hoursPerWeek} h/week is ${expected.toFixed(1)} weeks`);
    }
  }

  // time breakdown
  if ('time' in meta) {
    const t = meta.time;
    if (!isObj(t)) r.error(y.lineOf(['time']), 'module-yaml', '`time` must be a mapping: lessons, problemSet, project, variants, quizCheckpoint');
    else {
      let sum = 0;
      let ok = true;
      for (const k of TIME_REQUIRED) {
        if (!(k in t)) { r.error(y.lineOf(['time']), 'module-yaml', `\`time\` is missing \`${k}\``); ok = false; }
      }
      for (const [k, v] of Object.entries(t)) {
        if (![...TIME_REQUIRED, ...TIME_OPTIONAL].includes(k)) r.warn(y.lineOf(['time', k]), 'module-yaml', `unknown \`time\` field "${k}"`);
        if (!num(v) || v < 0) { r.error(y.lineOf(['time', k]), 'module-yaml', `\`time.${k}\` must be a number of hours (0 or more)`); ok = false; } else sum += v;
      }
      if (ok && num(meta.hours) && Math.abs(sum - meta.hours) > 0.1 + EPS) {
        r.error(y.lineOf(['time']), 'module-time', `the time breakdown adds up to ${sum} h but \`hours\` is ${meta.hours}`);
      }
    }
  }

  // success criteria
  if ('successCriteria' in meta) {
    const sc = meta.successCriteria;
    if (!Array.isArray(sc) || sc.length === 0) r.error(y.lineOf(['successCriteria']), 'module-yaml', '`successCriteria` must be a non-empty list of { sc: SC1, level: I|D|A }');
    else {
      const seen = new Set<string>();
      sc.forEach((e, i) => {
        const at = y.lineOf(['successCriteria', i]);
        if (!isObj(e) || typeof e.sc !== 'string' || !/^SC\d+$/.test(e.sc)) r.error(at, 'module-yaml', 'each success criterion needs `sc: SC<N>`');
        else if (seen.has(e.sc)) r.error(at, 'module-yaml', `${e.sc} is listed twice`);
        else seen.add(e.sc);
        if (isObj(e) && !['I', 'D', 'A'].includes(e.level as string)) r.error(at, 'module-yaml', '`level` must be I (introduced), D (developed) or A (assessed)');
      });
    }
  }

  // outside resources: at most 2, each naming an exact chapter or lecture
  if ('resources' in meta) {
    const res = meta.resources;
    if (!Array.isArray(res)) r.error(y.lineOf(['resources']), 'module-yaml', '`resources` must be a list');
    else {
      if (res.length > MAX_RESOURCES) r.error(y.lineOf(['resources', MAX_RESOURCES]), 'module-resources', `${res.length} outside resources: at most ${MAX_RESOURCES} per module, each naming an exact chapter or lecture`);
      res.forEach((e, i) => {
        const at = y.lineOf(['resources', i]);
        if (!isObj(e) || !text(e.title)) r.error(at, 'module-resources', 'each resource needs a `title`');
        if (!isObj(e) || !text(e.detail)) r.error(at, 'module-resources', 'each resource needs a non-empty `detail` naming the exact chapter, section or lecture to read');
        if (isObj(e) && e.url !== undefined && (typeof e.url !== 'string' || !/^https?:\/\/\S+$/.test(e.url))) r.error(y.lineOf(['resources', i, 'url']), 'module-resources', '`url` must be an http(s) URL');
      });
    }
  }

  // lessons
  if ('lessons' in meta) {
    const list = meta.lessons;
    if (!Array.isArray(list) || list.length === 0) r.error(y.lineOf(['lessons']), 'module-yaml', '`lessons` must be a non-empty list of lesson file names (without .mdx)');
    else {
      const seen = new Set<string>();
      list.forEach((stem, i) => {
        const at = y.lineOf(['lessons', i]);
        if (!text(stem)) { r.error(at, 'module-yaml', 'lesson entries must be file names such as "01-hello-compiled-world"'); return; }
        if (seen.has(stem)) r.error(at, 'module-yaml', `lesson "${stem}" is listed twice`);
        seen.add(stem);
        if (!existsSync(path.join(mod.dir, 'lessons', `${stem}.mdx`))) r.error(at, 'module-lesson', `lesson "${stem}" is listed but ${mod.name}/lessons/${stem}.mdx does not exist`);
      });
      for (const stem of mod.lessonStems) {
        if (!seen.has(stem)) r.warn(y.lineOf(['lessons']), 'module-lesson', `lessons/${stem}.mdx exists but is not listed in \`lessons\`, so learners never see it`);
      }
    }
  }

  if ('problemSet' in meta) checkExerciseList(mod, y, 'problemSet', r);
  if ('coreExercises' in meta) checkExerciseList(mod, y, 'coreExercises', r);

  // project
  if ('project' in meta) {
    const id = meta.project;
    if (!text(id)) r.error(y.lineOf(['project']), 'module-yaml', '`project` must be the id of a folder under project/');
    else {
      const dir = path.join(mod.dir, 'project', id);
      const at = y.lineOf(['project']);
      if (!existsSync(dir)) r.gap(at, 'module-project', `project "${id}": ${mod.name}/project/${id}/ does not exist`);
      else {
        if (!existsSync(path.join(dir, 'check.json'))) r.gap(at, 'module-project', `project "${id}" has no check.json (the tests the runner and the app use)`);
        if (!existsSync(path.join(dir, 'project.mdx'))) r.gap(at, 'module-project', `project "${id}" has no project.mdx (the brief learners read)`);
        if (!existsSync(path.join(dir, 'exercise.yaml'))) r.gap(at, 'module-project', `project "${id}" has no exercise.yaml (the app loads it like an exercise)`);
      }
    }
  }

  // retrieval sources
  if ('retrieval' in meta) {
    const rv = meta.retrieval;
    const sources = isObj(rv) ? rv.sources : undefined;
    const me = moduleNumber(mod.id);
    if (!Array.isArray(sources) || sources.length === 0 || !sources.every(text)) {
      r.error(y.lineOf(['retrieval']), 'module-yaml', '`retrieval.sources` must be a non-empty list of module ids (or [js] for Module 1)');
    } else {
      sources.forEach((s: string, i) => {
        const at = y.lineOf(['retrieval', 'sources', i]);
        if (me === 1 ? s !== 'js' : s === 'js' || !/^m\d{2}$/.test(s) || (typeof me === 'number' && Number(s.slice(1)) >= me)) {
          r.error(at, 'module-yaml', me === 1 ? 'Module 1 has no earlier modules: `retrieval.sources` is [js]' : `retrieval source "${s}" must be an earlier module (m01…)`);
        }
      });
      if (retrieval?.ok) {
        const used = new Set(retrieval.items.map(it => (isObj(it) && typeof it.from === 'string' ? it.from : undefined)).filter((x): x is string => !!x));
        for (const f of used) {
          if (!sources.includes(f)) r.error(y.lineOf(['retrieval', 'sources']), 'module-yaml', `retrieval items come from "${f}", which is not in \`retrieval.sources\``);
        }
        for (const s of sources) {
          if (!used.has(s)) r.warn(y.lineOf(['retrieval', 'sources']), 'module-yaml', `\`retrieval.sources\` lists "${s}" but no retrieval item comes from it`);
        }
      }
    }
  }

  checkLessonTime(mod, y, lessons, r);

  // exercises nothing refers to (a typo in a reference would otherwise leave an orphan behind)
  for (const ex of mod.exercises.values()) {
    if (ex.id.includes('/')) continue; // variants and projects are reached through their parent
    if (!mod.exerciseRefs.has(ex.id)) {
      rep.at(ex.file, mod.id).warn(1, 'exercise-unused', `exercise "${ex.id}" is not used by any lesson, quiz, problem set or core exercise list`);
    }
  }
}

/** content/course.yaml: the module list matches the module directories and their module.yaml. */
export function checkCourse(site: SiteCtx, rep: Collector): void {
  const file = path.join(site.contentRoot, 'course.yaml');
  const r = rep.at(file);
  if (!existsSync(file)) {
    r.error(1, 'course-yaml', 'content/course.yaml is missing');
    return;
  }
  const y = YamlFile.read(file);
  if (!y.reportSyntax(r)) return;
  const v = y.value;
  if (!isObj(v) || !Array.isArray(v.modules)) {
    r.error(1, 'course-yaml', 'course.yaml needs `title`, `hoursPerWeek` and a `modules` list');
    return;
  }
  if (!text(v.title)) r.error(y.lineOf(['title']), 'course-yaml', '`title` is required');
  if (!num(v.hoursPerWeek) || v.hoursPerWeek <= 0) r.error(y.lineOf(['hoursPerWeek']), 'course-yaml', '`hoursPerWeek` must be a positive number');
  const entries = new Map<string, Raw>();
  v.modules.forEach((e, i) => {
    const at = y.lineOf(['modules', i]);
    if (!isObj(e) || !text(e.id) || !text(e.dir) || !text(e.title) || !num(e.hours) || typeof e.available !== 'boolean' || (!num(e.number) && e.number !== 'cap')) {
      r.error(at, 'course-yaml', 'each module entry needs id, dir, number, title, hours and available: true|false');
      return;
    }
    if (entries.has(e.id)) r.error(at, 'course-yaml', `module "${e.id}" is listed twice`);
    entries.set(e.id, { ...e, __line: at });
  });
  const byId = new Map(site.modules.map(m => [m.id, m]));
  for (const [id, e] of entries) {
    const at = e.__line as number;
    const mod = byId.get(id);
    if (e.available === true && !mod) r.error(at, 'course-yaml', `module "${id}" is available: true but ${String(e.dir)}/ does not exist under content/modules/`);
    if (mod) {
      if (mod.name !== e.dir) r.error(at, 'course-yaml', `module "${id}": dir is "${String(e.dir)}" but the directory is "${mod.name}"`);
      if (e.available !== true) r.info(at, 'course-yaml', `module "${id}" is a draft: it exists on disk but course.yaml has available: false, so learners cannot open it`);
      if (e.number !== moduleNumber(id)) r.error(at, 'course-yaml', `module "${id}": number ${JSON.stringify(e.number)} does not match its id`);
      const mh = mod.meta?.hours;
      if (num(mh) && num(e.hours) && mh !== e.hours) r.error(at, 'course-yaml', `module "${id}": hours is ${String(e.hours)} here but ${mh} in module.yaml`);
      const mt = mod.meta?.title;
      if (text(mt) && mt !== e.title) r.warn(at, 'course-yaml', `module "${id}": title differs from module.yaml ("${mt}")`);
    }
  }
  for (const mod of site.modules) {
    if (!entries.has(mod.id)) r.error(1, 'course-yaml', `module directory ${mod.name} is not listed in course.yaml`);
  }
}
