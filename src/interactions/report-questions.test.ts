// The report questions graded against tools/verify's output for the m97 fixture sessions
// (tools/verify/fixtures/generated/sessions/m97.json): the expected line is never typed here. Each fixture session.yaml
// names its bug line (`bug: main.c:5`), so the stored report's first user frame must land on that line; a different
// report (another session's, or a library frame) lands elsewhere and fails.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { SessionsFile } from '../content-model/types';
import type { RunSummary } from '../runtime/useCRun';
import { transcriptTabs } from '../components/transcript-tabs';
import { firstUserFrame, fixProblem, fixRunFlags } from './report-questions';

const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
// The oracle: the `bug: <file>:<line>` key in the fixture session's session.yaml, never a comment in the C file.
const bug = (id: string) => {
  const doc = parseYaml(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/content/modules/m97-sessions/sessions', id, 'session.yaml'), 'utf8')) as { bug: string };
  const [file, line] = doc.bug.split(':');
  return { file, line: Number(line) };
};

describe('firstUserFrame', () => {
  for (const id of ['compile-error', 'asan', 'ubsan', 'valgrind-leak']) {
    it(`${id}: the stored report's first user frame is session.yaml's bug line, on every stored platform`, () => {
      const s = m97.sessions[id];
      const { tabs } = transcriptTabs(s, 'last');
      expect(tabs.length).toBeGreaterThan(0);
      for (const t of tabs) {
        const frame = firstUserFrame(t.steps, s.sources);
        expect(frame, `${id} on ${t.platform}`).toBeDefined();
        expect(frame, `${id} on ${t.platform}: ${frame!.file}:${frame!.line}`).toEqual(bug(id));
      }
    });
  }

  it('only counts the session\'s own files: with none, the ASan report (libc frames included) has no user frame', () => {
    const steps = transcriptTabs(m97.sessions.asan, 'last').tabs[0].steps;
    expect(firstUserFrame(steps, {})).toBeUndefined();
  });

  it('does not take another session\'s report: the UBSan report points at a different line of its main.c than ASan\'s', () => {
    const asan = m97.sessions.asan;
    const ubsanSteps = transcriptTabs(m97.sessions.ubsan, 'last').tabs[0].steps;
    const frame = firstUserFrame(ubsanSteps, asan.sources)!;
    expect(frame.line).not.toBe(bug('asan').line);
  });
});

describe('fixProblem', () => {
  const clean = { compile: { ok: true, diagnostics: [], raw: '', ms: 1 }, result: { kind: 'exit', exitCode: 0, ms: 1, wallMs: 1 }, stdout: 'done\n', stderr: '' } satisfies RunSummary;
  it('passes a clean compile that runs to the end', () => { expect(fixProblem(clean)).toBeNull(); });
  it('fails a warning, a UBSan report (the guardrail runtime exits 1), a trap, a leak, or the wrong output', () => {
    expect(fixProblem({ ...clean, compile: { ...clean.compile, diagnostics: [{ file: 'main.c', line: 6, col: 9, severity: 'warning', message: 'x' }] } })).toMatch(/^Still not clean/);
    // The guardrail runtime's report, as ubsan_rt.c prints it (src/runtime/c/ubsan_rt.c, end_and_maybe_die).
    expect(fixProblem({ ...clean, result: { ...clean.result, exitCode: 1 }, stderr: m97.sessions.ubsan.runs['linux-clang']!.at(-1)!.stderr })).toMatch(/^It still stops/);
    expect(fixProblem({ ...clean, result: { ...clean.result, kind: 'trap', exitCode: null } })).toMatch(/^It still stops/);
    expect(fixProblem({ ...clean, result: { ...clean.result, leakcheck: [{ type: 'leak', bytes: 40, file: 'l.c', line: 4 }] } })).toMatch(/^It still leaks/);
    expect(fixProblem(clean, 'something else\n')).toMatch(/output isn't right/);
  });
  it('runs UBSan kinds under the guardrail and heap leaks under leakcheck', () => {
    expect([fixRunFlags('compile'), fixRunFlags('ubsan'), fixRunFlags('leak')]).toEqual([
      { guardrail: false, leakcheck: false }, { guardrail: true, leakcheck: false }, { guardrail: false, leakcheck: true },
    ]);
  });
});
