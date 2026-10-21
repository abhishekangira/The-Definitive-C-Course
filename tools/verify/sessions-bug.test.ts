// `bug: <file>:<line>` in session.yaml (session.ts, sessions-file.ts): the line a report question grades against. Checked
// on tools/verify's stored output for the m97 fixture sessions, so the oracle is the session.yaml key, not this test.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionsFile } from '../../src/content-model/types';
import { discoverSessions } from './session';
import { bugProblems } from './sessions-file';

const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
const specs = discoverSessions(path.join(process.cwd(), 'tools/verify/fixtures/content'), 'm97');

describe('session.yaml bug', () => {
  it('is read from session.yaml, and only the sessions a report question uses have one', () => {
    expect(specs.errors).toEqual([]);
    expect(specs.sessions.filter(s => s.bug).map(s => `${s.id} ${s.bug!.file}:${s.bug!.line}`)).toEqual(['asan main.c:5', 'compile-error main.c:5', 'ubsan main.c:6', 'valgrind-leak l.c:4']);
  });

  it('holds on every stored Linux report, and the bug line has no comment', () => {
    for (const spec of specs.sessions.filter(s => s.bug)) expect(bugProblems(spec, m97.sessions[spec.id].sources, m97.sessions[spec.id].runs), spec.id).toEqual([]);
  });

  it('names each Linux platform whose report points elsewhere', () => {
    const s = m97.sessions.asan;
    expect(bugProblems({ bug: { file: 'main.c', line: 6 } }, s.sources, s.runs)).toEqual([
      'bug: main.c:6, but the linux-gcc report\'s first frame in your code is main.c:5',
      'bug: main.c:6, but the linux-clang report\'s first frame in your code is main.c:5',
    ]);
  });

  it('rejects a comment on the bug line: the report question would show it as the answer', () => {
    const s = m97.sessions.asan;
    const lines = s.sources['main.c'].split('\n');
    lines[4] += ' /* i == 4 writes past the end */';
    expect(bugProblems({ bug: { file: 'main.c', line: 5 } }, { 'main.c': lines.join('\n') }, s.runs)[0]).toContain('bug: main.c:5 has a comment');
  });
});
