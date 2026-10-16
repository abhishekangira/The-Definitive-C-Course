// The downloadable project zip (PLAN §4.2): one layout for the app (built client-side, with the
// learner's seed in .learner) and for CI (tools/check/build.mjs --zip, the reference implementation).
// Isomorphic: fflate works in browsers and Node. The layout is documented in tools/check/README.md.
//
//   <id>/
//     README.md      the project's README (or one generated from the title)
//     Makefile       the project's Makefile (or a generated GNU Make 3.81-safe one)
//     check.json     the tests (TestsSpec)
//     check.mjs      the zero-dependency runner
//     learnc.h       the course helper header
//     .learner       learner seed + exercise id (only when a seed is supplied)
//     tests/…        unit-test harnesses and data
//     *.c, *.h       starter files (from starter/ for projects, starter.c for LT exercises)
import { zipSync, strToU8, type Zippable } from 'fflate';
import type { TestsSpec } from '../content-model/types';
import { assertTestsSpec } from './spec';
import { LEARNER_FILE, normaliseExerciseId, serializeLearnerFile, type LearnerFile } from './token';

export interface ProjectZipInput {
  /** Folder name inside the zip, e.g. "caesar". */
  id: string;
  title?: string;
  /** Markdown task description; used by the generated README when the files have none. */
  prompt?: string;
  /** Written as check.json. */
  spec: TestsSpec;
  /** Learner-facing files relative to the project root: starter sources, tests/…, README.md, Makefile, data. */
  files: Record<string, string | Uint8Array>;
  /** The bundled runner (dist-tools/check.mjs). */
  checkMjs: string;
  /** src/runtime/c/learnc.h */
  learncH: string;
  learner?: LearnerFile;
}

/** Fixed timestamp so the same input always gives byte-identical zips. */
export const ZIP_MTIME = new Date('2026-01-01T00:00:00Z');

/** Executable name: spec.binary when given (an optional check.json field), else sources[0] without ".c". */
export function binaryName(spec: TestsSpec): string {
  const b = (spec as { binary?: unknown }).binary;
  return typeof b === 'string' && b ? b : spec.sources[0].replace(/^.*[\\/]/, '').replace(/\.c$/, '');
}

/** A Makefile that works with GNU Make 3.81 (macOS) and newer: no `!=`, `::=`, .ONESHELL or $(file). */
export function defaultMakefile(spec: TestsSpec, title?: string): string {
  const bin = binaryName(spec);
  return [
    `# Makefile${title ? ` for ${title}` : ''} (The Definitive C Course). Works with GNU Make 3.81 and newer.`,
    '#',
    `#   make          build ./${bin}`,
    '#   make test     run the checks (node check.mjs) and print your progress code',
    '#   make hint     show the next hint for the first failing check',
    '#   make clean    delete what make built',
    '',
    'CC ?= cc',
    'CFLAGS = -std=c17 -Wall -Wextra -pedantic -g -O0',
    'LDLIBS = -lm',
    `BIN = ${bin}`,
    `SRCS = ${spec.sources.join(' ')}`,
    '',
    '$(BIN): $(SRCS) $(wildcard *.h)',
    '\t$(CC) $(CFLAGS) -o $(BIN) $(SRCS) $(LDLIBS)',
    '',
    'test:',
    '\tnode check.mjs --cc "$(CC)"',
    '',
    'hint:',
    '\tnode check.mjs --cc "$(CC)" --hint',
    '',
    'clean:',
    '\trm -f $(BIN)',
    '',
    '.PHONY: test hint clean',
    '',
  ].join('\n');
}

export function defaultReadme(id: string, title?: string, prompt?: string): string {
  return [
    `# ${title ?? id}`,
    '',
    ...(prompt?.trim() ? [prompt.trim(), ''] : []),
    'This folder was downloaded from The Definitive C Course.',
    '',
    '- `make` builds the program with the course\'s strict flags.',
    '- `make test` runs the checks (`node check.mjs`). It prints a **progress code** each time; paste it',
    '  into the course. When every check passes it prints a **completion token** instead.',
    '- `make hint` shows the next hint for the first failing check.',
    '',
    'You need a C compiler, make and Node.js 18 or newer (Module 3 shows how to install them).',
    '',
  ].join('\n');
}

function safePath(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
  // Reject absolute paths, drive letters, empty/"."/".." segments and control characters: the app never builds such names.
  if (!norm || /^[a-zA-Z]:|[\u0000-\u001f]/.test(norm) || norm.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) throw new Error(`unsafe path in project: ${JSON.stringify(p)}`);
  return norm;
}

/** Every file of the project folder (paths relative to the folder), in the layout above. */
export function projectZipEntries(input: ProjectZipInput): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};
  for (const [p, data] of Object.entries(input.files)) out[safePath(p)] = data;
  out['check.json'] = JSON.stringify(input.spec, null, 2) + '\n';
  out['check.mjs'] = input.checkMjs;
  out['README.md'] ??= defaultReadme(input.id, input.title, input.prompt);
  out['Makefile'] ??= defaultMakefile(input.spec, input.title);
  out['learnc.h'] ??= input.learncH;
  if (input.learner) out[LEARNER_FILE] = serializeLearnerFile(input.learner);
  return out;
}

