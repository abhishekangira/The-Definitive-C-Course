// The client spec forbids Unicode glyphs as icons (fonts lack them; use inline SVG, see Icon.tsx). This scans the real app
// source and lesson content, so a ✓, ▶ or arrow added to a button or verdict fails here instead of in review.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir: string, exts: string[], skip: (p: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (skip(p)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.includes(path.extname(p))) out.push(p);
  }
  return out;
}

/** Marks, play/restart symbols and key or move arrows that stand in for an icon. */
const ICON_GLYPHS = /[✓✔✗✘✕✖▶►▷↵⇤⇥⟲⟳↺↻↑↓]/u;
/** Left and right arrows are fine inside a sentence, but not as the face of a button or link. */
const NAV_ARROW = /[←→]/u;
const CONTROL = /<(button|Link|a)\b|<\/(button|Link|a)>/;

const isTest = (p: string) => /\.test\.tsx?$/.test(p) || p.includes(`${path.sep}generated${path.sep}`);

describe('no Unicode glyphs as icons', () => {
  const files = walk(path.join(ROOT, 'src'), ['.ts', '.tsx', '.css'], isTest);

  it('scans the app source (guard against scanning nothing)', () => {
    expect(files.some(f => f.endsWith('Icon.tsx'))).toBe(true);
    expect(files.length).toBeGreaterThan(40);
  });

  it('finds no icon glyph in src/', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const m = ICON_GLYPHS.exec(line);
        if (m) hits.push(`${path.relative(ROOT, f)}:${i + 1}: U+${m[0].codePointAt(0)!.toString(16).toUpperCase()} (use <Icon>/<Mark> from components/Icon.tsx)`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('finds no arrow glyph on a button or link', () => {
    const hits: string[] = [];
    for (const f of files.filter(x => x.endsWith('.tsx'))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (NAV_ARROW.test(line) && CONTROL.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: arrow glyph in a control (use <Icon name="arrow-left|arrow-right">)`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('finds no icon glyph in the lesson content', () => {
    const content = walk(path.join(ROOT, 'content'), ['.mdx', '.yaml']);
    expect(content.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of content) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (ICON_GLYPHS.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`); });
    }
    expect(hits).toEqual([]);
  });
});
