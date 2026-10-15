// verify:exercises on the fixtures (one of each kind) and on broken copies of them.
// Browser exercises run on the real browser toolchain in Node; native ones through check.mjs + gcc.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCheck } from '../check/build.mjs';
import { validateExerciseMeta } from './validate';
import { verifyAll, type ItemReport } from './verify';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/content');
const MOD = 'modules/m00-fixtures';

let tmp: string;
let checkMjs: string;
beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'verify-test-'));
  checkMjs = (await buildCheck({ outfile: path.join(tmp, 'check.mjs') })).outfile;
}, 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A copy of the fixture content root that a test can break. */
function copy(edit: (root: string) => void): string {
  const root = path.join(tmp, `content-${++n}`);
  cpSync(FIXTURES, root, { recursive: true });
  edit(root);
  return root;
}
const file = (root: string, rel: string) => path.join(root, MOD, rel);
const edit = (root: string, rel: string, f: (s: string) => string) => writeFileSync(file(root, rel), f(readFileSync(file(root, rel), 'utf8')));
const run = (contentRoot: string, only?: string) => verifyAll({ contentRoot, only, cc: 'gcc', checkMjs });
const item = (items: ItemReport[], id: string) => items.find(i => i.id === id)!;

describe('verify:exercises on the fixtures', () => {
  it('passes a CT with a variant, an FB, a PA, an LT and a project', async () => {
    const s = await run(FIXTURES);
    expect(s.items.map(i => [i.id, i.kind, i.runsIn, i.ok, i.problems])).toEqual([
      ['ct-sum-digits', 'ct', 'browser', true, []],
      ['ct-sum-digits/v1', 'ct', 'browser', true, []],
      ['fb-reverse-word', 'fb', 'browser', true, []],
      ['lt-free-list', 'lt', 'native', true, []],
      ['pa-swap', 'pa', 'browser', true, []],
      ['p0-greet', 'project', 'native', true, []],
    ]);
    expect(item(s.items, 'ct-sum-digits').summary).toEqual(['solution 5/5', 'starter 3/5']);
    expect(item(s.items, 'fb-reverse-word').summary).toEqual(['solution 4/4', 'starter 3/4']);
    expect(item(s.items, 'lt-free-list').summary).toEqual(['solution 4/4', 'token verified', 'starter 3/4']);
    expect(item(s.items, 'pa-swap').summary).toEqual(['2 accepted orderings pass', '13 lines', 'starter scramble is rejected']);
    expect(item(s.items, 'p0-greet').summary).toEqual(['solution 5/5', 'token verified', 'starter 2/5']);
    expect(s.ok).toBe(true);
  }, 180_000);
});

