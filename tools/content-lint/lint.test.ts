// content-lint against fixtures:
//   fixtures/good  a small complete site (2 modules) that must lint without a single message;
//   fixtures/bad   one module of bad lessons, one of bad module.yaml fields, one of bad quizzes;
// plus "good with one change" cases, built by copying fixtures/good to a temp folder and editing it, so each
// rule is shown to fire on exactly the change that breaks it (and not one step before).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { afterAll, describe, expect, it } from 'vitest';
import remarkCourse from '../mdx/remark-course';
import { countWords } from '../../src/content-model/cards';
import { readdirSync } from 'node:fs';
import { exitCode, parseArgs, renderReport } from './cli';
import { lintContent, type LintResult } from './lint';
import type { LintMessage } from './messages';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOOD = path.join(HERE, 'fixtures', 'good');
const BAD = path.join(HERE, 'fixtures', 'bad');

const run = (site: string, extra: Partial<Parameters<typeof lintContent>[0]> = {}) =>
  lintContent({ contentRoot: path.join(site, 'content'), ...extra });

const M1 = 'content/modules/m01-basics';
const M2 = 'content/modules/m02-more';

// ---- temp copies of the good site --------------------------------------------------------------

const temps: string[] = [];
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

type Edit = string | null | ((old: string) => string);

/** Copies fixtures/good, applies edits (path to new text, or a function of the old text; null deletes), lints. */
function lintGoodWith(edits: Record<string, Edit>, extra: Partial<Parameters<typeof lintContent>[0]> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'content-lint-'));
  temps.push(dir);
  cpSync(GOOD, dir, { recursive: true });
  for (const [rel, edit] of Object.entries(edits)) {
    const file = path.join(dir, rel);
    if (edit === null) { rmSync(file, { force: true }); continue; }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof edit === 'function' ? edit(readFileSync(file, 'utf8')) : edit);
  }
  return { result: run(dir, extra), dir };
}

/** String replace that fails loudly when the text to replace is not there (a silent no-op would hide a broken test). */
const sub = (from: string | RegExp, to: string): ((old: string) => string) => old => {
  if (typeof from === 'string' ? !old.includes(from) : !from.test(old)) throw new Error(`test setup: ${String(from)} not found`);
  return old.replace(from, to);
};

const hits = (r: LintResult, rule: string, file?: string) =>
  r.messages.filter(m => m.rule === rule && (!file || m.file.endsWith(file)));
const errorsOf = (r: LintResult, rule: string, file?: string) => hits(r, rule, file).filter(m => m.severity === 'error');
const warningsOf = (r: LintResult, rule: string, file?: string) => hits(r, rule, file).filter(m => m.severity === 'warning');
const infosOf = (r: LintResult, rule: string, file?: string) => hits(r, rule, file).filter(m => m.severity === 'info');
const rules = (r: LintResult) => [...new Set(r.messages.map(m => `${m.severity}:${m.rule}`))].sort();

/** 1-based line of the first line containing `marker`. */
function lineOf(file: string, marker: string): number {
  const i = readFileSync(file, 'utf8').split('\n').findIndex(l => l.includes(marker));
  if (i < 0) throw new Error(`${marker} not found in ${file}`);
  return i + 1;
}

/** 1-based line of the n-th (1-based) line containing `marker`. */
function lineOfNth(file: string, marker: string, n: number): number {
  const lines = readFileSync(file, 'utf8').split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(marker) && ++seen === n) return i + 1;
  throw new Error(`${marker} #${n} not found in ${file}`);
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// ---- the good fixture --------------------------------------------------------------------------

describe('fixtures/good', () => {
  const r = run(GOOD);

  it('has no errors and no warnings', () => {
    expect(r.messages).toEqual([]);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
  });

  it('counts what it checked', () => {
    expect(r.stats).toMatchObject({ modules: 2, lessons: 4, quizItems: 29 });
    expect(r.lessons.map(l => l.cards)).toEqual([5, 7, 2, 3]);
    expect(r.lessons[0].words).toEqual([13, 0, 8, 9, 14]);
    expect(r.lessons.every(l => l.maxWords <= 250)).toBe(true);
  });
});

// ---- cadence (PLAN §2.5) -----------------------------------------------------------------------

describe('word budget', () => {
  const lesson = (n: number) => (old: string) => old.replace('A C program is compiled before it runs. Predict what this one prints.', words(n));

  it('allows 250 words in a card and rejects 251', () => {
    const ok = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: lesson(250) }).result;
    expect(errorsOf(ok, 'word-budget')).toEqual([]);
    const bad = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: lesson(251) }).result;
    expect(errorsOf(bad, 'word-budget')).toHaveLength(1);
    expect(errorsOf(bad, 'word-budget')[0].message).toContain('card 1 has 251 words of prose (limit 250)');
  });

  it('counts the words of a card across several paragraphs, lists and inline code', () => {
    const text = `${words(100)}\n\n- ${words(60)}\n\nand \`code words here\` plus ${words(88)}`; // 100 + 60 + 1 + 3 + 1 + 88 = 253
    const r = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: sub('A C program is compiled before it runs. Predict what this one prints.', text) }).result;
    expect(errorsOf(r, 'word-budget')[0].message).toContain('253 words');
  });

  it('does not count code fences, JSX props or the analogy text', () => {
    const r = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: sub('breaksDown="`printf` trusts', `breaksDown="${words(400)} \`printf\` trusts`) }).result;
    expect(errorsOf(r, 'word-budget')).toEqual([]);
  });

  it('measures the budget between interactions, so an interaction resets it', () => {
    const two = `${words(200)}\n\n<Choice question="Q" options={["a", "b"]} answer={0} explain="x" />\n\n${words(200)}`;
    const r = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: sub('A C program is compiled before it runs. Predict what this one prints.', two) }).result;
    expect(errorsOf(r, 'word-budget')).toEqual([]);
  });
});

describe('media must be followed by an interaction', () => {
  it('rejects an animation or video in the final card', () => {
    const r = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: sub('**What you know now:**', '<Animation id="a01-demo" />\n\n**What you know now:**') }).result;
    const e = errorsOf(r, 'media-needs-interaction');
    expect(e).toHaveLength(1);
    expect(e[0].message).toContain('<Animation> is in the last card');
  });

  it('rejects two media elements in one card', () => {
    const r = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: sub('<Animation id="a01-demo" />', '<Animation id="a01-demo" />\n\n<Animation id="a01-demo" />') }).result;
    expect(errorsOf(r, 'media-per-card')).toHaveLength(1);
  });

  it('accepts one media element followed by an interaction in the same card', () => {
    expect(errorsOf(lintGoodWith({}).result, 'media-needs-interaction')).toEqual([]);
  });

  it('applies to YouTube too', () => {
    const r = lintGoodWith({ [`${M2}/lessons/01-video.mdx`]: sub(/<Choice[\s\S]*?\/>\n\n/, '') }).result;
    expect(errorsOf(r, 'media-needs-interaction', '01-video.mdx')).toHaveLength(1);
  });
});

describe('fences', () => {
  const lesson = `${M1}/lessons/01-hello.mdx`;
  const withFence = (meta: string) => ({ [lesson]: sub('```c id=fx-hello', '```c ' + meta) });

  it('needs id= or fragment on a C fence', () => {
    const r = lintGoodWith(withFence('')).result;
    expect(errorsOf(r, 'fence-id')).toHaveLength(1);
    expect(errorsOf(lintGoodWith(withFence('fragment')).result, 'fence-id')).toEqual([]);
  });

  it('rejects unknown keys and bad quoted values', () => {
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello colour=red')).result, 'fence-meta')[0].message).toBe('unknown fence key "colour"');
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello stdin="\\q"')).result, 'fence-meta')[0].message).toContain('not a valid JSON string');
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello expect.nope=warning')).result, 'fence-meta')).toHaveLength(1);
  });

  it('rejects duplicate sample ids, across lessons and across modules', () => {
    const same = lintGoodWith({ [`${M1}/lessons/02-frames.mdx`]: sub('id=fx-uninit', 'id=fx-hello') }).result;
    expect(errorsOf(same, 'duplicate-sample')).toHaveLength(1);
    expect(errorsOf(same, 'duplicate-sample')[0].message).toContain('01-hello.mdx');
    const across = lintGoodWith({ [`${M2}/lessons/02-posix-free.mdx`]: sub('id=fx-two-plus-two', 'id=fx-hello') }).result;
    expect(errorsOf(across, 'duplicate-sample', '02-posix-free.mdx')).toHaveLength(1);
    // a quiz item's code is a sample too
    const quiz = lintGoodWith({ [`${M2}/quizzes/checkpoint.yaml`]: sub('id: fx2-cp-predict', 'id: fx-hello') }).result;
    expect(errorsOf(quiz, 'duplicate-sample', 'checkpoint.yaml')).toHaveLength(1);
  });

  it('keeps run-without-prediction to fences nested in a component', () => {
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello predict=none')).result, 'predict-before-run')).toHaveLength(1);
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello run')).result, 'predict-before-run')).toHaveLength(1);
    // fx-frames (inside <Stepper>) and the fixed program inside <CompilerError> are predict=none in the good fixture
    expect(errorsOf(lintGoodWith({}).result, 'predict-before-run')).toEqual([]);
  });

  it('asks UB samples a categorical question', () => {
    expect(errorsOf(lintGoodWith({ [`${M1}/lessons/02-frames.mdx`]: sub('predict=outcome', 'predict=output') }).result, 'ub-prediction')).toHaveLength(1);
    expect(errorsOf(lintGoodWith({ [`${M1}/lessons/02-frames.mdx`]: sub('predict=outcome', 'choices="crash|prints 0"') }).result, 'ub-prediction')).toEqual([]);
    // also when UB is only expected on one compiler
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello expect.gcc=ub')).result, 'ub-prediction')).toHaveLength(1);
  });

  it('requires predict64 on platform samples and platform on predict64', () => {
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello platform')).result, 'platform-predict64')).toHaveLength(1);
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello platform predict64="what is sizeof(long)?"')).result, 'platform-predict64')).toEqual([]);
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello platform predict64=none reason="no difference"')).result, 'platform-predict64')).toEqual([]);
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello platform predict64=none')).result, 'platform-predict64')).toHaveLength(1);
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello predict64="q"')).result, 'platform-predict64')).toHaveLength(1);
  });

  it('keeps POSIX to M11, M13 and the capstone', () => {
    expect(errorsOf(lintGoodWith(withFence('id=fx-hello posix')).result, 'posix-scope')).toHaveLength(1);
    const define = sub('#include <stdio.h>\n\nint main(void) {\n    printf("Hello', '#define _POSIX_C_SOURCE 200809L\n#include <stdio.h>\n\nint main(void) {\n    printf("Hello');
    expect(errorsOf(lintGoodWith({ [lesson]: define }).result, 'posix-flag')).toHaveLength(1);
  });

  it('rejects id fences that are not kebab-case', () => {
    expect(errorsOf(lintGoodWith(withFence('id=Fx_Hello')).result, 'sample-id')).toHaveLength(1);
  });

  it('rejects upper-case languages, which would silently skip every check', () => {
    expect(errorsOf(lintGoodWith({ [lesson]: sub('```c id=fx-hello', '```C id=fx-hello') }).result, 'fence-lang')).toHaveLength(1);
  });

  it('rejects tool output typed into a terminal fence, and only there (show it with <Transcript>)', () => {
    // fixtures/good has a ```text fence with a program's own output, which passes.
    const withOutput = (lang: string, text: string) => lintGoodWith({ [lesson]: sub('```text\nHello\n```', `\`\`\`${lang}\n${text}\n\`\`\``) }).result;
    const markers = ["main.c:6:5: runtime error: signed integer overflow", '==1234== Invalid read of size 4', '==PID== HEAP SUMMARY:',
      "main.c:(.text+0x13): undefined reference to `area'", 'ERROR: AddressSanitizer: stack-buffer-overflow', '(gdb) bt', '(lldb) bt', 'make: *** [Makefile:2: credit] Error 1'];
    for (const text of markers) {
      const e = errorsOf(withOutput('text', text), 'hand-typed-output');
      expect(e, text).toHaveLength(1);
      expect(e[0].message).toContain('<Transcript');
    }
    for (const lang of ['', 'txt', 'console', 'sh', 'bash', 'shell']) expect(errorsOf(withOutput(lang, '(gdb) bt'), 'hand-typed-output'), lang || 'untagged').toHaveLength(1);
    // Other languages are not terminal text, and a fence without a marker is fine.
    expect(errorsOf(withOutput('yaml', '(gdb) bt'), 'hand-typed-output')).toEqual([]);
    expect(errorsOf(withOutput('console', '$ ./hello\nHello'), 'hand-typed-output')).toEqual([]);
    expect(errorsOf(withOutput('text', '== 3 =='), 'hand-typed-output')).toEqual([]);
  });

  it('keeps cards the same as the renderer: a fragment fence is not an interaction', () => {
    const r = lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: sub('```c id=fx-hello', '```c fragment') }).result;
    // card 1 now runs into the analogy and the next Choice: still two interactions fewer than before
    expect(r.lessons[0].cards).toBe(4);
  });
});

