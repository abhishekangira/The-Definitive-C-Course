// The agent notes layout (docs/adr/0001-agent-docs-layout.md): a short root AGENTS.md that lists every other
// AGENTS.md, no CLAUDE.md (at the root it stops Claude Code from reading any AGENTS.md), and every skill visible to
// Claude Code.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/**
 * The root file is loaded into every session. It was 7,115 words before the split and 3,146 after; this is about 10% above
 * that, room for a few bullets. When it trips, move notes that concern one area to that area's AGENTS.md or README.md
 * rather than raising the number.
 */
const MAX_ROOT_WORDS = 3500;
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-tools', 'build', '.cache', 'test-results', 'playwright-report']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // A folder with its own .git (a worktree has a file, a clone a folder) is another checkout, such as
    // .claude/worktrees/<name>: its notes belong to its own branch, not to this one.
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !existsSync(path.join(p, '.git'))) walk(p, out); }
    else out.push(path.relative(ROOT, p).split(path.sep).join('/'));
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

  it('links every skill from .claude/skills, and nothing else is there', () => {
    const skillsDir = path.join(ROOT, '.agents/skills');
    const linksDir = path.join(ROOT, '.claude/skills');
    const skills = readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    expect(skills).toContain('add-exercise');
    // rm first: onto an existing folder or link, a plain ln -s would create the link inside it.
    const relink = (name: string) => `rm -rf .claude/skills/${name} && ln -s ../../.agents/skills/${name} .claude/skills/${name}`;
    const isLinkTo = (link: string, dir: string) =>
      existsSync(link) && lstatSync(link).isSymbolicLink() && realpathSync(link) === realpathSync(dir);
    const unlinked = skills.filter(name => !isLinkTo(path.join(linksDir, name), path.join(skillsDir, name)))
      .map(name => `.claude/skills/${name}: must be a link to .agents/skills/${name}; run ${relink(name)}`);
    const stray = readdirSync(linksDir).filter(name => !name.startsWith('.') && !skills.includes(name))
      .map(name => `.claude/skills/${name}: not a link to a skill in .agents/skills, so other agents cannot see it. A real folder: mv .claude/skills/${name} .agents/skills/${name} && ln -s ../../.agents/skills/${name} .claude/skills/${name}. A dangling link: rm .claude/skills/${name}`);
    expect([...unlinked, ...stray]).toEqual([]);
  });
});
