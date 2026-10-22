// exercises:expect on fixtures (tools/exercises/fixtures/expect) and on broken copies of them.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectAll, validateCases } from './expect';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/expect');
const MOD = 'modules/m00-expect';
const ECHO = `${MOD}/exercises/echo-args`;

let tmp: string;
beforeAll(() => { tmp = mkdtempSync(path.join(tmpdir(), 'expect-test-')); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function copy(edit: (root: string) => void = () => {}): string {
  const root = path.join(tmp, `content-${++n}`);
  cpSync(FIXTURES, root, { recursive: true });
  edit(root);
  return root;
}
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), 'utf8');
const write = (root: string, rel: string, s: string) => writeFileSync(path.join(root, rel), s);
const byId = (root: string, only?: string) => expectAll({ contentRoot: root, cc: 'gcc', only });

describe('exercises:expect', () => {
  it('reproduces the committed fixture files byte for byte, twice', () => {
    const root = copy();
    for (let i = 0; i < 2; i++) {
      const items = byId(root);
      expect(items.map(x => [x.id, x.ok, x.skipped, x.changed, x.problems])).toEqual([
        ['echo-args', true, false, false, []],
        ['echo-args/variants/1', true, false, false, []],
        ['project/p0-sum', true, false, false, []],
      ]);
    }
    expect(read(root, `${ECHO}/tests.json`)).toBe(read(FIXTURES, `${ECHO}/tests.json`));
  });

  it('records real stdout and exit codes (including a non-zero exit and a program that ignores stdin)', () => {
    const spec = JSON.parse(read(FIXTURES, `${ECHO}/tests.json`));
    expect(spec.sources).toEqual(['echo.c']);
    expect(spec.warnings).toBe('error');
    expect(spec.tests.map((t: { expect: unknown }) => t.expect)).toEqual([
      { stdout: 'usage: echo ARG...\n', exit: 2 },
      { stdout: 'a\nb c\n', exit: 0 },
      { stdout: 'x\n', exit: 0 },
    ]);
    expect(spec.tests[0].hint).toBe('Check argc first.');
    const sum = JSON.parse(read(FIXTURES, `${MOD}/project/p0-sum/check.json`));
    expect(sum.tests[1].expect).toEqual({ stdout: '', exit: 1 });
  });

  it('rewrites a stale tests.json, and --check reports it without writing', () => {
    const root = copy(r => write(r, `${ECHO}/tests.json`, read(r, `${ECHO}/tests.json`).replace('"a\\nb c\\n"', '"typed by hand\\n"')));
    const stale = read(root, `${ECHO}/tests.json`);
    const dry = expectAll({ contentRoot: root, cc: 'gcc', only: 'echo-args', check: true });
    expect(dry[0].changed).toBe(true);
    expect(read(root, `${ECHO}/tests.json`)).toBe(stale);
    const fixed = byId(root, 'echo-args');
    expect(fixed[0].changed).toBe(true);
    expect(read(root, `${ECHO}/tests.json`)).toBe(read(FIXTURES, `${ECHO}/tests.json`));
  });

  it('copies `memory: true` from cases.yaml into tests.json, and leaves it out otherwise', () => {
    const root = copy(r => write(r, `${ECHO}/cases.yaml`, `memory: true\n${read(r, `${ECHO}/cases.yaml`)}`));
    const [item] = byId(root, 'echo-args');
    expect([item.ok, item.changed]).toEqual([true, true]);
    const spec = JSON.parse(read(root, `${ECHO}/tests.json`));
    expect(spec.memory).toBe(true);
    expect(spec.tests).toEqual(JSON.parse(read(FIXTURES, `${ECHO}/tests.json`)).tests);
    expect(JSON.parse(read(FIXTURES, `${ECHO}/tests.json`))).not.toHaveProperty('memory');
  });

  it('rejects a solution that does not build cleanly (-Werror)', () => {
    const root = copy(r => write(r, `${ECHO}/solution.c`, read(r, `${ECHO}/solution.c`).replace('int i = 1', 'int unused; int i = 1')));
    const [item] = byId(root, 'echo-args');
    expect(item.ok).toBe(false);
    expect(item.problems[0]).toMatch(/does not build/);
    expect(item.problems[0]).toMatch(/unused/);
    expect(read(root, `${ECHO}/tests.json`)).toBe(read(FIXTURES, `${ECHO}/tests.json`));
  });

  it('rejects a solution with a memory error (ASan)', () => {
    const root = copy(r => write(r, `${ECHO}/solution.c`, `#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    char *p = malloc(4);\n    p[4] = 'x';\n    printf("%d\\n", p[4]);\n    free(p);\n    return 0;\n}\n`));
    const [item] = byId(root, 'echo-args');
    expect(item.ok).toBe(false);
    expect(item.problems.join('\n')).toMatch(/fails under ASan\+UBSan/);
  });

  it('rejects a solution with undefined behaviour (UBSan) and one that leaks (LSan)', () => {
    const ub = copy(r => write(r, `${ECHO}/solution.c`, `#include <limits.h>\n#include <stdio.h>\n\nint main(int argc, char **argv) {\n    (void)argv;\n    int x = INT_MAX - 1 + argc;\n    printf("%d\\n", x + 1);\n    return 0;\n}\n`));
    expect(byId(ub, 'echo-args')[0].problems.join('\n')).toMatch(/fails under ASan\+UBSan/);
    const leak = copy(r => write(r, `${ECHO}/solution.c`, `#include <stdlib.h>\n\nvoid *volatile sink;\n\nint main(void) {\n    sink = malloc(8);\n    sink = NULL;\n    return 0;\n}\n`));
    expect(byId(leak, 'echo-args')[0].problems.join('\n')).toMatch(/fails under ASan\+UBSan/);
  });

  it('skips a missing cases.yaml and rejects an invalid one', () => {
    const missing = copy(r => rmSync(path.join(r, `${ECHO}/cases.yaml`)));
    const skipped = byId(missing, 'echo-args')[0];
    expect(skipped.skipped).toBe(true);
    expect(skipped.ok).toBe(true);
    expect(skipped.problems).toEqual(['cases.yaml is missing (skipped)']);
    const bad = copy(r => write(r, `${ECHO}/cases.yaml`, 'cases:\n  - name: a\n    stdn: "x"\n  - name: a\n'));
    const problems = byId(bad, 'echo-args')[0].problems.join('\n');
    expect(problems).toMatch(/unknown key "stdn"/);
    expect(problems).toMatch(/duplicate name "a"/);
  });

  it('rejects a case that times out', () => {
    const root = copy(r => {
      write(r, `${ECHO}/solution.c`, 'int main(void) {\n    for (;;) {}\n}\n');
      write(r, `${ECHO}/cases.yaml`, 'cases:\n  - name: hangs\n    timeoutMs: 300\n');
    });
    expect(byId(root, 'echo-args')[0].problems[0]).toMatch(/case "hangs"/);
  });
});