describe('analogies', () => {
  const lesson = `${M1}/lessons/01-hello.mdx`;
  const analogy = (props: string) => ({ [lesson]: (old: string) => old.replace(/<Analogy .*\/>/, `<Analogy ${props} />`) });

  it('needs js, c and breaksDown', () => {
    expect(errorsOf(lintGoodWith(analogy('c="x" breaksDown="Something that really differs in practice."')).result, 'analogy')[0].message).toContain('missing the `js` prop');
    expect(errorsOf(lintGoodWith(analogy('js="x" breaksDown="Something that really differs in practice."')).result, 'analogy')[0].message).toContain('missing the `c` prop');
    expect(errorsOf(lintGoodWith(analogy('js="x" c="y"')).result, 'analogy')[0].message).toContain('missing the `breaksDown` prop');
  });

  it('rejects an empty breakdown, whatever the way it is written', () => {
    for (const empty of ['breaksDown=""', 'breaksDown="   "', "breaksDown={''}", 'breaksDown={``}']) {
      expect(errorsOf(lintGoodWith(analogy(`js="x" c="y" ${empty}`)).result, 'analogy'), empty).toHaveLength(1);
    }
  });

  it('accepts expression props that are literals, and ignores ones it cannot evaluate', () => {
    expect(rules(lintGoodWith(analogy(`js="x" c={'y'} breaksDown={"A real difference that matters" + " in practice."}`)).result)).toEqual([]);
    expect(rules(lintGoodWith(analogy('js="x" c="y" breaksDown={someVariable}')).result)).toEqual([]);
  });

  it('flags "exactly" and "same" for review as a warning, not an error', () => {
    for (const word of ['exactly', 'same', 'The SAME thing']) {
      const r = lintGoodWith(analogy(`js="x" c="y" breaksDown="It behaves ${word} the way you would expect here."`)).result;
      expect(warningsOf(r, 'analogy-review'), word).toHaveLength(1);
      expect(r.errors).toBe(0);
    }
    // "sameness" or "exact" are other words
    expect(warningsOf(lintGoodWith(analogy('js="x" c="y" breaksDown="The sameness of types is an exact illusion in C."')).result, 'analogy-review')).toEqual([]);
  });
});

// ---- frontmatter and structure -----------------------------------------------------------------

describe('frontmatter', () => {
  const lesson = `${M1}/lessons/01-hello.mdx`;

  it('requires id, title, minutes and summary', () => {
    for (const key of ['id', 'title', 'minutes', 'summary']) {
      const r = lintGoodWith({ [lesson]: sub(new RegExp(`^${key}: .*\\n`, 'm'), '') }).result;
      expect(errorsOf(r, 'frontmatter', '01-hello.mdx').some(m => m.message.includes(`\`${key}\``)), key).toBe(true);
    }
  });

  it('needs minutes between 25 and 60', () => {
    for (const [m, bad] of [[24, true], [25, false], [60, false], [61, true]] as const) {
      const r = lintGoodWith({ [lesson]: sub('minutes: 30', `minutes: ${m}`) }).result;
      expect(errorsOf(r, 'lesson-minutes').length, `${m} minutes`).toBe(bad ? 1 : 0);
    }
    expect(errorsOf(lintGoodWith({ [lesson]: sub('minutes: 30', 'minutes: soon') }).result, 'frontmatter')[0].message).toContain('must be a number');
  });

  it('points at the line of the field', () => {
    const { result, dir } = lintGoodWith({ [lesson]: sub('minutes: 30', 'minutes: 90') });
    expect(errorsOf(result, 'lesson-minutes')[0].line).toBe(lineOf(path.join(dir, lesson), 'minutes: 90'));
  });

  it('requires a frontmatter block, and a mapping', () => {
    expect(errorsOf(lintGoodWith({ [lesson]: sub(/^---[\s\S]*?---\n/, '') }).result, 'frontmatter')).toHaveLength(1);
    expect(errorsOf(lintGoodWith({ [lesson]: sub(/^---[\s\S]*?---\n/, '---\n- a\n- b\n---\n') }).result, 'frontmatter')[0].message).toContain('mapping');
    expect(errorsOf(lintGoodWith({ [lesson]: sub('minutes: 30', 'minutes: [') }).result, 'frontmatter')[0].message).toContain('YAML error');
  });

  it('keeps lesson ids unique across the course', () => {
    const r = lintGoodWith({ [`${M2}/lessons/01-video.mdx`]: sub('id: m02-l1', 'id: m01-l1') }).result;
    expect(errorsOf(r, 'lesson-id')).toHaveLength(1);
  });

  it('warns about unknown keys and ids that do not start with the module', () => {
    expect(warningsOf(lintGoodWith({ [lesson]: sub('minutes: 30', 'minutes: 30\ndraft: true') }).result, 'frontmatter')).toHaveLength(1);
    expect(warningsOf(lintGoodWith({ [lesson]: sub('id: m01-l1', 'id: lesson-one') }).result, 'lesson-id')).toHaveLength(1);
    expect(warningsOf(lintGoodWith({ [lesson]: sub('id: m01-l1', 'id: m01-l1-hello-compiled') }).result, 'lesson-id')).toEqual([]);
  });

  it('warns when a lesson has fewer than 2 or more than 14 cards', () => {
    const one = lintGoodWith({ [`${M2}/lessons/01-video.mdx`]: sub(/<YouTube[\s\S]*?\/>\n\n<Choice[\s\S]*?\/>\n\n\*\*Next/, '**Next') }).result;
    expect(warningsOf(one, 'card-count')[0].message).toContain('1 card');
    // the lesson has 2 cards; every extra <Choice> adds one
    const choices = Array.from({ length: 13 }, () => '<Choice question="Q" options={["a", "b"]} answer={0} explain="x" />').join('\n\n');
    const many = lintGoodWith({ [`${M2}/lessons/01-video.mdx`]: sub('**Next:**', `${choices}\n\n**Next:**`) }).result;
    expect(warningsOf(many, 'card-count')[0].message).toContain('15 cards');
    const fourteen = Array.from({ length: 12 }, () => '<Choice question="Q" options={["a", "b"]} answer={0} explain="x" />').join('\n\n');
    expect(warningsOf(lintGoodWith({ [`${M2}/lessons/01-video.mdx`]: sub('**Next:**', `${fourteen}\n\n**Next:**`) }).result, 'card-count')).toEqual([]);
  });

  it('reports MDX that does not parse, with its line', () => {
    const { result, dir } = lintGoodWith({ [lesson]: old => `${old}\n<Choice question="never closed"\n` });
    const e = errorsOf(result, 'mdx-parse');
    expect(e).toHaveLength(1);
    expect(e[0].line).toBe(readFileSync(path.join(dir, lesson), 'utf8').split('\n').length);
    // and nothing else is said about a lesson that did not parse
    expect(result.messages.filter(m => m.file.endsWith('01-hello.mdx'))).toEqual([e[0]]);
  });
});

// ---- references --------------------------------------------------------------------------------

