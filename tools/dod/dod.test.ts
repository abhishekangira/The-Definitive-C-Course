import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from './cli';
import { formatReport, runSteps, spawnExec, type Exec } from './run';
import { EXERCISE_PROBLEM, animationIds, buildSteps, findModuleDir, type Step } from './steps';

const here = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.join(here, 'fixtures', 'content');
const meta = { module: 'm90', fast: false };

/** A step that really runs `node -e <script>` so the runner's spawning, exit codes and output capture are exercised. */
const node = (id: string, script: string): Step => ({ id, point: 6, name: id, command: [process.execPath, '-e', script] });
const exec = spawnExec(here);

describe('buildSteps on the fixture modules', () => {
  it('runs the steps in the order the ticket lists, with the module passed to the module-aware commands', () => {
    const steps = buildSteps({ module: 'm90', contentRoot });
    expect(steps.map(s => s.id)).toEqual(['prepare', 'typecheck', 'lint', 'verify', 'trace', 'exercises', 'videos', 'anim', 'unit', 'build', 'e2e', 'targets']);
    expect(steps.find(s => s.id === 'verify')?.command.join(' ')).toContain('--check --module m90');
    expect(steps.find(s => s.id === 'e2e')?.env).toEqual({ E2E_MODULE: 'm90' });
  });

  it('skips the animation check when no lesson references an animation, and runs it per animation otherwise', () => {
    const plain = buildSteps({ module: 'm90', contentRoot }).find(s => s.id === 'anim');
    expect(plain?.skip).toBe('module references no animation');
    const animated = buildSteps({ module: 'm91', contentRoot }).find(s => s.id === 'anim');
    expect(animated?.skip).toBeUndefined();
    expect(animated?.command.join(' ')).toContain('--static a91-demo');
    expect(animated?.command.join(' ')).toContain('--static a91-other');
    expect(animationIds(findModuleDir(contentRoot, 'm91')!)).toEqual(['a91-demo', 'a91-other']);
  });

  it('runs toolchain:prepare before typecheck, and the full npm test (src/ and tools/) for point 6', () => {
    const steps = buildSteps({ module: 'm90', contentRoot, fast: true });
    expect(steps[0].command.join(' ')).toContain('toolchain:prepare');
    expect(steps[1].id).toBe('typecheck');
    expect(steps.find(s => s.id === 'unit')?.command).toEqual(['npm', 'run', '--silent', 'test']);
  });

  it('--fast skips build and e2e with a reason', () => {
    const steps = buildSteps({ module: 'm90', contentRoot, fast: true });
    expect(steps.filter(s => s.skip === '--fast').map(s => s.id)).toEqual(['build', 'e2e']);
  });

  it('rejects an unknown module', () => {
    expect(() => buildSteps({ module: 'm77', contentRoot })).toThrow(/unknown module "m77"/);
  });
});