/** The zip itself: one top-level folder named after the id, deterministic bytes. */
export function buildProjectZip(input: ProjectZipInput): Uint8Array {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(input.id) || input.id.includes('..')) throw new Error(`unsafe folder name for the zip: ${JSON.stringify(input.id)}`);
  const entries = projectZipEntries(input);
  const tree: Zippable = {};
  for (const p of Object.keys(entries).sort()) {
    const data = entries[p];
    const bytes = typeof data === 'string' ? strToU8(data) : data;
    const mode = p === 'check.mjs' ? 0o100755 : 0o100644;
    // os 3 = Unix, so unzip restores the file modes (check.mjs is executable).
    tree[`${input.id}/${p}`] = [bytes, { mtime: ZIP_MTIME, os: 3, attrs: (mode << 16) >>> 0 }];
  }
  return zipSync(tree, { level: 6 });
}

// ---------------------------------------------------------------- from a content folder

/**
 * Files of a content folder that exist for authors, or that the zip regenerates: never copied.
 * (check.json is written from the parsed spec; tests.json is the same spec under its exercise name.)
 */
const AUTHORING_ONLY = /^(exercise\.yaml|project\.mdx|tests\.json|check\.json|variants\/|solution\/|solution\.c$|starter\/|starter\.c$)/;

export interface FolderLayoutOptions {
  /** The learner's file for single-file exercises (spec.sources[0]); starter.c becomes this file. */
  learnerFile: string;
  /** Which code to ship: the starter (learners get this) or the reference solution (CI only). Default: starter. */
  code?: 'starter' | 'solution';
}

/**
 * Maps the files of a content folder (paths relative to it) to the learner-facing project files.
 *
 *   project layout   starter/x.c  -> x.c      (a folder with a starter/ directory; solution/ never ships)
 *   exercise layout  starter.c    -> <learnerFile>
 *
 * Everything else (Makefile, README.md, tests/…, headers) is copied as it is; authoring files
 * (exercise.yaml, project.mdx, tests.json, check.json, variants/, the other of starter/solution) are not.
 * The app calls this with the files it loaded for the exercise; tools/check/src/project-files.ts calls
 * it with the folder on disk, so learners and CI get the same layout.
 */
export function folderToProjectFiles<T extends string | Uint8Array>(folder: Record<string, T>, opts: FolderLayoutOptions): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [p, data] of Object.entries(folder)) if (!AUTHORING_ONLY.test(p)) out[p] = data;
  const code = opts.code ?? 'starter';
  const prefix = `${code}/`;
  const inDir = Object.keys(folder).filter(p => p.startsWith(prefix));
  if (inDir.length) {
    for (const p of inDir) out[p.slice(prefix.length)] = folder[p];
  } else if (`${code}.c` in folder) {
    out[opts.learnerFile] = folder[`${code}.c`];
  } else {
    throw new Error(`the exercise folder has neither a ${code}/ directory nor a ${code}.c file`);
  }
  return out;
}

/**
 * Folder name inside the zip for an exercise id: "project/mario-more" -> "mario-more",
 * "cash/variants/1" -> "cash-v1", "hello-world" -> "hello-world".
 */
export function zipFolderName(exerciseId: string): string {
  return normaliseExerciseId(exerciseId.replace(/^project\//, '').replace(/\/variants\//, '-v').replace(/\//g, '-')).replace(/[^a-z0-9_-]/g, '-');
}

export interface FolderZipInput {
  /** The exercise id as the app knows it ("project/mario-more"); recorded in .learner and in every code. */
  exerciseId: string;
  title?: string;
  /** The exercise's prompt (markdown), for the generated README. */
  prompt?: string;
  /** The content folder's files, path -> text (as the app loads them). Needs tests.json or check.json. */
  folder: Record<string, string>;
  /** The learner's seed (16 hex digits). */
  seed: string;
  /** The bundled runner: public/downloads/check.mjs. */
  checkMjs: string;
  /** src/runtime/c/learnc.h */
  learncH: string;
  code?: 'starter' | 'solution';
}

/**
 * The whole download in one call, for the app's "Download project" button:
 * `buildZipFromFolder({ exerciseId: entry.id, title: entry.meta.title, prompt: entry.meta.prompt, folder: files, seed, checkMjs, learncH })`.
 * Throws a readable error when the folder's tests file is missing or malformed.
 */
export function buildZipFromFolder(o: FolderZipInput): Uint8Array {
  const specText = o.folder['check.json'] ?? o.folder['tests.json'];
  if (specText === undefined) throw new Error(`${o.exerciseId}: the exercise folder has no tests.json or check.json`);
  let parsed: unknown;
  try { parsed = JSON.parse(specText); } catch (e) { throw new Error(`${o.exerciseId}: the tests file is not valid JSON: ${(e as Error).message}`); }
  const spec = assertTestsSpec(parsed);
  return buildProjectZip({
    id: zipFolderName(o.exerciseId),
    title: o.title,
    prompt: o.prompt,
    spec,
    files: folderToProjectFiles(o.folder, { learnerFile: spec.sources[0], code: o.code }),
    checkMjs: o.checkMjs,
    learncH: o.learncH,
    learner: { version: 1, seed: o.seed, exercise: o.exerciseId, title: o.title },
  });
}
