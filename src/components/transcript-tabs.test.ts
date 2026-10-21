// <Transcript>'s choices (tabs, missing platforms, placeholders), on tools/verify's own output for the m97 fixture
// sessions (tools/verify/fixtures/generated/sessions/m97.json; verify.test.ts regenerates it and fails when it differs).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SessionsFile } from '../content-model/types';
import { placeholderKinds, splitPlaceholders, transcriptTabs } from './transcript-tabs';

const m97 = JSON.parse(readFileSync(new URL('../../tools/verify/fixtures/generated/sessions/m97.json', import.meta.url), 'utf8')) as SessionsFile;
const runs = (id: string) => m97.sessions[id].runs;

describe('transcriptTabs', () => {
  it('shows each stored platform once, with every step, and names the platforms that stored nothing', () => {
    const { tabs, missing } = transcriptTabs(m97.sessions['link-undefined']);
    expect(tabs.map(t => t.platform)).toEqual(['linux-gcc', 'linux-clang']);
    expect(tabs[0].steps).toBe(runs('link-undefined')['linux-gcc']);
    expect(tabs[1].steps).toBe(runs('link-undefined')['linux-clang']);
    // Its steps are three tools (none, ld, nm), so the label is the platform alone.
    expect(tabs.map(t => t.label)).toEqual(['Linux/WSL · gcc 13', 'Linux/WSL · clang 22']);
    // No macOS run is stored in the fixture (Targets writes those), so the transcript must say so.
    expect(missing).toEqual(['macos']);
  });

  it('picks the step-th step of each platform and labels the tab with its tool', () => {
    const { tabs } = transcriptTabs(m97.sessions['link-undefined'], 2);
    expect(tabs.map(t => t.steps)).toEqual([[runs('link-undefined')['linux-gcc']![1]], [runs('link-undefined')['linux-clang']![1]]]);
    expect(tabs.map(t => t.label)).toEqual(['Linux/WSL · gcc 13 · ld', 'Linux/WSL · clang 22 · ld']);
  });

  it('leaves out a platform the session never ran on (gdb is gcc only), and says so', () => {
    const { tabs, missing } = transcriptTabs(m97.sessions.gdb, 2);
    expect(tabs).toEqual([{ platform: 'linux-gcc', label: 'Linux/WSL · gcc 13 · gdb', steps: [runs('gdb')['linux-gcc']![1]] }]);
    expect(missing).toEqual(['linux-clang', 'macos']);
  });

  it('has no tab for a step that no platform stored', () => {
    const n = runs('gdb')['linux-gcc']!.length;
    expect(transcriptTabs(m97.sessions.gdb, n + 1)).toEqual({ tabs: [], missing: ['linux-gcc', 'linux-clang', 'macos'] });
  });
});

describe('placeholders', () => {
  it('marks every placeholder in a stored report and keeps the text as stored', () => {
    const report = runs('asan')['linux-gcc']![0].stderr;
    const parts = splitPlaceholders(report);
    expect(parts.map(p => p.text).join('')).toBe(report);
    const marked = parts.filter(p => p.placeholder).map(p => p.text);
    for (const token of ['<addr1>', '<addr2>', '<dir>', '<id>', '==PID==']) expect(marked).toContain(token);
    expect(parts.find(p => p.text === '==PID==')?.placeholder).toBe('pid');
    // The plain text between them has no placeholder left in it.
    expect(parts.filter(p => !p.placeholder).some(p => /<addr\d+>|<dir>|==PID==/.test(p.text))).toBe(false);
  });

  it('lists the kinds a transcript explains under it', () => {
    expect(placeholderKinds([runs('lldb')['linux-clang']![1]])).toEqual(['addr', 'pid', 'dir']);
    expect(placeholderKinds([runs('libm')['linux-gcc']![0]])).toEqual(['dir', 'tmp']);
    expect(placeholderKinds([runs('make')['linux-gcc']![1]])).toEqual([]);
  });
});
