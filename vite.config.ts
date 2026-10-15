/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { parse as parseYaml } from 'yaml';
import { readFile } from 'node:fs/promises';
import remarkCourse from './tools/mdx/remark-course';

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

/** `import fm from './lesson.mdx?frontmatter'` → just the YAML frontmatter, without compiling the lesson. */
function frontmatterPlugin(): Plugin {
  return {
    name: 'course-mdx-frontmatter',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('.mdx?frontmatter')) return null;
      const file = id.slice(0, -'?frontmatter'.length);
      this.addWatchFile(file);
      const text = await readFile(file, 'utf8');
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      return `export default ${JSON.stringify(m ? parseYaml(m[1]) : {})};`;
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
