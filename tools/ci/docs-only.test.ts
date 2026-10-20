import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isDocsOnly } from './docs-only.mjs';

describe('isDocsOnly', () => {
  it('accepts the root docs, the licence and research/', () => {
    expect(isDocsOnly(['README.md', 'AGENTS.md', 'CLAUDE.md', 'PLAN.md', 'LICENSE', 'research/a/b.md'])).toBe(true);
  });
  it('treats Markdown anywhere else as code, because the tooling reads it', () => {
    expect(isDocsOnly(['content/modules/m01-c-in-your-browser/project/mario/README.md'])).toBe(false);
    expect(isDocsOnly(['tools/dod/README.md'])).toBe(false);
    expect(isDocsOnly(['animations/README.md'])).toBe(false);
  });
  it('is false as soon as one file is code, and for an empty change', () => {
    expect(isDocsOnly(['README.md', 'src/app/App.tsx'])).toBe(false);
    expect(isDocsOnly(['.github/workflows/ci.yml', 'README.md'])).toBe(false);
    expect(isDocsOnly([])).toBe(false);
  });
  it('does not match lookalike paths', () => {
    expect(isDocsOnly(['docs/README.md', 'README.md.bak', 'researchers/x', 'sub/LICENSE'])).toBe(false);
  });
  it('prints the answer from stdin when run as the CI step does', () => {
    const run = (s: string) => execFileSync('node', ['tools/ci/docs-only.mjs'], { input: s, encoding: 'utf8' }).trim();
    expect(run('README.md\nPLAN.md\n')).toBe('true');
    expect(run('README.md\nsrc/x.ts\n')).toBe('false');
    expect(run('')).toBe('false');
  });
});
