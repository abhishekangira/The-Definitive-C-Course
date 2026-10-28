// Which stored session steps V7's native panes offer, and which platform the "my machine" setting prefers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionsFile, SessionResult } from '../content-model/types';
import { nativeTabs, preferredSessionPlatform } from './native-panes';

const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;

describe('nativeTabs', () => {
  it('finds each view by its as: label, one tab per stored platform, and macOS as pending', () => {
    const session = m97.sessions.pipeline;
    const asm = nativeTabs(session, 'asm');
    expect(asm.tabs.map(t => [t.platform, t.label])).toEqual([
      ['linux-gcc', 'Linux/WSL · gcc 13'],
      ['linux-clang', 'Linux/WSL · clang 22'],
    ]);
    expect(asm.tabs.map(t => t.step.as)).toEqual(['asm', 'asm']);
    expect(asm.pending).toEqual(['macos']);
    expect(asm.missingView).toEqual([]);
    expect(nativeTabs(session, 'nm').tabs.map(t => t.step.as)).toEqual(['nm', 'nm']);
    expect(nativeTabs(session, 'objdump').tabs.map(t => t.step.as)).toEqual(['objdump', 'objdump']);
  });

  it('says a stored run has no step for a view instead of showing another view', () => {
    const session = {
      id: 'x', dir: 'sessions/x', hash: '0', platforms: ['linux-gcc'], sources: {},
      runs: { 'linux-gcc': [{ cmd: 'cc x.c', stdout: '', stderr: '', exit: 0 }] },
    } satisfies SessionResult;
    const nm = nativeTabs(session, 'nm');
    expect(nm.tabs).toEqual([]);
    expect(nm.missingView).toEqual(['linux-gcc']);
    expect(nm.pending).toEqual([]);
  });
});

describe('preferredSessionPlatform', () => {
  it('maps the learner’s machine to a stored platform, and arm64 Linux to none', () => {
    expect(preferredSessionPlatform('mac-arm')).toBe('macos');
    expect(preferredSessionPlatform('mac-intel')).toBe('macos');
    expect(preferredSessionPlatform('wsl')).toBe('linux-gcc');
    expect(preferredSessionPlatform('linux-x86')).toBe('linux-gcc');
    expect(preferredSessionPlatform('linux-arm')).toBeNull();
    expect(preferredSessionPlatform(undefined)).toBeNull();
  });
});
