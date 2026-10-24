import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { describe, expect, it } from 'vitest';
import remarkCourse, { lessonChoiceIds, lessonCompilerErrorIds } from './remark-course';

// The `?frontmatter` loader (vite.config.ts) counts a lesson's questions with lessonChoiceIds and
// lessonCompilerErrorIds (plain parses); the lesson itself is compiled by @mdx-js with remarkCourse. If the two ever
// disagree on an id, that lesson can never be perfect. The plugin list is the one in vite.config.ts.
const root = join(process.cwd(), 'content/modules');
const lessons = readdirSync(root).flatMap(m => { try { return readdirSync(join(root, m, 'lessons')).filter(f => f.endsWith('.mdx')).map(f => join(root, m, 'lessons', f)); } catch { return []; } });

const plugins = [remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }], remarkGfm, remarkCourse] as const;
async function compiledIds(mdx: string, attr: string, path = 'lesson.mdx'): Promise<string[]> {
  const js = String(await compile({ value: mdx, path }, { remarkPlugins: [...plugins] as never }));
  return [...js.matchAll(new RegExp(`\\b${attr}: "([^"]+)"`, 'g'))].map(m => m[1]);
}
const compiledQids = (mdx: string, path?: string) => compiledIds(mdx, 'qid', path);
const compiledCeids = (mdx: string, path?: string) => compiledIds(mdx, 'ceid', path);
/** The exercise ids the loader's `<instance>:<kind>` question ids name, in order. Sessions keep their own colon. */
const loaderInstances = (mdx: string) => [...new Set(lessonCompilerErrorIds(mdx).map(qid => qid.replace(/:(line|kind|stage)$/, '')))];

describe('lesson qids: the compiled lesson and the ?frontmatter loader agree', () => {
  it('finds the lessons and their questions', () => {
    expect(lessons.length).toBeGreaterThan(10);
    expect(lessons.reduce((n, f) => n + lessonChoiceIds(readFileSync(f, 'utf8')).length, 0)).toBeGreaterThan(10);
    expect(lessons.reduce((n, f) => n + lessonCompilerErrorIds(readFileSync(f, 'utf8')).length, 0)).toBeGreaterThan(0);
  });
  it.each(lessons.map(f => [f.slice(root.length + 1), f]))('%s', async (_name, file) => {
    const mdx = readFileSync(file, 'utf8');
    expect(await compiledQids(mdx, file)).toEqual(lessonChoiceIds(mdx));
    // The loader counts a question the component has no id for, or the reverse: the lesson could never be perfect.
    expect(await compiledCeids(mdx, file)).toEqual(loaderInstances(mdx));
  });
  it('a repeated question, a braced string and a C fence before the questions', async () => {
    const q = (question: string) => `<Choice\n  question=${question}\n  options={["a", "b"]}\n  answer={0}\n/>\n`;
    const mdx = `---\ntitle: T\n---\n\n# L\n\n\`\`\`c fragment\nint main(void) { return 0; }\n\`\`\`\n\n${q('"Same?"')}\n${q('{"Same?"}')}\n${q('"Other?"')}`;
    const ids = lessonChoiceIds(mdx);
    expect(ids).toHaveLength(3); expect(ids[1]).toBe(`${ids[0]}-2`);
    expect(await compiledQids(mdx)).toEqual(ids);
  });
  it('numbers a compiler-error exercise from its nested sample or session and asks the questions the loader counts', async () => {
    const fence = (id: string) => `\n\n\`\`\`c id=${id} predict=none expect=compile-error\nint main(void) { return 0; }\n\`\`\`\n`;
    const ce = (props: string, children = '') => `<CompilerError question="What is wrong?" options={["a", "b"]} answer={0}${props}>${children}</CompilerError>\n`;
    const mdx = `# L\n\n${ce('', fence('ce-one'))}\n${ce(' session="ld" stage="link"')}\n${ce(' session="ld" stage="link"')}`;
    expect(lessonCompilerErrorIds(mdx)).toEqual([
      'ce-one:line', 'ce-one:kind',
      'session:ld:kind', 'session:ld:stage',
      'session:ld-2:kind', 'session:ld-2:stage',
    ]);
    // The compiled element carries exactly the ids the loader counts (a lesson with another id could never be perfect).
    expect(await compiledCeids(mdx)).toEqual(['ce-one', 'session:ld', 'session:ld-2']);
  });
});
