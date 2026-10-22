// tools/setup/debian.sh installs the native packages of CI's "Install the native toolchain" step on Debian 13.
// This keeps the two lists equal, so a package added to or dropped from ci.yml can't leave local setups behind.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

/** The packages of every `apt-get install` line in ci.yml (options dropped). */
function ciPackages(yml: string): string[] {
  const lines = yml.split('\n').filter(l => /\bapt-get install\b/.test(l));
  expect(lines.length, 'ci.yml has no apt-get install line; update this test to find the native toolchain step').toBeGreaterThan(0);
  return lines.flatMap(l => l.slice(l.indexOf('apt-get install') + 'apt-get install'.length).trim().split(/\s+/))
    .filter(w => !w.startsWith('-'));
}

/** The words of a `NAME=(...)` array in debian.sh. */
function scriptArray(sh: string, name: string): string[] {
  const m = sh.match(new RegExp(`^${name}=\\(([^)]*)\\)`, 'm'));
  expect(m, `tools/setup/debian.sh has no ${name}=(...) line`).not.toBeNull();
  return m![1].trim().split(/\s+/).filter(Boolean);
}

describe('localsetup:debian', () => {
  const sh = read('tools/setup/debian.sh');

  it('installs exactly the apt packages ci.yml installs', () => {
    const ci = ciPackages(read('.github/workflows/ci.yml'));
    expect(ci).toContain('gcc-13'); // guard against parsing the wrong line
    expect([...scriptArray(sh, 'APT_PACKAGES')].sort(),
      'APT_PACKAGES in tools/setup/debian.sh must list the packages of the apt-get install line in .github/workflows/ci.yml')
      .toEqual([...ci].sort());
  });

  it('keeps its extra packages out of the CI list', () => {
    const ci = ciPackages(read('.github/workflows/ci.yml'));
    expect(scriptArray(sh, 'EXTRA_PACKAGES').filter(p => ci.includes(p)),
      'a package ci.yml installs belongs in APT_PACKAGES, not EXTRA_PACKAGES').toEqual([]);
  });

  it('is the localsetup:debian npm script', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['localsetup:debian']).toBe('bash tools/setup/debian.sh');
  });
});