describe('verify:exercises catches authoring mistakes', () => {
  it('a starter that already passes, and a solution that fails', async () => {
    const root = copy(r => {
      cpSync(file(r, 'exercises/ct-sum-digits/solution.c'), file(r, 'exercises/ct-sum-digits/starter.c'));
      edit(r, 'exercises/fb-reverse-word/solution.c', s => s.replace('free(r);', ''));
    });
    const s = await run(root);
    expect(item(s.items, 'ct-sum-digits').problems).toEqual(['the starter passes every test (it must fail at least one: are the tests strong enough?)']);
    expect(item(s.items, 'fb-reverse-word').problems).toEqual(['the reference solution fails: no memory errors or leaks']);
    expect(s.ok).toBe(false);
  }, 180_000);

  it('exercise.yaml mistakes: hint count, empty hints, id, missing variant folder', async () => {
    const root = copy(r => edit(r, 'exercises/ct-sum-digits/exercise.yaml', s => s
      .replace('id: ct-sum-digits', 'id: ct-sum')
      .replace('variants: [v1]', 'variants: [v1, v2]')
      .replace(/hints:\n  - "Peel[^\n]*\n/, 'hints:\n  - ""\n')));
    const s = await run(root, 'ct-sum-digits');
    expect(item(s.items, 'ct-sum-digits').problems).toEqual([
      'exercise.yaml: "id" is "ct-sum" but the folder is "ct-sum-digits"',
      'exercise.yaml: hint 1 is empty',
    ]);
    const root2 = copy(r => edit(r, 'exercises/ct-sum-digits/exercise.yaml', s => s.replace('variants: [v1]', 'variants: [v1, v2]').replace(/  - \|\n(    .*\n)+/, '')));
    const s2 = await run(root2, 'ct-sum-digits');
    expect(item(s2.items, 'ct-sum-digits').problems).toEqual(['exercise.yaml: "hints" must have exactly 3 tiers, found 2']);
  }, 60_000);

  it('a variant listed without its folder, and tests.json rules', async () => {
    const root = copy(r => {
      edit(r, 'exercises/ct-sum-digits/exercise.yaml', s => s.replace('variants: [v1]', 'variants: [v1, v2]'));
      edit(r, 'exercises/fb-reverse-word/tests.json', s => s.replace('"run": { "stdin": "a\\n" }, "expect": { "stdout": "a\\n" }', '"run": {}, "expect": { "exit": 1 }'));
    });
    const s = await run(root);
    expect(item(s.items, 'ct-sum-digits').problems).toEqual(['variant "v2" is listed but variants/v2/ does not exist']);
    expect(item(s.items, 'fb-reverse-word').problems).toEqual(['tests.json: test "reverses a single letter": a test that expects a non-zero exit must supply run.stdin and check stdout or stderr']);
  }, 120_000);

  it('Parsons: an unlisted order that passes, and a starter that is already accepted', async () => {
    // Swapping the two declarations is valid C, but here the alternative is not listed.
    const root = copy(r => {
      edit(r, 'exercises/pa-swap/exercise.yaml', s => s.replace(/  accepted:\n(    .*\n)+/, ''));
      writeFileSync(file(r, 'exercises/pa-swap/starter.c'), readFileSync(file(r, 'exercises/pa-swap/solution.c'), 'utf8').replace('    int x = 1;\n    int y = 2;\n', '    int y = 2;\n    int x = 1;\n'));
    });
    const s = await run(root, 'pa-swap');
    expect(item(s.items, 'pa-swap').problems).toEqual(['the scrambled starter.c order passes every test: add it to parsons.accepted, or make the tests stricter']);
    const root2 = copy(r => cpSync(file(r, 'exercises/pa-swap/solution.c'), file(r, 'exercises/pa-swap/starter.c')));
    expect(item((await run(root2, 'pa-swap')).items, 'pa-swap').problems).toEqual(['the scrambled starter.c is already an accepted order']);
  }, 120_000);

  it('native: a starter that passes check.mjs, and a project solution that fails', async () => {
    const root = copy(r => {
      cpSync(file(r, 'exercises/lt-free-list/solution.c'), file(r, 'exercises/lt-free-list/starter.c'));
      cpSync(file(r, 'project/p0-greet/starter/Makefile'), file(r, 'project/p0-greet/solution/Makefile'));
    });
    const s = await run(root);
    expect(item(s.items, 'lt-free-list').problems).toEqual(['the starter passes every check natively (it must fail at least one)']);
    expect(item(s.items, 'p0-greet').problems).toEqual(['the reference solution fails natively: make builds greet and tracks greet.h']);
  }, 180_000);
});

describe('validateExerciseMeta', () => {
  const base = { id: 'x', kind: 'ct', title: 'T', prompt: 'P', runsIn: 'browser', hints: ['a', 'b', 'c'], variants: [] };
  it('accepts a complete exercise and warns about unknown keys', () => {
    expect(validateExerciseMeta(base, 'x')).toMatchObject({ errors: [], warnings: [] });
    expect(validateExerciseMeta({ ...base, 'runs-in': 'browser' }, 'x').warnings).toEqual(['unknown key "runs-in" (did you mean "runsIn"?)']);
  });
  it('enforces kind-specific rules', () => {
    expect(validateExerciseMeta({ ...base, kind: 'lt' }, 'x').errors).toEqual(['LT (local task) exercises must have runsIn: native']);
    expect(validateExerciseMeta({ ...base, kind: 'pa' }, 'x').errors).toEqual(['Parsons exercises need a "parsons" mapping (distractors, indent)']);
    expect(validateExerciseMeta({ ...base, kind: 'pa', parsons: { distractors: [], indent: 'no', accepted: [''] } }, 'x').errors).toEqual([
      '"parsons.indent" must be true or false', '"parsons.accepted" must be a list of alternative orderings (each a block of lines)',
    ]);
    expect(validateExerciseMeta({ ...base, kind: 'quiz', variants: undefined }, 'x').errors).toEqual([
      '"kind" must be one of ct, fb, pa, lt', '"variants" must be a list of variant folder names ([] for none)',
    ]);
  });
});