describe('references', () => {
  const frames = `${M1}/lessons/02-frames.mdx`;

  it('finds exercises under the module', () => {
    expect(errorsOf(lintGoodWith({ [frames]: sub('<Exercise id="write-sum" />', '<Exercise id="nope" />') }).result, 'exercise-ref')[0].message)
      .toContain('content/modules/m01-basics/exercises/nope/exercise.yaml');
    // an exercise of another module is not usable
    const other = lintGoodWith({ [frames]: sub('<Exercise id="write-sum" />', '<Exercise id="m2-write" />') }).result;
    expect(errorsOf(other, 'exercise-ref')[0].message).toContain('exists in m02-more');
    // variants and projects can be addressed by their keys
    const variant = lintGoodWith({ [frames]: sub('<Exercise id="write-sum" />', '<Exercise id="write-sum/variants/1" />') }).result;
    expect(errorsOf(variant, 'exercise-ref')).toEqual([]);
    expect(errorsOf(lintGoodWith({ [frames]: sub('<Exercise id="write-sum" />', '<Exercise id="project/p1-greet" />') }).result, 'exercise-ref')).toEqual([]);
    expect(errorsOf(lintGoodWith({ [frames]: sub('<Exercise id="write-sum" />', '<Exercise />') }).result, 'exercise-ref')[0].message).toContain('missing the `id` prop');
  });

  it('checks the exercise prop of other components', () => {
    expect(errorsOf(lintGoodWith({ [frames]: sub('<NumberDrill value={42} from="dec" to="bin" width={8} />', '<NumberDrill exercise="gone" />') }).result, 'exercise-ref')).toHaveLength(1);
    expect(errorsOf(lintGoodWith({ [frames]: sub('<NumberDrill value={42} from="dec" to="bin" width={8} />', '<NumberDrill exercise="write-sum" />') }).result, 'exercise-ref')).toEqual([]);
  });

  it('resolves sample references within the module, for Stepper and MemoryDiagram', () => {
    const r = lintGoodWith({ [frames]: sub('<MemoryDiagram sample="fx-frames"', '<MemoryDiagram sample="fx-nothing"') }).result;
    expect(errorsOf(r, 'sample-ref')).toHaveLength(1);
    const elsewhere = lintGoodWith({ [frames]: sub('<MemoryDiagram sample="fx-frames"', '<MemoryDiagram sample="fx-two-plus-two"') }).result;
    expect(errorsOf(elsewhere, 'sample-ref')[0].message).toContain('defined in m02');
    const stepper = lintGoodWith({
      [frames]: old => sub('<MemoryDiagram sample="fx-frames"', '<MemoryDiagram sample="fx-cp-frames"')(sub(/<Stepper>[\s\S]*?<\/Stepper>/, '<Stepper sample="fx-cp-frames" />')(old)),
    }).result;
    expect(errorsOf(stepper, 'sample-ref')).toEqual([]); // fx-cp-frames is a quiz sample with a trace
    const missing = lintGoodWith({
      [frames]: old => sub('<MemoryDiagram sample="fx-frames"', '<MemoryDiagram sample="fx-cp-frames"')(sub(/<Stepper>[\s\S]*?<\/Stepper>/, '<Stepper sample="ghost" />')(old)),
    }).result;
    expect(errorsOf(missing, 'sample-ref')).toHaveLength(1);
  });

  it('accepts samples defined by quiz items', () => {
    const r = lintGoodWith({ [frames]: sub('<MemoryDiagram sample="fx-frames"', '<MemoryDiagram sample="fx-cp-frames"') }).result;
    expect(errorsOf(r, 'sample-ref')).toEqual([]);
  });

  it('checks hand-written <CodeSample sample="…"> and refuses one with no program', () => {
    const lesson = `${M1}/lessons/01-hello.mdx`;
    const add = (el: string) => ({ [lesson]: sub('**What you know now:**', `${el}\n\n**What you know now:**`) });
    expect(errorsOf(lintGoodWith(add('<CodeSample sample="fx-hello" />')).result, 'sample-ref')).toEqual([]);
    expect(errorsOf(lintGoodWith(add('<CodeSample sample="fx-ghost" />')).result, 'sample-ref')).toHaveLength(1);
    expect(errorsOf(lintGoodWith(add('<CodeSample id="fx-hello" />')).result, 'sample-ref')[0].message).toContain('generated from a ```c fence');
  });

  it('requires a trace on samples used by Stepper and MemoryDiagram', () => {
    const noTrace = lintGoodWith({ [frames]: sub('```c id=fx-frames trace predict=none', '```c id=fx-frames predict=none') }).result;
    expect(errorsOf(noTrace, 'sample-trace').length).toBeGreaterThanOrEqual(2); // the Stepper's fence and the MemoryDiagram that uses it
  });

  it('checks <Animation id> against animations/ and public/animations/', () => {
    const lesson = `${M1}/lessons/01-hello.mdx`;
    const ghost = lintGoodWith({ [lesson]: sub('<Animation id="a01-demo" />', '<Animation id="a99-ghost" />') }).result;
    expect(errorsOf(ghost, 'animation-asset')[0].message).toContain('no HyperFrames project animations/a99-ghost/');
    const unrendered = lintGoodWith({
      [lesson]: sub('<Animation id="a01-demo" />', '<Animation id="a02-new" />'),
      'animations/a02-new/index.html': '<!doctype html>\n',
    }).result;
    expect(errorsOf(unrendered, 'animation-asset')).toEqual([]);
    expect(warningsOf(unrendered, 'animation-asset')[0].message).toContain('not rendered yet');
    const rendered = lintGoodWith({ 'public/animations/a01-demo/steps.json': null }).result;
    expect(rendered.messages.filter(m => m.rule === 'animation-asset').map(m => m.severity)).toEqual(['error']);
  });

  it('checks <YouTube video> against videos.json', () => {
    const lesson = `${M2}/lessons/01-video.mdx`;
    expect(errorsOf(lintGoodWith({ [lesson]: sub('video="yt-1"', 'video="yt-9"') }).result, 'video-ref')[0].message).toContain('known keys: yt-1');
    expect(errorsOf(lintGoodWith({ 'videos.json': null }).result, 'video-ref')[0].message).toContain('missing or unreadable');
    expect(errorsOf(lintGoodWith({ 'videos.json': '{oops' }).result, 'videos-json')).toHaveLength(1);
    expect(errorsOf(lintGoodWith({ 'videos.json': '{}' }).result, 'videos-json')[0].message).toContain('array');
    // a video registered for another module is only a warning
    const wrongModule = lintGoodWith({ 'videos.json': sub('"module": "m02"', '"module": "m03"') }).result;
    expect(warningsOf(wrongModule, 'video-ref')).toHaveLength(1);
    expect(wrongModule.errors).toBe(0);
  });

  it('allows at most 2 distinct videos per module', () => {
    const videos = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ key: `yt-${i + 1}`, id: 'SlqjA04_dpk', module: 'm02' })));
    const clip = (k: number) => `<YouTube video="yt-${k}" />\n\n<Choice question="Q" options={["a", "b"]} answer={0} explain="x" />\n\n`;
    const lesson = `${M2}/lessons/01-video.mdx`;
    const two = lintGoodWith({ 'videos.json': videos(3), [lesson]: sub('<YouTube video="yt-1" />', '<YouTube video="yt-1" />\n\n<Choice question="Q" options={["a", "b"]} answer={0} explain="x" />\n\n<YouTube video="yt-2" />') }).result;
    expect(errorsOf(two, 'video-limit')).toEqual([]);
    const three = lintGoodWith({
      'videos.json': videos(3),
      [lesson]: sub('<YouTube video="yt-1" />\n\n', `${clip(1)}${clip(2)}${clip(3)}<YouTube video="yt-1" />\n\n`),
    }).result;
    expect(errorsOf(three, 'video-limit')).toHaveLength(1);
    expect(errorsOf(three, 'video-limit')[0].message).toContain('3 different videos');
    // the same clip twice is still one video
    const same = lintGoodWith({ [lesson]: sub('<YouTube video="yt-1" />\n\n', `${clip(1)}${clip(1)}${clip(1)}<YouTube video="yt-1" />\n\n`) }).result;
    expect(errorsOf(same, 'video-limit')).toEqual([]);
  });

  it('warns about unknown components', () => {
    expect(warningsOf(lintGoodWith({ [`${M1}/lessons/01-hello.mdx`]: sub('**What you know now:**', '<Choise />\n\n**What you know now:**') }).result, 'unknown-component')[0].message).toContain('<Choise>');
  });
});

