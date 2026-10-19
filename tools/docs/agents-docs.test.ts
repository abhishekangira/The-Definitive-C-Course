// The agent notes layout (docs/adr/0001-agent-docs-layout.md): a short root AGENTS.md that lists every other
// AGENTS.md, no CLAUDE.md (at the root it stops Claude Code from reading any AGENTS.md), and every skill visible to
// Claude Code.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The root file is loaded into every session; past this, move notes to the area they are about. */
const MAX_ROOT_WORDS = 3200;
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-tools', 'build', '.cache', 'test-results', 'playwright-report']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name), out); }
    else out.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/'));
  }
  return out;
}

const files = walk(ROOT);
const root = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

describe('agent notes', () => {
  it('finds the notes (guard against walking the wrong folder)', () => {
    expect(files).toContain('AGENTS.md');
    expect(files).toContain('src/AGENTS.md');
  });

  it('has no CLAUDE.md or CLAUDE.local.md', () => {
    const hits = files.filter(f => /(^|\/)CLAUDE(\.local)?\.md$/.test(f)).map(f =>
      `${f}: not allowed (at the root it stops Claude Code from reading any AGENTS.md). Put shared notes in an AGENTS.md and personal ones in ~/.claude/CLAUDE.md`);
    expect(hits).toEqual([]);
  });

  it(`keeps the root AGENTS.md under ${MAX_ROOT_WORDS} words`, () => {
    const words = root.split(/\s+/).filter(Boolean).length;
    expect(words, `AGENTS.md has ${words} words: move notes that concern one area to that area's AGENTS.md or README.md`)
      .toBeLessThanOrEqual(MAX_ROOT_WORDS);
  });

  it('lists every other AGENTS.md in the root file', () => {
    const missing = files.filter(f => f.endsWith('/AGENTS.md') && !root.includes(`\`${f}\``)).map(f =>
      `${f}: add it to "Where to find what" in AGENTS.md (tools that do not load nested files only find it there)`);
    expect(missing).toEqual([]);
  });

  it('names only notes that exist', () => {
    const named = [...root.matchAll(/`([\w.-]+(?:\/[\w.-]+)+\.md)`/g)].map(m => m[1]);
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter(f => !existsSync(path.join(ROOT, f)))).toEqual([]);
  });

  it('links every skill from .claude/skills', () => {
    const skills = readdirSync(path.join(ROOT, '.agents/skills'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    expect(skills).toContain('add-exercise');
    const bad = skills.filter(name => {
      const link = path.join(ROOT, '.claude/skills', name);
      return !existsSync(link) || !lstatSync(link).isSymbolicLink()
        || realpathSync(link) !== realpathSync(path.join(ROOT, '.agents/skills', name));
    }).map(name => `.claude/skills/${name}: missing; run ln -s ../../.agents/skills/${name} .claude/skills/${name}`);
    expect(bad).toEqual([]);
  });
});
