// Finds exercises, their variants and projects under a content root:
//   <root>/modules/<module-dir>/module.yaml
//   <root>/modules/<module-dir>/exercises/<id>/exercise.yaml   (+ variants/<name>/)
//   <root>/modules/<module-dir>/project/<id>/check.json        (+ starter/, solution/, tests/)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RunsIn } from '../../src/content-model/types';

export interface ModuleDir {
  /** "m01" (module.yaml id, or the directory name up to the first "-"). */
  id: string;
  /** Directory name, e.g. "m01-c-in-your-browser". */
  name: string;
  dir: string;
  /** From module.yaml; decides whether projects are also verified with the browser toolchain. */
  projectRunsIn?: RunsIn;
}

export interface ExerciseDir { module: ModuleDir; id: string; dir: string }
export interface ProjectDir { module: ModuleDir; id: string; dir: string }

export interface Discovery {
  modules: ModuleDir[];
  exercises: ExerciseDir[];
  projects: ProjectDir[];
}

const subdirs = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter(n => !n.startsWith('.') && statSync(path.join(dir, n)).isDirectory()).sort() : []);

/** `filter` matches a module id ("m01") or directory name; `only` matches an exercise/project id. */
export function discover(contentRoot: string, opts: { module?: string; only?: string } = {}): Discovery {
  const out: Discovery = { modules: [], exercises: [], projects: [] };
  const modulesDir = path.join(contentRoot, 'modules');
  for (const name of subdirs(modulesDir)) {
    const dir = path.join(modulesDir, name);
    let meta: { id?: string; projectRunsIn?: RunsIn } = {};
    const yamlPath = path.join(dir, 'module.yaml');
    if (existsSync(yamlPath)) meta = (parseYaml(readFileSync(yamlPath, 'utf8')) ?? {}) as typeof meta;
    const mod: ModuleDir = { id: meta.id ?? name.split('-')[0], name, dir, projectRunsIn: meta.projectRunsIn };
    if (opts.module && opts.module !== mod.id && opts.module !== name) continue;
    out.modules.push(mod);
    for (const id of subdirs(path.join(dir, 'exercises'))) {
      if (opts.only && opts.only !== id) continue;
      if (existsSync(path.join(dir, 'exercises', id, 'exercise.yaml'))) out.exercises.push({ module: mod, id, dir: path.join(dir, 'exercises', id) });
    }
    for (const id of subdirs(path.join(dir, 'project'))) {
      if (opts.only && opts.only !== id) continue;
      out.projects.push({ module: mod, id, dir: path.join(dir, 'project', id) });
    }
  }
  return out;
}

/** Variant folder names that exist under an exercise. */
export function variantDirs(exerciseDir: string): string[] {
  return subdirs(path.join(exerciseDir, 'variants'));
}
