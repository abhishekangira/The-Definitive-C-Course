import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { SessionResult, SessionsFile, SessionStepResult } from '../../src/content-model/types';
import { runSteps, spawnExec } from '../dod/run';
import { buildSteps } from '../dod/steps';
import { checkMacosSessions, macosSessionsSkip, missingMacosRuns } from './macos-sessions';

const tmp = mkdtempSync(path.join(tmpdir(), 'macos-sessions-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dodContent = path.join(ROOT, 'tools', 'dod', 'fixtures', 'content');

const step = { cmd: '$CC $CFLAGS -c main.c', stdout: '', stderr: '', exit: 0 } satisfies SessionStepResult;
const session = (id: string, platforms: SessionResult['platforms'], mac: boolean): SessionResult => ({
  id, dir: `sessions/${id}`, hash: 'h', platforms, sources: {},
  runs: { 'linux-gcc': [step], ...(platforms.includes('linux-clang') ? { 'linux-clang': [step] } : {}), ...(mac ? { macos: [step] } : {}) },
});

let n = 0;
/** A generated root holding src/generated/sessions/m90.json with these sessions (m90 is the plain dod fixture module). */
function generated(...sessions: SessionResult[]): string {
  const root = path.join(tmp, `gen${n++}`);
  mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const file = { module: 'm90', generatedBy: 'test', sessions: Object.fromEntries(sessions.map(s => [s.id, s])) } satisfies SessionsFile;
  writeFileSync(path.join(root, 'sessions', 'm90.json'), JSON.stringify(file));
  return root;
}
const all = ['linux-gcc', 'linux-clang', 'macos'] as const;

describe('macos-sessions', () => {
  it('(a) fails and names each session that lists macos but has no macOS run', () => {
    const root = generated(session('asan', [...all], true), session('lldb', ['linux-clang', 'macos'], false), session('link-order', [...all], false));
    const r = checkMacosSessions(root, 'm90');
    expect(r.status).toBe('fail');
    expect(r.message).toContain('link-order (sessions/link-order)');
    expect(r.message).toContain('lldb (sessions/lldb)');
    expect(r.message).not.toContain('asan');
    expect(r.message).toContain('Rerun the Targets workflow on main, or read its warning');
  });

  it('(b) passes when every session with macOS steps has its run', () => {
    const r = checkMacosSessions(generated(session('asan', [...all], true), session('ubsan', [...all], true)), 'm90');
    expect(r).toEqual({ status: 'pass', message: 'm90: all 2 session(s) with macOS steps have a stored macOS run' });
  });

  it('(c) passes for a session without macOS steps (gcc-only gdb)', () => {
    const root = generated(session('gdb', ['linux-gcc'], false));
    expect(missingMacosRuns({ module: 'm90', generatedBy: 't', sessions: { gdb: session('gdb', ['linux-gcc'], false) } })).toEqual([]);
    expect(checkMacosSessions(root, 'm90').status).toBe('pass');
  });

  it('(d) is a skip with a reason when the module has no sessions file', () => {
    const empty = path.join(tmp, 'none');
    expect(checkMacosSessions(empty, 'm90')).toEqual({ status: 'skip', message: 'no sessions: no src/generated/sessions/m90.json' });
    const row = buildSteps({ module: 'm90', contentRoot: dodContent, generatedRoot: empty }).find(s => s.id === 'macos-sessions');
    expect(row).toMatchObject({ skip: 'no sessions: no src/generated/sessions/m90.json', command: [] });
    expect(macosSessionsSkip(generated(), 'm90')).toBeUndefined();
  });

  it('fails with a clear message, not a stack trace, on a malformed sessions file', () => {
    const bad = (text: string) => {
      const root = path.join(tmp, `bad${n++}`);
      mkdirSync(path.join(root, 'sessions'), { recursive: true });
      writeFileSync(path.join(root, 'sessions', 'm90.json'), text);
      return checkMacosSessions(root, 'm90');
    };
    const broken = bad('{"module": "m90", "sessions": {');
    expect(broken.status).toBe('fail');
    expect(broken.message).toMatch(/^src\/generated\/sessions\/m90\.json is not valid JSON \(.+\); regenerate it with npm run verify$/);
    for (const text of ['null', '{"module":"m90"}', '{"sessions":{"x":{"id":"x"}}}']) {
      expect(bad(text)).toEqual({ status: 'fail', message: 'src/generated/sessions/m90.json is not a sessions file (each session needs `platforms` and `runs`); regenerate it with npm run verify' });
    }
  });

  it('as the real dod row: FAIL naming the session, PASS once the run is there', async () => {
    const exec = spawnExec(ROOT);
    const row = (root: string) => buildSteps({ module: 'm90', contentRoot: dodContent, generatedRoot: root }).filter(s => s.id === 'macos-sessions');
    const [bad] = (await runSteps(row(generated(session('lldb', ['linux-clang', 'macos'], false))), exec, { module: 'm90', fast: true })).steps;
    expect(bad.status).toBe('FAIL');
    expect(bad.tail?.join('\n')).toContain('lldb (sessions/lldb)');
    const [good] = (await runSteps(row(generated(session('lldb', ['linux-clang', 'macos'], true))), exec, { module: 'm90', fast: true })).steps;
    expect(good.status).toBe('PASS');
  }, 60_000);
});
