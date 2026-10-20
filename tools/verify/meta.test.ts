import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectFor, parseFenceMeta, requiredWarnings, warningsAllowed } from './meta';
import { discover, extractMdxFences, moduleIdOf } from './discover';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/content');

describe('parseFenceMeta', () => {
  it('parses shared keys through toSampleMeta', () => {
    const { meta, ext } = parseFenceMeta('id=sum stdin="3 4\\n" args="a \'b c\'" expect=warning timeout=500');
    expect(meta).toMatchObject({ id: 'sum', stdin: '3 4\n', args: ['a', 'b c'], expect: 'warning', timeout: 500, predict: 'output' });
    expect(ext.fragmentPartial).toBe(false);
  });

  it('maps expect.<compiler> to targets and handles warn / warn.<compiler>', () => {
    const { meta, ext } = parseFenceMeta('id=x expect=runtime-error expect.wasm=success warn=-Wformat warn.gcc=format-overflow');
    expect(meta!.expectBy).toEqual({ wasm: 'success' });
    expect(expectFor(meta!, ext, 'wasm32-clang22')).toBe('success');
    expect(expectFor(meta!, ext, 'linux-x86_64-gcc13')).toBe('runtime-error');
    expect(requiredWarnings(ext, 'linux-x86_64-gcc13')).toEqual(['-Wformat-overflow']);
    expect(requiredWarnings(ext, 'linux-x86_64-clang22')).toEqual(['-Wformat']);
    expect(warningsAllowed(meta!, ext, 'linux-x86_64-clang22')).toBe(true);
  });

  it('warnings are allowed only where expected', () => {
    const { meta, ext } = parseFenceMeta('id=x expect=ub');
    expect(warningsAllowed(meta!, ext, 'wasm32-clang22')).toBe(true);
    const plain = parseFenceMeta('id=y');
    expect(warningsAllowed(plain.meta!, plain.ext, 'wasm32-clang22')).toBe(false);
  });

  it('recognises fragments, fragment=partial and missing ids', () => {
    expect(parseFenceMeta('fragment').meta).toEqual({ id: '', fragment: true });
    const partial = parseFenceMeta('fragment=partial');
    expect(partial.meta?.fragment).toBe(true);
    expect(partial.ext.fragmentPartial).toBe(true);
    expect(parseFenceMeta('').meta).toBeNull();
    expect(parseFenceMeta('stdin="x"').meta).toBeNull();
  });

  it('rejects unknown keys and compilers', () => {
    expect(() => parseFenceMeta('id=x bogus')).toThrow(/unknown fence key/);
    expect(() => parseFenceMeta('id=x warn.icc=-Wall')).toThrow(/unknown compiler/);
    expect(() => parseFenceMeta('id=x expect.wasm=maybe')).toThrow();
  });
});

describe('discovery', () => {
  it('extracts c/h fences with meta and line numbers via remark-mdx', () => {
    const fences = extractMdxFences('---\ntitle: t\n---\n\nText.\n\n```c id=a\nint main(void) { return 0; }\n```\n\n<Choice options={[1, 2]} />\n\n```js\nnot c\n```\n\n```h fragment\nint f(void);\n```\n');
    expect(fences).toEqual([
      { lang: 'c', meta: 'id=a', code: 'int main(void) { return 0; }\n', line: 7 },
      { lang: 'h', meta: 'fragment', code: 'int f(void);\n', line: 17 },
    ]);
  });

  it('module ids come from the directory prefix', () => {
    expect(moduleIdOf('m01-c-in-your-browser')).toBe('m01');
    expect(moduleIdOf('cap-malloc')).toBe('cap');
    expect(moduleIdOf('notes')).toBeNull();
  });

  it('finds lesson samples, quiz samples and fragments in the fixture module', () => {
    const d = discover({ contentRoot: FIXTURES, module: 'm99' });
    expect(d.errors).toEqual([]);
    expect(d.modules).toEqual(['m97', 'm98', 'm99']);
    const ids = d.samples.map(s => s.id);
    expect(ids).toEqual(['fx-hello', 'fx-sum-stdin', 'fx-pointers', 'fx-sizeof-long', 'fx-warning', 'fx-compile-error', 'fx-null-deref', 'fx-uninit', 'fx-swap', 'fx-args', 'fx-learnc', 'fx-buffering', 'fx-fork', 'fx-choice']);
    const choice = d.samples.find(s => s.id === 'fx-choice')!;
    expect(choice).toMatchObject({ module: 'm99', lesson: 'quiz:checkpoint', meta: { predict: 'choice', choices: ['3', '3.5', '4'] } });
    expect(choice.line).toBeGreaterThan(0);
    const lesson = d.samples.find(s => s.id === 'fx-null-deref')!;
    expect(lesson.lesson).toBe('01-fixture');
    expect(lesson.ext.expectByTarget).toEqual({ 'wasm32-clang22': 'success' });
    expect(d.fragments.map(f => f.partial)).toEqual([false, false, true]);
  });

  it('reports a C fence without id or fragment (only for the selected module)', () => {
    expect(discover({ contentRoot: FIXTURES, module: 'm98' }).errors).toEqual([
      expect.stringMatching(/01-negative\.mdx:\d+: C fence needs id=/),
    ]);
  });
});