describe('exercises:expect CLI exit status', () => {
  const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'expect-cli.ts');
  const run = (root: string, ...args: string[]) => {
    const r = spawnSync('npx', ['tsx', CLI, '--content-root', root, ...args], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('--only that matches nothing exits 1 (even with --check)', () => {
    const root = copy();
    for (const extra of [[], ['--check']]) {
      const r = run(root, '--only', 'no-such-exercise', ...extra);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/No exercises or projects matched --only no-such-exercise/);
    }
  });

  it('--module that matches nothing exits 1', () => {
    expect(run(copy(), '--module', 'm99').code).toBe(1);
  });

  it('--only with a real id still exits 0', () => {
    expect(run(copy(), '--only', 'echo-args', '--check').code).toBe(0);
  });

  it('a folder without cases.yaml is skipped: --check exits 0 and says so', () => {
    const root = copy(r => rmSync(path.join(r, `${ECHO}/cases.yaml`)));
    const r = run(root, '--check');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/skipped \(no cases\.yaml\)/);
  });
});

describe('validateCases', () => {
  it('accepts the documented shape', () => {
    expect(validateCases({ sources: ['a.c'], warnings: 'allow', cases: [{ name: 'x', stdin: '', args: ['-v'], hint: 'h', timeoutMs: 5 }] }).errors).toEqual([]);
  });
  it('rejects wrong types', () => {
    expect(validateCases({ cases: [] }).errors).toEqual(['"cases" must be a non-empty list']);
    expect(validateCases({ cases: [{ name: 'x', args: 'no' }] }).errors).toEqual(['cases[0]: "args" must be a list of strings']);
    expect(validateCases({ warnings: 'maybe', cases: [{ name: 'x' }] }).errors).toEqual(['"warnings" must be "error" or "allow"']);
    expect(validateCases({ memory: true, cases: [{ name: 'x' }] }).errors).toEqual([]);
    expect(validateCases({ memory: 'yes', cases: [{ name: 'x' }] }).errors).toEqual(['"memory" must be true (or left out)']);
  });
});
