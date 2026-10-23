/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { parse as parseYaml } from 'yaml';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import remarkCourse, { lessonChoiceIds } from './tools/mdx/remark-course.ts';

/** `import x from './file.yaml'` → parsed object. */
function yamlPlugin(): Plugin {
  return {
    name: 'course-yaml',
    transform(code, id) {
      if (!/\.ya?ml$/.test(id)) return null;
      return { code: `export default ${JSON.stringify(parseYaml(code))};`, map: null };
    },
  };
}

/**
 * `import fm from './lesson.mdx?frontmatter'` → just the YAML frontmatter, without compiling the lesson, plus
 * `choices`: the `qid` of each "Check your understanding" question in the lesson (perfect lessons count them;
 * `lessonChoiceIds` hashes each question's text the same way remark-course does). The lesson is parsed, not compiled.
 * The module gets a virtual id ("\0" prefix) so the MDX plugin, which also matches *.mdx files by their
 * path, never sees it and cannot replace the data with the compiled lesson component.
 */
function frontmatterPlugin(): Plugin {
  const PREFIX = '\0course-frontmatter:';
  let root = process.cwd();
  return {
    name: 'course-mdx-frontmatter',
    enforce: 'pre',
    configResolved(config) { root = config.root; },
    resolveId(source, importer) {
      const m = /^(.*\.mdx)\?frontmatter$/.exec(source);
      if (!m) return null;
      // import.meta.glob hands over importer-relative paths; plain imports may be absolute or root-relative.
      const file = m[1].startsWith('.') && importer ? path.resolve(path.dirname(importer), m[1])
        : m[1].startsWith(root) ? m[1] : path.join(root, m[1]);
      return PREFIX + file;
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      this.addWatchFile(file);
      const text = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
      const m = /^---\n([\s\S]*?)\n---/.exec(text);
      const choices = lessonChoiceIds(text);
      return `export default ${JSON.stringify({ ...(m ? parseYaml(m[1]) : {}), ...(choices.length ? { choices } : {}) })};`;
    },
  };
}

export default defineConfig({
  // Relative base + HashRouter: the built site works on GitHub Pages, any subpath, and any static server.
  base: './',
  plugins: [
    frontmatterPlugin(),
    yamlPlugin(),
    {
      enforce: 'pre',
      ...mdx({
        providerImportSource: '@mdx-js/react',
        remarkPlugins: [remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }], remarkGfm, remarkCourse],
      }),
    },
    react({ include: /\.(mdx|tsx|ts)$/ }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  // Never pre-bundle the compiler: it locates its .wasm files relative to its own URL.
  optimizeDeps: { exclude: ['@yowasp/clang'] },
  server: { fs: { allow: ['.'] } },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