describe('runSteps', () => {
  it('reports PASS, FAIL (with output tail and exit non-ok) and SKIPPED, and keeps running after a failure', async () => {
    const steps: Step[] = [
      node('good', 'console.log("fine")'),
      node('bad', 'for (let i = 1; i <= 30; i++) console.log("line " + i); console.error("boom"); process.exit(3)'),
      { id: 'skipped', point: 4, name: 'skipped', command: [], skip: 'not needed' },
      node('after', 'process.exit(0)'),
    ];
    const report = await runSteps(steps, exec, meta);
    expect(report.steps.map(s => [s.id, s.status])).toEqual([['good', 'PASS'], ['bad', 'FAIL'], ['skipped', 'SKIPPED'], ['after', 'PASS']]);
    expect(report.ok).toBe(false);
    const bad = report.steps[1];
    expect(bad.tail).toHaveLength(15);
    expect(bad.tail?.at(-1)).toBe('boom');
    expect(report.steps[2].reason).toBe('not needed');
    const text = formatReport(report);
    expect(text).toContain('SKIPPED (not needed)');
    expect(text).toContain('FAIL bad (§3.6 point 6)');
    expect(text).toContain('dod m90: FAIL (bad)');
  });

  it('lists the failing exercise lines even when they fall outside the 15-line tail', async () => {
    // Shaped like `verify:exercises`: the failing row sorts first, then 20 passing rows and a summary.
    const script = [
      'console.log("  \u2717 cash   ct \u00b7 browser   solution 1/6")',
      'console.log("      - the starter passes every test")',
      'for (let i = 1; i <= 20; i++) console.log("  \u2713 ok-" + i)',
      'console.log("1 of 21 checked have problems.")',
      'process.exit(1)',
    ].join(';');
    const step: Step = { ...node('exercises', script), highlight: EXERCISE_PROBLEM };
    const [r] = (await runSteps([step], exec, meta)).steps;
    expect(r.tail?.some(l => l.includes('cash'))).toBe(false);
    expect(r.failing).toEqual(['  \u2717 cash   ct \u00b7 browser   solution 1/6', '      - the starter passes every test']);
    expect(formatReport({ ...meta, ok: false, steps: [r] })).toContain('failing lines:\n      \u2717 cash');
    expect(buildSteps({ module: 'm90', contentRoot }).find(s => s.id === 'exercises')?.highlight).toBe(EXERCISE_PROBLEM);
  });

  it('is ok when everything passes or is skipped', async () => {
    const report = await runSteps([node('a', ''), { id: 's', point: 7, name: 's', command: [], skip: 'x' }], exec, meta);
    expect(report.ok).toBe(true);
    expect(formatReport(report)).toContain('dod m90: PASS');
  });

  it('treats a command that cannot start as FAIL', async () => {
    const report = await runSteps([{ id: 'nope', point: 6, name: 'nope', command: ['definitely-not-a-command-xyz'] }], exec, meta);
    expect(report.steps[0].status).toBe('FAIL');
  });
});

describe('cli', () => {
  it('parses flags and requires --module', () => {
    expect(parseArgs(['--module', 'm01', '--fast', '--json'])).toMatchObject({ module: 'm01', fast: true, json: true });
    expect(() => parseArgs([])).toThrow(/--module mNN is required/);
    expect(() => parseArgs(['--module', 'm01', '--bogus'])).toThrow(/unknown argument --bogus/);
  });

  it('--json prints only the report as JSON, and the exit code follows FAIL', async () => {
    const fake: Exec = async step => (step.id === 'lint' ? { code: 1, output: 'lint broke\n' } : { code: 0, output: '' });
    let out = '';
    const { code } = await main(['--module', 'm90', '--json', '--fast'], s => { out += s; }, fake, contentRoot);
    expect(code).toBe(1);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.fast).toBe(true);
    expect(parsed.steps.find((s: { id: string }) => s.id === 'lint')).toMatchObject({ status: 'FAIL', tail: ['lint broke'] });
    expect(parsed.steps.find((s: { id: string }) => s.id === 'build')).toMatchObject({ status: 'SKIPPED', reason: '--fast' });
  });

  it('prints the table and exits 0 when nothing fails; exits 2 on an unknown module', async () => {
    let out = '';
    const ok = await main(['--module', 'm91', '--fast'], s => { out += s; }, async () => ({ code: 0, output: '' }), contentRoot);
    expect(ok.code).toBe(0);
    expect(out).toContain('dod m91: PASS');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await main(['--module', 'm77'], () => {}, async () => ({ code: 0, output: '' }), contentRoot)).code).toBe(2);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unknown module "m77"'));
    err.mockRestore();
  });
});

describe('the real cli process with --json', () => {
  it('writes clean JSON on stdout even when every step prints to stdout itself', () => {
    // A stub `npm` and `sh` on PATH print a banner like npm's and succeed, so the real spawn path runs without the slow checks.
    const bin = mkdtempSync(path.join(tmpdir(), 'dod-bin-'));
    for (const name of ['npm', 'sh']) {
      writeFileSync(path.join(bin, name), '#!/bin/sh\necho "> noisy banner on stdout"\nexit 0\n');
      chmodSync(path.join(bin, name), 0o755);
    }
    const tsx = path.resolve(here, '../../node_modules/.bin/tsx');
    const r = spawnSync(process.execPath, [tsx, path.join(here, 'cli.ts'), '--module', 'm91', '--json', '--content-root', contentRoot],
      { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report).toMatchObject({ module: 'm91', ok: true });
    expect(report.steps.filter((s: { status: string }) => s.status === 'PASS').length).toBeGreaterThan(5);
  }, 60_000);
});
