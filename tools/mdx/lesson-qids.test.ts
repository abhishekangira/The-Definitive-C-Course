import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { describe, expect, it } from 'vitest';
import remarkCourse, { lessonChoiceIds } from './remark-course';

// The `?frontmatter` loader (vite.config.ts) counts a lesson's questions with lessonChoiceIds (a plain parse); the
// lesson itself is compiled by @mdx-js with remarkCourse. If the two ever disagree on a qid, that lesson can never be
// perfect. The plugin list is the one in vite.config.ts.
const root = join(process.cwd(), 'content/modules');
const lessons = readdirSync(root).flatMap(m => { try { return readdirSync(join(root, m, 'lessons')).filter(f => f.endsWith('.mdx')).map(f => join(root, m, 'lessons', f)); } catch { return []; } });

const plugins = [remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }], remarkGfm, remarkCourse] as const;
async function compiledQids(mdx: string, path = 'lesson.mdx'): Promise<string[]> {
  const js = String(await compile({ value: mdx, path }, { remarkPlugins: [...plugins] as never }));
  return [...js.matchAll(/\bqid: "([^"]+)"/g)].map(m => m[1]);
}

describe('lesson qids: the compiled lesson and the ?frontmatter loader agree', () => {
  it('finds the lessons and their questions', () => {
    expect(lessons.length).toBeGreaterThan(10);
    expect(lessons.reduce((n, f) => n + lessonChoiceIds(readFileSync(f, 'utf8')).length, 0)).toBeGreaterThan(10);
  });
  it.each(lessons.map(f => [f.slice(root.length + 1), f]))('%s', async (_name, file) => {
    const mdx = readFileSync(file, 'utf8');
    expect(await compiledQids(mdx, file)).toEqual(lessonChoiceIds(mdx));
  });
  it('a repeated question, a braced string and a C fence before the questions', async () => {
    const q = (question: string) => `<Choice\n  question=${question}\n  options={["a", "b"]}\n  answer={0}\n/>\n`;
    const mdx = `---\ntitle: T\n---\n\n# L\n\n\`\`\`c fragment\nint main(void) { return 0; }\n\`\`\`\n\n${q('"Same?"')}\n${q('{"Same?"}')}\n${q('"Other?"')}`;
    const ids = lessonChoiceIds(mdx);
    expect(ids).toHaveLength(3); expect(ids[1]).toBe(`${ids[0]}-2`);
    expect(await compiledQids(mdx)).toEqual(ids);
  });
});
