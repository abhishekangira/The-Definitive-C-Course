// Issue #26: the shipped check.mjs reads English compiler text (severity words, ASCII quotes), so the compiler and `make` must
// run with LC_ALL=C whatever the learner's locale is, while the learner's own program keeps the learner's environment.
// A wrapper compiler records the LC_ALL it was started with, so no translated message catalogue needs to be installed.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NativeBackend, type Compiler } from './src/native-backend';

const hasGcc = spawnSync('gcc', ['--version']).status === 0;
const LEARNER_LOCALE = 'de_DE.UTF-8';

let tmp: string;
let dir: string;
let record: string;
let compiler: Compiler;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'check-locale-'));
  dir = path.join(tmp, 'project');
  record = path.join(tmp, 'seen-lc-all.txt');
  const wrapper = path.join(tmp, 'cc-wrapper');
  writeFileSync(wrapper, '#!/bin/sh\nprintf "%s\\n" "$LC_ALL" >> "$LOCALE_RECORD"\nexec gcc "$@"\n');
  chmodSync(wrapper, 0o755);
  compiler = { cc: wrapper, version: 'gcc (wrapper)', kind: 'gcc', apple: false };
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  for (const k of ['LC_ALL', 'LANGUAGE', 'LOCALE_RECORD']) saved[k] = process.env[k];
  process.env.LC_ALL = LEARNER_LOCALE;
  process.env.LANGUAGE = 'de';
  process.env.LOCALE_RECORD = record;
  rmSync(record, { force: true });
  rmSync(dir, { recursive: true, force: true });
  spawnSync('mkdir', ['-p', dir]);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const seen = () => readFileSync(record, 'utf8').split('\n').filter(Boolean);

describe.skipIf(!hasGcc)('check.mjs in a learner locale other than C', () => {
  it('compiles with LC_ALL=C, and parses the English warning it prints', async () => {
    const backend = new NativeBackend(compiler, { dir, noSanitizers: true });
    try {
      const src = '#include <stdio.h>\nint main(void) { int unused; puts("hi"); return 0; }\n';
      const out = await backend.compile({ 'main.c': src }, ['main.c'], { purpose: 'program' });
      expect(seen()).toEqual(['C']);
      expect(out.ok).toBe(true);
      expect(out.diagnostics.map(d => d.severity)).toContain('warning');
    } finally { backend.dispose(); }
  });

  it('probes sanitizer support with LC_ALL=C too', () => {
    const backend = new NativeBackend(compiler, { dir });
    try {
      backend.capabilities();
      expect(seen().length).toBeGreaterThan(0);
      expect(new Set(seen())).toEqual(new Set(['C']));
    } finally { backend.dispose(); }
  });

  it('runs make (which runs the compiler) with LC_ALL=C', async () => {
    writeFileSync(path.join(dir, 'Makefile'), 'show:\n\t@echo "LC_ALL=$$LC_ALL"\n');
    const backend = new NativeBackend(compiler, { dir, noSanitizers: true });
    try {
      const r = await backend.make('show', { timeoutMs: 10_000 });
      expect(r.output).toContain('LC_ALL=C');
    } finally { backend.dispose(); }
  });

  it("leaves the learner's program with the learner's own environment", async () => {
    const backend = new NativeBackend(compiler, { dir, noSanitizers: true });
    try {
      const src = '#include <stdio.h>\n#include <stdlib.h>\nint main(void) { const char *v = getenv("LC_ALL"); puts(v ? v : "(unset)"); return 0; }\n';
      const out = await backend.compile({ 'main.c': src }, ['main.c'], { purpose: 'program' });
      expect(out.ok).toBe(true);
      const run = await backend.run(out.artifact!, { timeoutMs: 10_000 });
      expect(run.stdout.trim()).toBe(LEARNER_LOCALE);
    } finally { backend.dispose(); }
  });
});
