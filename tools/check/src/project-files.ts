// Reads a content folder into the learner-facing project layout (src/testing/project-zip.ts):
//   - a project:      content/modules/<m>/project/<id>/  (README.md, Makefile, check.json, tests/, starter/, solution/)
//   - an LT exercise: content/modules/<m>/exercises/<id>/ (exercise.yaml, tests.json, starter.c, solution.c, tests/)
// Used by `build.mjs --zip` (the reference zip) and by tools/exercises (which runs check.mjs on the
// starter and on the solution). Node only. The layout rules themselves live in src/testing/project-zip.ts
// (folderToProjectFiles), the same function the app uses, so learners and CI get the same files.
//
// A variant (exercises/<id>/variants/<n>/) is a folder of its own with its own exercise.yaml, tests.json
// and files, exactly as the app loads it: point this at the variant folder to zip or check a variant.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ExerciseMeta, TestsSpec } from '../../../src/content-model/types';
import { folderToProjectFiles } from '../../../src/testing/project-zip';
import { assertTestsSpec } from '../../../src/testing/spec';

export interface ProjectSource {
  kind: 'project' | 'exercise';
  /** The exercise id the app uses (exercise.yaml's id, e.g. "project/mario-more", "cash/variants/1"). */
  id: string;
  title?: string;
  /** exercise.yaml's prompt, when there is one. */
  prompt?: string;
  spec: TestsSpec;
  /** Learner-facing files, relative to the project root. */
  files: Record<string, string>;
  /** The learner's file(s) that `variant` filled in (starter or solution). */
  learnerFiles: string[];
}

export interface ReadOptions {
  /** Which code to ship: the starter (what learners get) or the reference solution (for CI). */
  variant?: 'starter' | 'solution';
}

/** Files that are never copied: editor/OS junk. */
const NEVER_COPY = /(^|\/)(\.DS_Store|Thumbs\.db|\.git|node_modules)(\/|$)/;

/** Every file under `dir` (relative paths, forward slashes), skipping `exclude`d top-level entries. */
export function listFiles(dir: string, exclude: string[] = []): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      if ((!rel && exclude.includes(name)) || NEVER_COPY.test(r)) continue;
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk('');
  return out.sort();
}

const read = (p: string) => readFileSync(p, 'utf8');

function readmeTitle(text: string | undefined): string | undefined {
  return text ? /^#\s+(.+)$/m.exec(text)?.[1].trim() : undefined;
}

/** A folder with check.json and a starter/ directory (the layout of a module's project/<id>/ folder). */
export function isProjectFolder(dir: string): boolean {
  return existsSync(path.join(dir, 'check.json')) && existsSync(path.join(dir, 'starter'));
}

export function isExerciseFolder(dir: string): boolean {
  return existsSync(path.join(dir, 'exercise.yaml'));
}

/** Reads a project, exercise or variant folder (see the header comment). */
export function readProjectSource(dir: string, opts: ReadOptions = {}): ProjectSource {
  const code = opts.variant ?? 'starter';
  const project = isProjectFolder(dir);
  if (!project && !isExerciseFolder(dir)) {
    throw new Error(`${dir} is neither a project folder (check.json + starter/) nor an exercise folder (exercise.yaml)`);
  }
  const folder: Record<string, string> = {};
  for (const f of listFiles(dir, ['variants'])) folder[f] = read(path.join(dir, f));

  const specText = folder['check.json'] ?? folder['tests.json'];
  if (specText === undefined) throw new Error(`${dir} has no tests.json or check.json`);
  const spec = assertTestsSpec(JSON.parse(specText));
  const meta = folder['exercise.yaml'] ? (parseYaml(folder['exercise.yaml']) as Partial<ExerciseMeta> | null) ?? undefined : undefined;

  const files = folderToProjectFiles(folder, { learnerFile: spec.sources[0], code });
  const prefix = `${code}/`;
  const inDir = Object.keys(folder).filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length));
  const learnerFiles = inDir.length ? inDir : [spec.sources[0]];
  const id = meta?.id ?? (project ? `project/${path.basename(dir)}` : path.basename(dir));
  const title = (spec as { title?: string }).title ?? meta?.title ?? readmeTitle(files['README.md']);
  return { kind: project ? 'project' : 'exercise', id, title, prompt: meta?.prompt, spec, files, learnerFiles };
}

/** Writes a file map (e.g. projectZipEntries output) into a directory. */
export function writeFiles(dir: string, files: Record<string, string | Uint8Array>): void {
  for (const [rel, data] of Object.entries(files)) {
    const p = path.join(dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
}
