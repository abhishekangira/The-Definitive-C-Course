import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import { expect, it } from 'vitest';
import { discover } from '../verify/discover';
import { parseFenceMeta } from '../verify/meta';

it('nested drill fences explicitly opt out of predictions: they never render the prediction widget', () => {
  const found = discover({ contentRoot: path.resolve('content') });
  const files = new Set(found.samples.filter(s => !s.lesson.startsWith('quiz:')).map(s => s.file));
  const mistakes: string[] = [];
  for (const file of files) {
    const tree = unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter, ['yaml']).parse(readFileSync(file, 'utf8'));
    visit(tree, node => {
      const name = (node as { name?: string }).name;
      if (!name || !['CompilerError', 'MemoryDiagram', 'Stepper', 'PipelineExplorer'].includes(name)) return;
      visit(node, 'code', fence => {
        if (fence.lang !== 'c' && fence.lang !== 'h') return;
        const meta = parseFenceMeta(fence.meta).meta;
        if (meta && !meta.fragment && (meta.predict !== 'none' || (meta.predict64 && meta.predict64 !== 'none'))) {
          mistakes.push(`${file}:${fence.position?.start.line} ${meta.id}: use predict=none; <${name}> does not ask for a prediction`);
        }
      });
    });
  }
  expect(mistakes).toEqual([]);
});