describe('component props', () => {
  const lesson = `${M1}/lessons/01-hello.mdx`;
  const choice = (props: string) => ({ [lesson]: sub(/<Choice\n {2}question="What does `return 0;`[\s\S]*?\/>/, `<Choice ${props} />`) });

  it('checks Choice: options, answer and explain', () => {
    expect(errorsOf(lintGoodWith(choice('question="Q" options={["a", "b"]} answer={2} explain="x"')).result, 'interaction-props')[0].message).toContain('index into `options` (0-1)');
    expect(errorsOf(lintGoodWith(choice('question="Q" options={["a"]} answer={0} explain="x"')).result, 'interaction-props')[0].message).toContain('at least two');
    expect(errorsOf(lintGoodWith(choice('question="Q" options={["a", "a"]} answer={0} explain="x"')).result, 'interaction-props')[0].message).toContain('duplicate');
    expect(errorsOf(lintGoodWith(choice('question="Q" options={["a", "b"]} answer="1" explain="x"')).result, 'interaction-props')[0].message).toContain('must be a number');
    expect(errorsOf(lintGoodWith(choice('question="Q" options={["a", "b"]} explain="x"')).result, 'interaction-props')[0].message).toContain('missing the `answer` prop');
    expect(errorsOf(lintGoodWith(choice('options={["a", "b"]} answer={0} explain="x"')).result, 'interaction-props')[0].message).toContain('missing the `question` prop');
    expect(warningsOf(lintGoodWith(choice('question="Q" options={["a", "b"]} answer={0}')).result, 'interaction-props')[0].message).toContain('no `explain`');
    expect(lintGoodWith(choice('question="Q" options={["a", "b"]} answer={0} explain="x"')).result.messages).toEqual([]);
  });

  it('checks a CompilerError that reads a session report: fix says how the browser checks it, stage is a build stage', () => {
    const ce = (props: string) => ({ [lesson]: sub(/<Choice\n {2}question="What does `return 0;`[\s\S]*?\/>/, `<CompilerError session="asan" question="Q" options={["a", "b"]} answer={0} explain="x" ${props} />`) });
    expect(lintGoodWith(ce('stage="run" fix={false}')).result.messages).toEqual([]);
    const withFence = (props: string, meta: string) => ({ [lesson]: sub(/<Choice\n {2}question="What does `return 0;`[\s\S]*?\/>/, `<CompilerError session="asan" question="Q" options={["a", "b"]} answer={0} explain="x" ${props}>\n\n\`\`\`c id=fx-session-fixed ${meta}\n#include <stdio.h>\n\nint main(void) {\n    puts("ok");\n    return 0;\n}\n\`\`\`\n\n</CompilerError>`) });
    expect(lintGoodWith(withFence('fix="leak"', 'predict=none')).result.messages).toEqual([]);
    expect(errorsOf(lintGoodWith(ce('fix="leak"')).result, 'interaction-props')[0].message).toContain('needs exactly one nested ```c fence');
    expect(errorsOf(lintGoodWith(withFence('fix={false}', 'predict=none')).result, 'interaction-props')[0].message).toContain('remove the nested fence');
    expect(errorsOf(lintGoodWith(withFence('fix="compile"', 'expect=compile-error')).result, 'interaction-props')[0].message).toContain('is the fixed version');
    expect(errorsOf(lintGoodWith(ce('stage="run"')).result, 'interaction-props')[0].message).toContain('needs `fix`');
    expect(errorsOf(lintGoodWith(ce('fix={true}')).result, 'interaction-props')[0].message).toContain('`fix` must be "compile", "ubsan", "leak" or {false}');
    expect(errorsOf(lintGoodWith(ce('stage="linking" fix={false}')).result, 'interaction-props')[0].message).toContain('`stage` must be one of preprocess, compile, assemble, link, run');
  });

  it('checks stage="link" against the stored report: it must be a linker\'s', () => {
    // tools/verify's real output for the m97 fixture sessions, stored as this fixture module's sessions file.
    const stored = { 'src/generated/sessions/m01.json': readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8') };
    const ce = (props: string) => ({ ...stored, [lesson]: sub(/<Choice\n {2}question="What does `return 0;`[\s\S]*?\/>/, `<CompilerError ${props} question="Q" options={["a", "b"]} answer={0} explain="x" fix={false} />`) });
    expect(lintGoodWith(ce('session="link-undefined" step={2} stage="link"')).result.messages).toEqual([]);
    expect(lintGoodWith(ce('session="link-multiple" stage="link"')).result.messages).toEqual([]);
    // An ASan report, and link-undefined's first step (the compile, which succeeds), are not a linker's.
    expect(errorsOf(lintGoodWith(ce('session="asan" stage="link"')).result, 'interaction-props')[0].message).toContain('the stored linux-gcc and linux-clang report is not a linker\'s');
    expect(errorsOf(lintGoodWith(ce('session="link-undefined" step={1} stage="link"')).result, 'interaction-props')[0].message).toContain('at step 1 is not a linker\'s');
  });

  it('does not judge props it cannot evaluate, or elements that spread props', () => {
    expect(lintGoodWith(choice('question={q} options={opts} answer={n} explain={e}')).result.messages).toEqual([]);
    expect(lintGoodWith(choice('{...props}')).result.messages).toEqual([]);
  });

  it('needs a program in CompilerError that produces a message', () => {
    const noMessage = lintGoodWith({ [lesson]: sub('```c id=fx-missing-semicolon expect=compile-error', '```c id=fx-missing-semicolon') }).result;
    expect(errorsOf(noMessage, 'interaction-props')[0].message).toContain('expect=compile-error or expect=warning');
    const warns = lintGoodWith({ [lesson]: sub('```c id=fx-missing-semicolon expect=compile-error', '```c id=fx-missing-semicolon warn=-Wformat') }).result;
    expect(errorsOf(warns, 'interaction-props')).toEqual([]);
    const none = lintGoodWith({ [lesson]: sub(/```c id=fx-missing-semicolon expect=compile-error[\s\S]*?<\/CompilerError>/, '</CompilerError>') }).result;
    expect(errorsOf(none, 'interaction-props')[0].message).toContain('needs a nested');
  });

  it('checks MemoryDiagram ask and NumberDrill bases', () => {
    const frames = `${M1}/lessons/02-frames.mdx`;
    expect(errorsOf(lintGoodWith({ [frames]: sub(`ask={['add.a', 'add.b', 'add.sum']}`, 'ask={[]}') }).result, 'interaction-props')[0].message).toContain('non-empty array');
    expect(errorsOf(lintGoodWith({ [frames]: sub(` ask={['add.a', 'add.b', 'add.sum']}`, '') }).result, 'interaction-props')[0].message).toContain('needs `ask`');
    expect(errorsOf(lintGoodWith({ [frames]: sub('to="bin"', 'to="dec"') }).result, 'interaction-props')[0].message).toContain('same');
    expect(errorsOf(lintGoodWith({ [frames]: sub('to="bin"', 'to="oct"') }).result, 'interaction-props')[0].message).toContain('dec, bin or hex');
    expect(errorsOf(lintGoodWith({ [frames]: sub('width={8}', 'width={12}') }).result, 'interaction-props')[0].message).toContain('8, 16, 32 or 64');
  });
});

describe('NumberDrill kind="float"', () => {
  const frames = `${M1}/lessons/02-frames.mdx`;
  const drill = '<NumberDrill value={42} from="dec" to="bin" width={8} />';
  const msgs = (tag: string) => errorsOf(lintGoodWith({ [frames]: sub(drill, tag) }).result, 'interaction-props').map(m => m.message);
  it('accepts a decode and an encode with exact values', () => {
    expect(msgs('<NumberDrill kind="float" value="0x3F800000" from="hex" to="dec" />')).toEqual([]);
    expect(msgs('<NumberDrill kind="float" value={-2.5} from="dec" to="hex" />')).toEqual([]);
  });
  it('rejects an unknown kind, a width other than 32, and base pairs that are not decode or encode', () => {
    expect(msgs('<NumberDrill kind="double" value={1} />')[0]).toContain('int or float');
    expect(msgs('<NumberDrill kind="float" value="0x3F800000" from="hex" to="dec" width={64} />')[0]).toContain('32-bit');
    expect(msgs('<NumberDrill kind="float" value="0x3F800000" from="hex" to="bin" />')[0]).toContain('decodes');
  });
  it('rejects a decode value that is not 0x plus 8 hex digits, or whose decimal answer is not exact (0.1f)', () => {
    expect(msgs('<NumberDrill kind="float" value="0x3F8" from="hex" to="dec" />')[0]).toContain('8 hex digits');
    expect(msgs('<NumberDrill kind="float" value="0x3DCCCCCD" from="hex" to="dec" />')[0]).toContain('no exact short decimal');
    expect(msgs('<NumberDrill kind="float" value={1} from="hex" to="dec" />')[0]).toContain('is a string');
  });
  it('rejects an encode value that is not a float exactly (0.1)', () => {
    expect(msgs('<NumberDrill kind="float" value={0.1} from="dec" to="hex" />')[0]).toContain('not exactly a float');
    expect(msgs('<NumberDrill kind="float" value="0.5" from="dec" to="hex" />')[0]).toContain('is a number');
  });
});

// ---- module.yaml -------------------------------------------------------------------------------

describe('module.yaml', () => {
  const file = `${M1}/module.yaml`;
  const msgs = (edits: Record<string, Edit>) => lintGoodWith(edits).result;

  it('requires every ModuleMeta field', () => {
    for (const key of ['title', 'why', 'hours', 'weeks', 'time', 'lessonsRunIn', 'projectRunsIn', 'successCriteria', 'resources', 'lessons', 'problemSet', 'project', 'coreExercises', 'retrieval']) {
      // drop the key and its indented block
      const r = msgs({ [file]: sub(new RegExp(`^${key}:.*\\n(?: +.*\\n)*`, 'm'), '') });
      expect(errorsOf(r, 'module-yaml').some(m => m.message.includes(`missing \`${key}\``)), key).toBe(true);
    }
  });

  it('checks that the time breakdown sums to hours within 0.1', () => {
    const edit = (lessons: number) => msgs({ [file]: sub('lessons: 1,', `lessons: ${lessons},`) });
    expect(errorsOf(edit(1), 'module-time')).toEqual([]);
    expect(errorsOf(edit(1.1), 'module-time')).toEqual([]);
    expect(errorsOf(edit(1.2), 'module-time')).toHaveLength(1);
    expect(errorsOf(edit(0.9), 'module-time')).toEqual([]);
    expect(errorsOf(edit(0.8), 'module-time')[0].message).toContain('adds up to 9.8 h but `hours` is 10');
    expect(errorsOf(msgs({ [file]: sub('time: { lessons: 1, problemSet: 5, project: 2, variants: 1, quizCheckpoint: 1 }', 'time: { lessons: 1 }') }), 'module-yaml').length).toBe(3);
  });

  it('allows at most 2 resources, each with a detail', () => {
    const three = msgs({ [file]: sub('lessons:\n  - 01-hello', `  - title: "A third"\n    detail: "Chapter 9"\nlessons:\n  - 01-hello`) });
    expect(errorsOf(three, 'module-resources')[0].message).toContain('3 outside resources');
    const empty = msgs({ [file]: sub('detail: \'Chapter 2 "Hello, World!"\'', 'detail: ""') });
    expect(errorsOf(empty, 'module-resources')[0].message).toContain('non-empty `detail`');
    const blank = msgs({ [file]: sub('detail: "Chapter 1, sections 1.1-1.3"', 'detail: "   "') });
    expect(errorsOf(blank, 'module-resources')).toHaveLength(1);
    expect(errorsOf(msgs({ [file]: sub('url: https://beej.us/guide/bgc/html/split/', 'url: beej.us') }), 'module-resources')).toHaveLength(1);
  });

  it('needs listed lessons to exist, and warns about unlisted ones', () => {
    expect(errorsOf(msgs({ [file]: sub('  - 02-frames', '  - 02-frames\n  - 03-ghost') }), 'module-lesson')[0].message).toContain('03-ghost.mdx does not exist');
    expect(warningsOf(msgs({ [file]: sub('  - 02-frames\n', '') }), 'module-lesson')[0].message).toContain('02-frames.mdx exists but is not listed');
  });

  it('needs problemSet and coreExercises to exist', () => {
    expect(errorsOf(msgs({ [file]: sub('  - write-sum\nproject', '  - write-sum\n  - ghost\nproject') }), 'module-exercise')[0].message).toContain('problemSet lists exercise "ghost"');
    expect(errorsOf(msgs({ [file]: sub('  - fix-bug', '  - ghost') }), 'module-exercise')[0].message).toContain('coreExercises lists exercise "ghost"');
  });

  it('needs the project folder with check.json, project.mdx and exercise.yaml', () => {
    expect(errorsOf(msgs({ [file]: sub('project: p1-greet', 'project: nowhere') }), 'module-project')[0].message).toContain('does not exist');
    expect(errorsOf(msgs({ [`${M1}/project/p1-greet/check.json`]: null }), 'module-project')[0].message).toContain('no check.json');
    expect(errorsOf(msgs({ [`${M1}/project/p1-greet/project.mdx`]: null }), 'module-project')[0].message).toContain('no project.mdx');
    expect(errorsOf(msgs({ [`${M1}/project/p1-greet/exercise.yaml`]: null }), 'module-project')[0].message).toContain('no exercise.yaml');
  });

  it('checks id, number, runs-in values and success criteria', () => {
    expect(errorsOf(msgs({ [file]: sub('id: m01', 'id: m07') }), 'module-yaml')[0].message).toContain('does not match the directory');
    expect(errorsOf(msgs({ [file]: sub('number: 1', 'number: 4') }), 'module-yaml')[0].message).toContain('number 4');
    expect(errorsOf(msgs({ [file]: sub('lessonsRunIn: browser', 'lessonsRunIn: cloud') }), 'module-yaml')[0].message).toContain('browser, native or both');
    expect(errorsOf(msgs({ [file]: sub('level: D', 'level: Z') }), 'module-yaml')[0].message).toContain('I (introduced)');
    expect(errorsOf(msgs({ [file]: sub('sc: SC2', 'sc: SC1') }), 'module-yaml')[0].message).toContain('SC1 is listed twice');
  });

  it('warns when weeks disagree with hours per week, and about unknown fields', () => {
    expect(warningsOf(msgs({ [file]: sub('weeks: 2', 'weeks: 3') }), 'module-time')[0].message).toContain('2.0 weeks');
    expect(warningsOf(msgs({ [file]: sub('weeks: 2', 'weeks: 2.1') }), 'module-time')).toEqual([]);
    expect(warningsOf(msgs({ [file]: sub('weeks: 2', 'weeks: 2\nmood: sunny') }), 'module-yaml')[0].message).toContain('"mood"');
  });

  it('warns when lesson minutes disagree with time.lessons, and about unused exercises', () => {
    expect(warningsOf(msgs({ [file]: sub('lessons: 1, problemSet: 5', 'lessons: 3, problemSet: 3') }), 'module-time')[0].message).toContain('lesson minutes add up to 1.0 h');
    expect(warningsOf(msgs({ [`${M1}/exercises/spare/exercise.yaml`]: 'id: spare\nkind: ct\nvariants: []\n' }), 'exercise-unused')).toHaveLength(1);
  });

  it('warns about core exercises without variants', () => {
    const r = msgs({ [`${M1}/exercises/fix-bug/exercise.yaml`]: sub("variants: ['1']", 'variants: []') });
    expect(warningsOf(r, 'module-exercise')[0].message).toContain('"fix-bug" has no variants');
  });

  it('reports YAML syntax errors with a line', () => {
    const r = msgs({ [file]: sub('hours: 10', 'hours: [10') });
    expect(errorsOf(r, 'yaml-syntax').length).toBeGreaterThan(0);
  });

  it('needs retrieval and checkpoint quiz files', () => {
    expect(errorsOf(msgs({ [`${M1}/quizzes/checkpoint.yaml`]: null }), 'quiz-missing')).toHaveLength(1);
    expect(errorsOf(msgs({ [`${M1}/quizzes/retrieval.yaml`]: null }), 'quiz-missing')).toHaveLength(1);
  });
});

describe('course.yaml', () => {
  const file = 'content/course.yaml';

  it('matches the module directories and module.yaml', () => {
    expect(errorsOf(lintGoodWith({ [file]: null }).result, 'course-yaml')[0].message).toContain('course.yaml is missing');
    expect(errorsOf(lintGoodWith({ [file]: sub('hours: 10', 'hours: 12') }).result, 'course-yaml')[0].message).toContain('hours is 12 here but 10 in module.yaml');
    expect(errorsOf(lintGoodWith({ [file]: sub('dir: m02-more', 'dir: m02-other') }).result, 'course-yaml')[0].message).toContain('dir is "m02-other"');
    expect(errorsOf(lintGoodWith({ [file]: sub(/ {2}- \{ id: m02.*\n/, '') }).result, 'course-yaml')[0].message).toContain('not listed in course.yaml');
    expect(errorsOf(lintGoodWith({ [file]: sub('id: m02,', 'id: m05,') }).result, 'course-yaml').length).toBeGreaterThan(0);
    const draft = lintGoodWith({ [file]: sub('hours: 5, available: true', 'hours: 5, available: false') }).result;
    expect(infosOf(draft, 'course-yaml')[0].message).toContain('is a draft');
    expect(warningsOf(draft, 'course-yaml')).toEqual([]);
    expect(warningsOf(lintGoodWith({ [file]: sub('title: "Basics"', 'title: "Other"') }).result, 'course-yaml')[0].message).toContain('title differs');
  });
});

// ---- draft modules (course.yaml available: false) ------------------------------------------------

describe('draft modules', () => {
  const course = 'content/course.yaml';
  const m2yaml = `${M2}/module.yaml`;
  /** m02 as a half-built module: unreleased, no quizzes, no project, a listed core exercise that is not written yet, too few lessons for its hours. */
  const half: Record<string, Edit> = {
    [`${M2}/quizzes/checkpoint.yaml`]: null,
    [`${M2}/quizzes/retrieval.yaml`]: null,
    [`${M2}/project/p2-count/check.json`]: null,
    [`${M2}/project/p2-count/project.mdx`]: null,
    [`${M2}/project/p2-count/exercise.yaml`]: null,
    [`${M2}/exercises/m2-fix/exercise.yaml`]: null, // only the deleted checkpoint used it
    [m2yaml]: old => sub('  - m2-write', '  - m2-write\n  - m2-ghost')(sub('time: { lessons: 1, project: 2, variants: 1, quizCheckpoint: 1 }', 'time: { lessons: 3, project: 1, variants: 0.5, quizCheckpoint: 0.5 }')(old)),
  };
  const unreleased: Record<string, Edit> = { [course]: sub('hours: 5, available: true', 'hours: 5, available: false') };
  const COMPLETENESS = ['module-exercise', 'module-project', 'module-time', 'quiz-missing'];

  it('reports what a released module is missing as errors and warnings', () => {
    const r = lintGoodWith(half).result;
    expect(COMPLETENESS.map(rule => hits(r, rule).length > 0)).toEqual([true, true, true, true]);
    expect(r.errors).toBeGreaterThan(0);
    expect(errorsOf(r, 'quiz-missing')).toHaveLength(2);
    expect(errorsOf(r, 'module-project')).toHaveLength(3);
    expect(warningsOf(r, 'module-time')).toHaveLength(1);
  });

  it('reports the same gaps as notes for an unreleased module, and --strict passes', () => {
    const r = lintGoodWith({ ...half, ...unreleased }).result;
    expect(r.messages.filter(m => m.severity !== 'info')).toEqual([]);
    expect([r.errors, r.warnings]).toEqual([0, 0]);
    expect(exitCode(r, true)).toBe(0);
    for (const rule of COMPLETENESS) expect(infosOf(r, rule).length, rule).toBeGreaterThan(0);
    expect(infosOf(r, 'quiz-missing')).toHaveLength(2);
    expect(infosOf(r, 'module-project')).toHaveLength(3);
    expect(infosOf(r, 'course-yaml')[0].message).toContain('is a draft');
    expect(r.infos).toBe(r.messages.length);
  });

  it('reports a core exercise with no variants as a note in a draft, and as a warning in a released module', () => {
    const noVariants: Record<string, Edit> = { [`${M2}/exercises/m2-write/exercise.yaml`]: sub("variants: ['1']", 'variants: []') };
    const released = lintGoodWith(noVariants).result;
    expect(warningsOf(released, 'module-exercise')[0].message).toContain('"m2-write" has no variants');
    const draft = lintGoodWith({ ...noVariants, ...unreleased }).result;
    expect(infosOf(draft, 'module-exercise')[0].message).toContain('"m2-write" has no variants');
    expect(warningsOf(draft, 'module-exercise')).toEqual([]);
    expect(exitCode(draft, true)).toBe(0);
  });

  it('keeps every rule on a file that exists: a broken lesson in a draft is still an error', () => {
    const lesson = `${M2}/lessons/02-posix-free.mdx`;
    const r = lintGoodWith({ ...half, ...unreleased, [lesson]: sub('Predict the output.', words(251)) }).result;
    expect(errorsOf(r, 'word-budget', '02-posix-free.mdx')).toHaveLength(1);
    expect(r.errors).toBe(1);
    expect(exitCode(r, true)).toBe(1);
    expect(exitCode(r, false)).toBe(1);
  });

  it('still reports a listed lesson that has no file, and a bad module.yaml field', () => {
    const missing = lintGoodWith({ ...half, ...unreleased, [m2yaml]: sub('  - 02-posix-free', '  - 02-posix-free\n  - 03-not-written') }).result;
    expect(errorsOf(missing, 'module-lesson')[0].message).toContain('03-not-written');
    const bad = lintGoodWith({ ...half, ...unreleased, [m2yaml]: sub('lessonsRunIn: browser', 'lessonsRunIn: sometimes') }).result;
    expect(errorsOf(bad, 'module-yaml')).toHaveLength(1);
  });

  it('does not excuse a module that course.yaml does not list: it is not a draft, so its gaps stay errors', () => {
    // m02 is taken out of course.yaml (not marked unreleased), with the same gaps as the draft above.
    const r = lintGoodWith({ ...half, [course]: sub(/ {2}- \{ id: m02.*\n/, '') }).result;
    expect(errorsOf(r, 'course-yaml')[0].message).toContain('not listed in course.yaml');
    expect(errorsOf(r, 'quiz-missing')).toHaveLength(2);
    expect(errorsOf(r, 'module-project')).toHaveLength(3);
    expect(r.infos).toBe(0);
  });

  it('prints notes apart from errors and warnings (a clean draft is still "All good"), and --errors-only hides them', () => {
    const { result } = lintGoodWith({ ...half, ...unreleased });
    const text = renderReport(result, process.cwd());
    expect(text).toMatch(/m02-more \(0 errors, 0 warnings, \d+ notes\)/);
    expect(text).toMatch(/All good: .*; \d+ notes on unreleased modules\./);
    expect(text).toContain('info');
    const quiet = renderReport(result, process.cwd(), true);
    expect(quiet).toMatch(/All good: [^;]*\.$/);
    expect(quiet).not.toContain('info');
  });
});

describe('duplicate exercise ids (the app keys exercises by folder name across modules)', () => {
  const copyOf = (rel: string) => readFileSync(path.join(GOOD, rel), 'utf8');

  it('reports an exercise folder that another module already uses, naming both', () => {
    const { result } = lintGoodWith({ [`${M2}/exercises/fix-bug/exercise.yaml`]: copyOf(`${M1}/exercises/fix-bug/exercise.yaml`) });
    const dup = errorsOf(result, 'duplicate-exercise');
    expect(dup).toHaveLength(1);
    expect(dup[0].file).toContain('m02-more');
    expect(dup[0].message).toContain('"fix-bug"');
    expect(dup[0].message).toContain('also in m01-basics');
  });

  it('reports a project id two modules share', () => {
    const { result } = lintGoodWith({ [`${M2}/project/p1-greet/exercise.yaml`]: copyOf(`${M1}/project/p1-greet/exercise.yaml`) });
    expect(errorsOf(result, 'duplicate-exercise')[0].message).toContain('"project/p1-greet"');
  });

  it('applies to an unreleased module too, which is the point: it must not replace a released exercise', () => {
    const { result } = lintGoodWith({
      'content/course.yaml': sub('hours: 5, available: true', 'hours: 5, available: false'),
      [`${M2}/exercises/fix-bug/exercise.yaml`]: copyOf(`${M1}/exercises/fix-bug/exercise.yaml`),
    });
    expect(errorsOf(result, 'duplicate-exercise')).toHaveLength(1);
  });

  it('blames the module that comes later in the course, not the one that sorts later by directory name (cap- sorts before m01-)', () => {
    const { result } = lintGoodWith({
      'content/course.yaml': old => `${old}  - { id: cap, dir: cap-final, number: cap, title: "Capstone", hours: 5, available: false }\n`,
      'content/modules/cap-final/exercises/fix-bug/exercise.yaml': copyOf(`${M1}/exercises/fix-bug/exercise.yaml`),
    });
    const dup = errorsOf(result, 'duplicate-exercise');
    expect(dup).toHaveLength(1);
    expect(dup[0].file).toContain('cap-final');
    expect(dup[0].message).toContain('also in m01-basics');
    expect(dup[0].module).toBe('cap');
  });

  it('counts a variant with its exercise, not again', () => {
    const { result } = lintGoodWith({
      [`${M2}/exercises/fix-bug/exercise.yaml`]: copyOf(`${M1}/exercises/fix-bug/exercise.yaml`),
      [`${M2}/exercises/fix-bug/variants/1/exercise.yaml`]: copyOf(`${M1}/exercises/fix-bug/variants/1/exercise.yaml`),
    });
    expect(errorsOf(result, 'duplicate-exercise')).toHaveLength(1);
  });
});

// ---- quizzes -----------------------------------------------------------------------------------

describe('checkpoint composition (PLAN §2.5)', () => {
  const file = `${M1}/quizzes/checkpoint.yaml`;
  /** Removes the item with this id (an item runs from its "- id:" line to the next one). */
  const without = (...ids: string[]) => (old: string) => {
    let out = old;
    for (const id of ids) {
      const re = new RegExp(`- id: ${id}\\n(?:(?!- id: ).*\\n?)*`);
      if (!re.test(out)) throw new Error(`test setup: ${id} not found`);
      out = out.replace(re, '');
    }
    return out;
  };
  const composition = (edit: Edit) => errorsOf(lintGoodWith({ [file]: edit }).result, 'checkpoint-composition').map(m => m.message);

  it('passes with 9 items covering every part', () => {
    expect(composition(old => old)).toEqual([]);
  });

  it('needs 8-12 items', () => {
    expect(composition(without('fx-cp-total', 'fx-cp-half'))).toEqual([expect.stringContaining('checkpoint has 7 items; it needs 8-12')]);
    expect(composition(without('fx-cp-total'))).toEqual([]); // 8
    const extra = (n: number) => (old: string) => old + Array.from({ length: n }, (_, i) => `- id: fx-extra-${i}\n  type: choice\n  prompt: "Q"\n  choices: ["a", "b"]\n  answer: 0\n  explain: "x"\n`).join('');
    expect(composition(extra(3))).toEqual([]); // 12
    expect(composition(extra(4))).toEqual([expect.stringContaining('13 items')]);
  });

  it('needs a write-code item', () => {
    expect(composition(without('fx-cp-write'))).toEqual([expect.stringContaining('missing a write-code item')]);
  });

  it('needs a fix-a-bug item', () => {
    expect(composition(without('fx-cp-fix'))).toEqual([expect.stringContaining('missing a fix-a-bug item')]);
  });

  it('needs a memory-diagram or stepper item', () => {
    expect(composition(without('fx-cp-frames'))).toEqual([expect.stringContaining('missing a memory-diagram or stepper item')]);
  });

  it('needs a compiler/tool-message item', () => {
    expect(composition(without('fx-cp-brace'))).toEqual([expect.stringContaining('missing a compiler/tool-message item')]);
  });

  it('needs a transfer item', () => {
    expect(composition(sub('  transfer: true\n', ''))).toEqual([expect.stringContaining('missing a transfer item')]);
  });

  it('reports every missing part at once', () => {
    expect(composition(without('fx-cp-write', 'fx-cp-brace', 'fx-cp-transfer'))).toHaveLength(4); // count (6) + three parts
  });

  it('lets a native (lt) exercise stand in for write-code or fix-a-bug, but not for both', () => {
    const lt = sub('kind: ct', 'kind: lt');
    const ex = `${M1}/exercises/write-sum/exercise.yaml`;
    // write-sum is lt: it counts as the write-code item, the fb exercise is still the fix
    expect(errorsOf(lintGoodWith({ [ex]: lt }).result, 'checkpoint-composition')).toEqual([]);
    // only one ct/fb/lt exercise left, and it is an lt: it cannot be both
    const one = lintGoodWith({ [ex]: lt, [file]: without('fx-cp-fix') }).result;
    expect(errorsOf(one, 'checkpoint-composition').map(m => m.message)).toEqual([expect.stringContaining('second exercise item')]);
    // with an lt and a pa exercise only, there is no fix-a-bug item but the lt can fill the write-code role
    const pa = `${M1}/exercises/fix-bug/exercise.yaml`;
    const r = lintGoodWith({ [ex]: lt, [pa]: sub('kind: fb', 'kind: pa') }).result;
    expect(errorsOf(r, 'checkpoint-composition').map(m => m.message)).toEqual([expect.stringContaining('second exercise item')]);
  });

  it('uses the exercise kind, not the item id', () => {
    const r = lintGoodWith({ [`${M1}/exercises/write-sum/exercise.yaml`]: sub('kind: ct', 'kind: pa') }).result;
    expect(errorsOf(r, 'checkpoint-composition').map(m => m.message)).toEqual([expect.stringContaining('missing a write-code item')]);
  });
});

describe('retrieval quizzes (PLAN §2.5)', () => {
  const m1 = `${M1}/quizzes/retrieval.yaml`;
  const m2 = `${M2}/quizzes/retrieval.yaml`;
  /** Keeps the first n items. */
  const take = (n: number) => (old: string) => old.split(/(?=- id: )/).slice(0, n).join('');

  it('needs 6-10 items', () => {
    expect(errorsOf(lintGoodWith({ [m2]: take(5) }).result, 'retrieval-composition')[0].message).toContain('5 items; it needs 6-10');
    const more = (n: number) => (old: string) => old + Array.from({ length: n }, (_, i) => `- id: fx-r2-extra-${i}\n  type: choice\n  from: m01\n  prompt: "Q"\n  choices: ["a", "b"]\n  answer: 0\n  explain: "x"\n`).join('');
    expect(errorsOf(lintGoodWith({ [m2]: more(4) }).result, 'retrieval-composition')).toEqual([]);
    expect(errorsOf(lintGoodWith({ [m2]: more(5) }).result, 'retrieval-composition')[0].message).toContain('11 items');
    expect(errorsOf(lintGoodWith({ [m1]: take(5) }).result, 'retrieval-composition')).toHaveLength(1);
  });

  it('needs `from`, and from must be an earlier module (js in Module 1)', () => {
    expect(errorsOf(lintGoodWith({ [m2]: sub('  from: m01\n', '') }).result, 'retrieval-from')[0].message).toContain('needs `from`');
    expect(errorsOf(lintGoodWith({ [m2]: sub('from: m01', 'from: m02') }).result, 'retrieval-from')[0].message).toContain('not an earlier module');
    expect(errorsOf(lintGoodWith({ [m2]: sub('from: m01', 'from: js') }).result, 'retrieval-from')[0].message).toContain('only for Module 1');
    expect(errorsOf(lintGoodWith({ [m2]: sub('from: m01', 'from: m07') }).result, 'retrieval-from')[0].message).toContain('not an earlier module');
    expect(errorsOf(lintGoodWith({ [m1]: sub('from: js', 'from: m01') }).result, 'retrieval-from')[0].message).toContain('Module 1 has no earlier module');
    expect(errorsOf(lintGoodWith({ [m1]: sub('  from: js\n', '') }).result, 'retrieval-from')[0].message).toContain('or from: js');
  });

  it('keeps retrieval.sources in module.yaml consistent with the items', () => {
    const r = lintGoodWith({ [`${M2}/module.yaml`]: sub('sources: [m01]', 'sources: [m01, m02]') }).result;
    expect(errorsOf(r, 'module-yaml')[0].message).toContain('must be an earlier module');
    const unused = lintGoodWith({ [`${M1}/module.yaml`]: sub('sources: [js]', 'sources: [js, m01]') }).result;
    expect(errorsOf(unused, 'module-yaml').length).toBeGreaterThan(0);
    const missing = lintGoodWith({ [`${M2}/module.yaml`]: sub('sources: [m01]', 'sources: []') }).result;
    expect(errorsOf(missing, 'module-yaml')[0].message).toContain('non-empty list');
  });
});

describe('quiz item schema', () => {
  const file = `${M1}/quizzes/checkpoint.yaml`;
  const quiz = (edit: Edit) => lintGoodWith({ [file]: edit }).result;
  const schema = (r: LintResult) => errorsOf(r, 'quiz-schema').map(m => m.message);

  it('requires explain for code and choice items', () => {
    expect(schema(quiz(sub('  explain: "2 + 3 is 5."\n', '')))).toEqual([expect.stringContaining('`explain` is required for predict items')]);
  });

  it('never allows an answer on predict, outcome or md items (answers come from running code)', () => {
    expect(schema(quiz(sub('prompt: "What exactly does this program print?"', 'prompt: "What exactly does this program print?"\n  answer: 0')))).toEqual([expect.stringContaining('predict items take no `answer`')]);
    expect(schema(quiz(sub('prompt: "What happens when you press Run?"', 'prompt: "What happens when you press Run?"\n  answer: 0')))).toEqual([expect.stringContaining('outcome items take no `answer`')]);
  });

  it('allows `answer` on a choice only when it has no code, and requires it then', () => {
    expect(schema(quiz(sub('choices: ["2", "2.5", "3"]', 'choices: ["2", "2.5", "3"]\n  answer: 0')))).toEqual([expect.stringContaining('choice items take no `answer`')]);
    expect(schema(quiz(sub('  answer: 0\n  explain: "By convention 0 is success."', '  explain: "By convention 0 is success."')))).toEqual([expect.stringContaining('needs `answer`')]);
    expect(schema(quiz(sub('  answer: 0\n  explain: "By convention', '  answer: 2\n  explain: "By convention')))).toEqual([expect.stringContaining('index into `choices` (0-1)')]);
  });

  it('requires an answer and choices on ce items, and code on ce/predict/outcome', () => {
    expect(schema(quiz(sub('  answer: 0\n  explain: "The `{` of', '  explain: "The `{` of')))).toEqual([expect.stringContaining('ce item needs `answer`')]);
    expect(schema(quiz(sub('choices: ["A closing brace is missing", "printf is misspelled"]', 'choices: ["only one"]')))).toEqual([expect.stringContaining('2-6 non-empty strings')]);
    expect(warningsOf(quiz(sub('meta: expect=compile-error\n  choices', 'choices')), 'quiz-schema')[0].message).toContain('a ce item should say what the tool reports');
  });

  it('checks md and sp items', () => {
    expect(schema(quiz(sub('  line: 5\n', '')))).toEqual([expect.stringContaining('md items need `line`')]);
    expect(schema(quiz(sub('  items: ["triple.n", "triple.result"]\n', '')))).toEqual([expect.stringContaining('md items need `items`')]);
    expect(schema(quiz(sub('line: 5', 'line: 99')))).toEqual([expect.stringContaining('past the end of sample')]);
    expect(errorsOf(quiz(sub('meta: trace predict=none', 'meta: predict=none')), 'sample-trace').length).toBeGreaterThan(0);
    expect(errorsOf(quiz(sub('sample: fx-cp-frames', 'sample: nothing')), 'sample-ref')).toHaveLength(1);
  });

  it('checks np and order items', () => {
    expect(schema(quiz(sub('items: ["13", "dec", "bin", "8"]', 'items: ["13", "dec"]')))).toEqual([expect.stringContaining('[value, from, to, width]')]);
    expect(schema(quiz(sub('items: ["13", "dec", "bin", "8"]', 'items: ["13", "dec", "dec", "8"]')))).toEqual([expect.stringContaining('same base')]);
    expect(schema(quiz(sub('items: ["13", "dec", "bin", "8"]', 'items: ["0b1101", "bin", "hex", "8"]')))).toEqual([]);
    const order = (items: string) => (old: string) => old + `- id: fx-order\n  type: order\n  prompt: "Order"\n  items: ${items}\n  explain: "x"\n`;
    expect(schema(quiz(order('["a", "b", "c"]')))).toEqual([]);
    expect(schema(quiz(order('["a"]')))).toEqual([expect.stringContaining('at least two')]);
    expect(schema(quiz(order('["a", "a"]')))).toEqual([expect.stringContaining('duplicates')]);
  });

  it('checks exercise items against the module', () => {
    expect(errorsOf(quiz(sub('exercise: write-sum', 'exercise: nope')), 'exercise-ref')).toHaveLength(1);
    expect(schema(quiz(sub('prompt: "Write the program."', 'prompt: "Write the program."\n  choices: ["a", "b"]')))).toEqual([expect.stringContaining('exercise items take no `choices`')]);
  });

  it('needs ids, types and prompts, unique ids, and warns about unknown fields', () => {
    expect(schema(quiz(sub('type: predict', 'type: riddle')))).toEqual([expect.stringContaining('`type` must be one of')]);
    expect(schema(quiz(sub('  prompt: "What exactly does this program print?"\n', '')))).toEqual([expect.stringContaining('`prompt` is required')]);
    expect(errorsOf(quiz(sub('id: fx-cp-write', 'id: fx-cp-total')), 'quiz-id')).toHaveLength(1);
    expect(schema(quiz(sub('id: fx-cp-total', 'id: Fx_Total')))).toEqual([expect.stringContaining('kebab-case')]);
    expect(warningsOf(quiz(sub('type: predict', 'type: predict\n  colour: red')), 'quiz-schema')[0].message).toContain('unknown field "colour"');
  });

  it('applies the sample rules to quiz code: id= is not allowed in meta, UB is categorical', () => {
    expect(errorsOf(quiz(sub('id: fx-cp-total\n  type: predict', 'id: fx-cp-total\n  type: predict\n  meta: id=other')), 'quiz-meta').length).toBeGreaterThan(0);
    const ub = (type: string, extra = '') => sub(/- id: fx-cp-total\n {2}type: predict/, `- id: fx-cp-total\n  type: ${type}\n  meta: expect=ub${extra}`);
    expect(errorsOf(quiz(ub('predict')), 'ub-prediction')).toHaveLength(1);
    expect(errorsOf(quiz(ub('outcome')), 'ub-prediction')).toEqual([]);
  });

  it('accepts a quiz file written as an object with items', () => {
    const r = lintGoodWith({ [`${M2}/quizzes/retrieval.yaml`]: old => `items:\n${old.split('\n').map(l => (l ? `  ${l}` : l)).join('\n')}` }).result;
    expect(r.messages).toEqual([]);
  });

  it('reports a quiz file that is not a list, and YAML syntax errors', () => {
    expect(errorsOf(lintGoodWith({ [file]: 'just: a mapping\n' }).result, 'quiz-schema')[0].message).toContain('list of items');
    expect(errorsOf(lintGoodWith({ [file]: '- id: [\n' }).result, 'yaml-syntax').length).toBeGreaterThan(0);
  });

  it('points at the line of the field, not the top of the file', () => {
    const { result, dir } = lintGoodWith({ [file]: sub('line: 5', 'line: 99') });
    expect(errorsOf(result, 'quiz-schema')[0].line).toBe(lineOf(path.join(dir, file), 'line: 99'));
  });
});

// ---- the bad fixtures --------------------------------------------------------------------------

describe('fixtures/bad', () => {
  const r = run(BAD);
  const dir = (m: string) => path.join(BAD, 'content', 'modules', m);
  const lessons = dir('m01-bad-lessons') + '/lessons/';

  it('fails', () => {
    expect(r.errors).toBeGreaterThan(50);
    expect(r.warnings).toBeGreaterThan(10);
  });

  it('reports each rule in its own lesson, on the line of the problem', () => {
    const at = (rule: string, file: string, marker: string, severity: 'error' | 'warning' = 'error') => {
      const line = lineOf(lessons + file, marker);
      expect(r.messages.filter(m => m.rule === rule && m.severity === severity && m.file === lessons + file && m.line === line), `${rule} ${file}:${line}`).toHaveLength(1);
    };
    at('word-budget', '01-wordy.mdx', 'This sentence is padding');
    at('animation-asset', '02-media.mdx', '<Animation id="missing-anim" />');
    at('animation-asset', '02-media.mdx', '<Animation id="unrendered" />', 'warning');
    at('media-per-card', '02-media.mdx', '<Animation id="a01-demo" />');
    at('video-ref', '02-media.mdx', '<YouTube video="nope" />');
    at('fence-id', '03-fences.mdx', '```c'); // the first fence in the file is the bare one
    at('sample-id', '03-fences.mdx', 'id=Bad_Id');
    at('fence-meta', '03-fences.mdx', 'frobnicate=3');
    at('fence-meta', '03-fences.mdx', 'stdin="\\q"');
    at('predict-before-run', '03-fences.mdx', 'id=run-no-predict');
    at('ub-prediction', '03-fences.mdx', 'id=ub-output');
    at('platform-predict64', '03-fences.mdx', 'id=plat-no-p64');
    at('posix-scope', '03-fences.mdx', 'id=posix-in-m01');
    at('posix-flag', '03-fences.mdx', 'id=posix-no-flag');
    at('fence-lang', '03-fences.mdx', '```C');
    at('hand-typed-output', '03-fences.mdx', '```console');
    at('fence-nesting', '03-fences.mdx', 'id=in-list', 'warning');
    at('interaction-props', '03-fences.mdx', 'id=quiet-compiler-error');
    at('analogy', '04-analogy.mdx', 'c="int n;" breaksDown=""');
    at('analogy-review', '04-analogy.mdx', 'exactly the same', 'warning');
    at('frontmatter', '05-frontmatter.mdx', 'draft: true', 'warning');
    at('lesson-minutes', '05-frontmatter.mdx', 'minutes: 90');
    at('lesson-id', '05-frontmatter.mdx', 'id: m01-l1');
    at('exercise-ref', '06-refs.mdx', 'no-such-exercise');
    at('sample-ref', '06-refs.mdx', 'no-such-sample');
    at('sample-trace', '06-refs.mdx', '<MemoryDiagram sample="plain-sample" line={3} ask={["a"]} />');
    at('unknown-component', '06-refs.mdx', '<Foo />', 'warning');
    // the error is at the end of the file, where the tag should have been closed
    expect(r.messages.filter(m => m.rule === 'mdx-parse' && m.file === lessons + '07-syntax.mdx').map(m => m.line))
      .toEqual([readFileSync(lessons + '07-syntax.mdx', 'utf8').split('\n').length]);
    at('frontmatter', '08-no-frontmatter.mdx', 'No frontmatter here.');
  });

  it('reports duplicate fence ids on the second fence', () => {
    const second = lineOfNth(lessons + '03-fences.mdx', '```c id=dup-one', 2);
    const e = errorsOf(r, 'duplicate-sample', '03-fences.mdx');
    expect(e.map(m => m.line)).toEqual([second]);
  });

  it('limits videos per module', () => {
    expect(errorsOf(r, 'video-limit')).toHaveLength(1);
  });

  it('reports module.yaml problems at the field', () => {
    const file = dir('m02-bad-module') + '/module.yaml';
    const at = (rule: string, marker: string, severity: 'error' | 'warning' = 'error') =>
      expect(r.messages.some(m => m.rule === rule && m.severity === severity && m.file === file && m.line === lineOf(file, marker)), `${rule}: ${marker}`).toBe(true);
    at('module-yaml', 'id: m09');
    at('module-yaml', 'title: ""');
    at('module-time', 'time: {');
    at('module-yaml', 'lessonsRunIn: cloud');
    at('module-resources', '- { title: "B"');
    at('module-lesson', '- 99-missing');
    at('module-exercise', 'problemSet: [ghost]');
    at('module-project', 'project: nowhere');
    at('module-yaml', 'extra: 1', 'warning');
    expect(errorsOf(r, 'module-resources').map(m => m.message).join('\n')).toContain('3 outside resources');
    expect(errorsOf(r, 'quiz-missing', 'module.yaml')).toHaveLength(1);
  });

  it('reports quiz problems at the item', () => {
    const file = dir('m03-bad-quizzes') + '/quizzes/checkpoint.yaml';
    const ids = readFileSync(file, 'utf8').split('\n').flatMap((l, i) => (l.startsWith('- id: ') ? [{ id: l.slice(6).trim(), line: i + 1 }] : []));
    /** Messages of a rule that fall inside one item (from its "- id:" line to the next item's). */
    const inItem = (rule: string, id: string, nth = 1) => {
      const i = ids.filter(x => x.id === id)[nth - 1];
      const next = ids[ids.indexOf(i) + 1]?.line ?? Infinity;
      return r.messages.filter(m => m.rule === rule && m.file === file && m.line >= i.line && m.line < next);
    };
    expect(inItem('quiz-id', 'bq-dup', 2)).toHaveLength(1);
    expect(inItem('quiz-schema', 'bq-dup', 1).map(m => m.message).join('\n')).toContain('predict items take no `choices`');
    expect(inItem('quiz-schema', 'bq-weird-type')).toHaveLength(1);
    expect(inItem('quiz-schema', 'bq-choice-code-answer')).toHaveLength(1);
    expect(inItem('quiz-schema', 'bq-md-bad').length).toBeGreaterThanOrEqual(2);
    expect(inItem('sample-ref', 'bq-md-bad')).toHaveLength(1);
    expect(inItem('sample-trace', 'bq-md-no-trace')).toHaveLength(1);
    expect(inItem('exercise-ref', 'bq-ex-missing')).toHaveLength(1);
    expect(inItem('ub-prediction', 'bq-extra')).toHaveLength(1);
    // and the line is the line of the field: `line: 40` is the one that is past the end of the sample
    expect(inItem('quiz-schema', 'bq-md-no-trace').map(m => m.line)).toEqual([lineOf(file, 'line: 40')]);
    expect(errorsOf(r, 'checkpoint-composition', 'checkpoint.yaml').length).toBeGreaterThanOrEqual(4);
    expect(errorsOf(r, 'retrieval-from', 'retrieval.yaml')).toHaveLength(3);
    expect(errorsOf(r, 'retrieval-composition', 'retrieval.yaml')).toHaveLength(1);
  });

  it('lists site-level problems (course.yaml) under "site"', () => {
    const e = errorsOf(r, 'course-yaml');
    expect(e.map(m => m.line)).toEqual([5, 7]);
    expect(e.every(m => m.module === undefined)).toBe(true);
  });
});

// ---- parity with the renderer -------------------------------------------------------------------

describe('cards match the renderer', () => {
  // Run the site's own remark plugin (tools/mdx/remark-course.ts) and compare the cards it builds with the
  // cards content-lint measured: the budget must be checked on exactly what learners see.
  const REAL = path.join(HERE, '..', '..', 'content', 'modules');
  const renderer = unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter, ['yaml']).use(remarkGfm).use(remarkCourse);

  function rendererCards(file: string): number[] | null {
    const text = readFileSync(file, 'utf8');
    let tree: Root;
    try { tree = renderer.runSync(renderer.parse(text), { path: file } as never) as Root; } catch { return null; } // a lesson the renderer rejects
    return tree.children
      .filter(n => (n as { name?: string }).name === 'Card')
      .map(card => countWords((card as unknown as { children: Root['children'] }).children));
  }

  const sites: Array<[string, string]> = [['fixtures/good', path.join(GOOD, 'content')]];
  try { if (readdirSync(REAL).length) sites.push(['content/', path.dirname(REAL)]); } catch { /* no real content */ }

  for (const [name, contentRoot] of sites) {
    it(`gives the same cards and word counts as remark-course on ${name}`, () => {
      const r = lintContent({ contentRoot });
      let compared = 0;
      for (const l of r.lessons) {
        const expected = rendererCards(l.file);
        if (!expected) continue;
        expect(l.words, path.relative(contentRoot, l.file)).toEqual(expected);
        compared++;
      }
      expect(compared).toBeGreaterThan(0);
    });
  }
});

// ---- options and output ------------------------------------------------------------------------

describe('options', () => {
  it('--module reports one module (by id or directory name) and keeps site-level messages out', () => {
    const only = run(BAD, { module: 'm03' });
    expect(only.messages.length).toBeGreaterThan(0);
    expect(only.messages.every(m => m.module === 'm03')).toBe(true);
    expect(run(BAD, { module: 'm03-bad-quizzes' }).messages).toEqual(only.messages);
    expect(run(BAD, { module: 'm09' }).errors).toBeGreaterThan(0); // unknown module: an error, plus the site-level messages
    expect(run(BAD, { module: 'm09' }).messages.some(m => m.message.includes('no module "m09"'))).toBe(true);
  });

  it('--videos, --public and --animations override the locations', () => {
    const { dir } = lintGoodWith({});
    const moved = run(GOOD, { videosFile: path.join(dir, 'nope.json'), publicRoot: path.join(dir, 'nowhere') });
    expect(errorsOf(moved, 'video-ref')).toHaveLength(1);
    expect(errorsOf(moved, 'animation-asset')).toHaveLength(1);
  });

  it('parses command-line arguments', () => {
    const a = parseArgs(['--content-root', 'x/content', '--module', 'm02', '--strict', '--errors-only', '--stats', '--json', '--videos', 'v.json', '--public', 'p', '--animations', 'a']);
    expect(a).toMatchObject({ module: 'm02', strict: true, errorsOnly: true, stats: true, json: true });
    expect(path.basename(a.contentRoot)).toBe('content');
    expect(path.basename(a.videosFile!)).toBe('v.json');
    expect(parseArgs([]).strict).toBe(false);
    expect(() => parseArgs(['--wat'])).toThrow(/unknown argument --wat/);
    expect(() => parseArgs(['--module'])).toThrow(/needs a value/);
  });
});

describe('report', () => {
  const r = run(BAD, { module: 'm02' });

  it('prints file:line, severity, message and rule, grouped by module', () => {
    const out = renderReport(r, BAD);
    const lines = out.split('\n');
    const group = lines.findIndex(l => l.startsWith('m02-bad-module'));
    expect(group).toBeGreaterThan(-1);
    expect(lines[group]).toMatch(/^m02-bad-module \(\d+ errors?, \d+ warnings?\)$/);
    expect(out).toMatch(/content\/modules\/m02-bad-module\/module\.yaml:3 {2}error {4}`title` must be a non-empty string {2}\[module-yaml\]/);
    expect(out).toMatch(/module\.yaml:6 {2}warning {2}weeks is 3 but/);
    expect(lines.at(-1)).toMatch(/^\d+ errors?, \d+ warnings? \(3 modules,/);
  });

  it('lists site-level problems first, and can show errors only', () => {
    const all = run(BAD);
    const out = renderReport(all, BAD);
    expect(out.indexOf('\nsite ')).toBeLessThan(out.indexOf('\nm01-bad-lessons '));
    expect(renderReport(all, BAD, true)).not.toMatch(/ {2}warning {2}/);
    expect(renderReport(all, BAD, false)).toMatch(/ {2}warning {2}/);
  });

  it('says so when everything is fine', () => {
    expect(renderReport(run(GOOD), GOOD)).toContain('All good: 2 modules, 4 lessons, 29 quiz items, 15 samples.');
  });

  it('orders messages by file, line and severity', () => {
    const all = run(BAD).messages;
    for (let i = 1; i < all.length; i++) {
      const a: LintMessage = all[i - 1];
      const b: LintMessage = all[i];
      expect(a.file.localeCompare(b.file) || a.line - b.line).toBeLessThanOrEqual(0);
    }
  });
});
