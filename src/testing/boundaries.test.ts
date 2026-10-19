// src/testing/ is shared by the app (browser), tools/exercises (Node) and check.mjs (a zero-dependency Node bundle),
// so its modules must stay environment-neutral, as their headers say: no Node or DOM APIs, and no imports from the rest
// of the repo, which may use either. Test files are exempt.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = path.dirname(fileURLToPath(import.meta.url));
/** Packages that run unchanged in the browser and in Node, and that the check.mjs bundle inlines. */
const PACKAGES = new Set(['fflate']);
const GLOBALS = /\b(document|window|localStorage|sessionStorage|navigator|process|require|Buffer|__dirname|__filename)\b/;

const modules = readdirSync(DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8');
/** The source without comments and string contents, so prose that mentions `window` is not a hit. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');

/** Every module specifier except type-only imports, which the compiler erases. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm)) if (!m[2]) out.push(m[3]);
  for (const m of src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

describe('src/testing stays environment-neutral', () => {
  it('finds the shared modules (guard against checking nothing)', () => {
    expect(modules).toContain('runner.ts');
    expect(modules).toContain('token.ts');
  });

  it('imports only its own modules and neutral packages', () => {
    const bad = modules.flatMap(f => specifiers(read(f))
      .filter(s => !s.startsWith('./') && !PACKAGES.has(s))
      .map(s => `${f}: imports '${s}' (src/testing also runs in the browser and in check.mjs: no node:*, no DOM code, nothing outside src/testing)`));
    expect(bad).toEqual([]);
  });

  it('uses no Node or DOM globals', () => {
    const bad = modules.flatMap(f => code(read(f)).split('\n').flatMap((line, i) => {
      const m = GLOBALS.exec(line);
      return m ? [`${f}:${i + 1}: uses '${m[1]}' (src/testing also runs in the browser and in check.mjs; take it as a parameter instead)`] : [];
    }));
    expect(bad).toEqual([]);
  });
});
