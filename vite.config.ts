/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { parse as parseYaml } from 'yaml';
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

export default defineConfig({
  // Relative base + HashRouter: the built site works on GitHub Pages, any subpath, and any static server.
  base: './',
  plugins: [
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
