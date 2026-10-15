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
import { LEARNER_FILE, serializeLearnerFile, type LearnerFile } from './token';

export interface ProjectZipInput {
  /** Folder name inside the zip, e.g. "caesar". */
  id: string;
  title?: string;
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

export function defaultReadme(id: string, title?: string): string {
  return [
    `# ${title ?? id}`,
    '',
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
  if (!norm || norm.startsWith('/') || norm.split('/').includes('..')) throw new Error(`unsafe path in project: ${JSON.stringify(p)}`);
  return norm;
}

/** Every file of the project folder (paths relative to the folder), in the layout above. */
export function projectZipEntries(input: ProjectZipInput): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};
  for (const [p, data] of Object.entries(input.files)) out[safePath(p)] = data;
  out['check.json'] = JSON.stringify(input.spec, null, 2) + '\n';
  out['check.mjs'] = input.checkMjs;
  out['README.md'] ??= defaultReadme(input.id, input.title);
  out['Makefile'] ??= defaultMakefile(input.spec, input.title);
  out['learnc.h'] ??= input.learncH;
  if (input.learner) out[LEARNER_FILE] = serializeLearnerFile(input.learner);
  return out;
}

/** The zip itself: one top-level folder named after the id, deterministic bytes. */
export function buildProjectZip(input: ProjectZipInput): Uint8Array {
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
