// Reference project-zip builder (CI). The app builds the same zip client-side from the same
// src/testing/project-zip.ts; this entry is bundled to dist-tools/zip.mjs by tools/check/build.mjs:
//
//   node tools/check/build.mjs --zip <project-exercise-or-variant-dir> --out <file.zip> [--solution] [--seed HEX]
import { readFileSync, writeFileSync } from 'node:fs';
import { buildProjectZip, projectZipEntries, zipFolderName, type ProjectZipInput } from '../../../src/testing/project-zip';
import { normaliseSeed, type LearnerFile } from '../../../src/testing/token';
import { readProjectSource } from './project-files';

export interface ZipOptions {
  dir: string;
  out: string;
  /** Ship the reference solution instead of the starter (CI only; solutions are never published). */
  solution?: boolean;
  /** Learner seed for .learner (the app uses the learner's own; CI uses a fixed one). */
  seed?: string;
  checkMjsPath: string;
  learncPath: string;
}

export function zipInput(o: Omit<ZipOptions, 'out'>): ProjectZipInput {
  const src = readProjectSource(o.dir, { variant: o.solution ? 'solution' : 'starter' });
  let learner: LearnerFile | undefined;
  if (o.seed !== undefined) {
    const seed = normaliseSeed(o.seed);
    if (!seed) throw new Error(`--seed must be 16 hex digits, got ${JSON.stringify(o.seed)}`);
    learner = { version: 1, seed, exercise: src.id, title: src.title };
  }
  return {
    id: zipFolderName(src.id), title: src.title, prompt: src.prompt, spec: src.spec, files: src.files, learner,
    checkMjs: readFileSync(o.checkMjsPath, 'utf8'), learncH: readFileSync(o.learncPath, 'utf8'),
  };
}

/** Writes the zip and returns the list of files in it. */
export function zipProject(o: ZipOptions): string[] {
  const input = zipInput(o);
  writeFileSync(o.out, buildProjectZip(input));
  return Object.keys(projectZipEntries(input)).sort().map(p => `${input.id}/${p}`);
}

/** The project folder as it would be unzipped (for running check.mjs on it). */
export function projectEntries(o: Omit<ZipOptions, 'out'>): { id: string; entries: Record<string, string | Uint8Array> } {
  const input = zipInput(o);
  return { id: input.id, entries: projectZipEntries(input) };
}
