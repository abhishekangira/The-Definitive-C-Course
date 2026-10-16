import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, linkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseGeneratedTar, pathProblem, unpackGenerated } from './unpack-generated.mjs';

const tmp = mkdtempSync(path.join(tmpdir(), 'unpack-generated-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** Build a tarball with the real GNU/BSD `tar` the CI job uses, from a throwaway tree. */
function makeTar(setup: (dir: string) => string[], extra: string[] = []): string {
  const dir = path.join(tmp, `tree${n++}`);
  mkdirSync(path.join(dir, 'src/generated/samples'), { recursive: true });
  mkdirSync(path.join(dir, 'src/generated/traces'), { recursive: true });
  const files = setup(dir);
  const out = path.join(tmp, `a${n}.tar`);
  execFileSync('tar', [...extra, '-cf', out, ...files], { cwd: dir });
  return out;
}
const good = (dir: string) => {
  writeFileSync(path.join(dir, 'src/generated/samples/m01.json'), '{"a":1}\n');
  writeFileSync(path.join(dir, 'src/generated/traces/x.json'), '{}\n');
  return ['src/generated/samples/m01.json', 'src/generated/traces/x.json'];
};
const rejects = (tar: string, re: RegExp) => expect(() => parseGeneratedTar(readFileSync(tar))).toThrow(re);

describe('unpack-generated', () => {
  it('accepts a normal artifact and writes regular 0644 files into a clean directory', () => {
    const dest = path.join(tmp, 'out-good');
    expect(unpackGenerated(makeTar(good), dest)).toEqual(['src/generated/samples/m01.json', 'src/generated/traces/x.json']);
    expect(readFileSync(path.join(dest, 'src/generated/samples/m01.json'), 'utf8')).toBe('{"a":1}\n');
    expect(statSync(path.join(dest, 'src/generated/traces/x.json')).mode & 0o777).toBe(0o644);
  });

  it('rejects a ".." segment', () => {
    const tar = makeTar(dir => { writeFileSync(path.join(dir, 'evil'), 'x'); return ['src/generated/samples/../../../evil']; }, ['-P']);
    rejects(tar, /\.\.|strictly under/);
  });

  it('rejects an absolute path', () => {
    const abs = path.join(tmp, 'abs-target');
    writeFileSync(abs, 'x');
    rejects(makeTar(() => [abs], ['-P']), /strictly under/);
  });

  it('rejects a symlink member', () => {
    const tar = makeTar(dir => { symlinkSync('/etc/passwd', path.join(dir, 'src/generated/samples/link.json')); return ['src/generated/samples/link.json']; });
    rejects(tar, /not a regular file/);
  });

  it('rejects a hardlink member', () => {
    const tar = makeTar(dir => {
      const a = path.join(dir, 'src/generated/samples/a.json'); writeFileSync(a, 'x');
      linkSync(a, path.join(dir, 'src/generated/samples/b.json'));
      return ['src/generated/samples/a.json', 'src/generated/samples/b.json'];
    });
    rejects(tar, /not a regular file/);
  });

  it('rejects a directory member and a leading "./"', () => {
    rejects(makeTar(() => ['src/generated/samples']), /not a regular file/);
    rejects(makeTar(good, ['--transform', 's,^,./,']), /strictly under/);
  });

  it('rejects a path outside samples/traces, a sibling prefix and a backslash', () => {
    rejects(makeTar(dir => { mkdirSync(path.join(dir, 'src/generated/targets'), { recursive: true }); writeFileSync(path.join(dir, 'src/generated/targets/t.json'), '{}'); return ['src/generated/targets/t.json']; }), /strictly under/);
    rejects(makeTar(dir => { writeFileSync(path.join(dir, 'package.json'), '{}'); return ['package.json']; }), /strictly under/);
    expect(pathProblem('src/generated/samples-evil/m.json')).not.toBeNull();
    expect(pathProblem('src/generated/samples\\..\\x')).not.toBeNull();
    expect(pathProblem('src/generated/samples/./m.json')).not.toBeNull();
    expect(pathProblem('src/generated/samples//m.json')).not.toBeNull();
    expect(pathProblem('src/generated/samples/')).not.toBeNull();
    expect(pathProblem('src/generated/traces/ok-1.json')).toBeNull();
  });

  it('rejects pax extension headers (they can rename a member) and corrupt headers', () => {
    const tar = makeTar(good, ['--format=pax', '--pax-option=path=src/generated/samples/renamed.json']);
    rejects(tar, /not a regular file/);
    const buf = Buffer.from(readFileSync(makeTar(good)));
    buf[10] ^= 0xff; // flips a name byte: checksum no longer matches
    expect(() => parseGeneratedTar(buf)).toThrow(/checksum/);
  });

  it('writes nothing when any member is bad, and refuses a non-empty destination', () => {
    const tar = makeTar(dir => { writeFileSync(path.join(dir, 'src/generated/samples/ok.json'), '{}'); symlinkSync('x', path.join(dir, 'src/generated/samples/l.json')); return ['src/generated/samples/ok.json', 'src/generated/samples/l.json']; });
    const dest = path.join(tmp, 'out-bad');
    expect(() => unpackGenerated(tar, dest)).toThrow();
    expect(existsSync(dest)).toBe(false);
    const full = path.join(tmp, 'out-full');
    mkdirSync(full); writeFileSync(path.join(full, 'keep'), 'x');
    expect(() => unpackGenerated(makeTar(good), full)).toThrow(/not empty/);
  });
});
