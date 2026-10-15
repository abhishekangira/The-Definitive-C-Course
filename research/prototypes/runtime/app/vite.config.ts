import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE: '/' locally, '/<repo>/' on GitHub Pages project sites (set in CI: BASE=/the-definitive-c-course/).
const base = process.env.BASE ?? '/';
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: 'es' },                 // module workers (needed for dynamic import() of the toolchain)
  build: { target: 'es2022', assetsInlineLimit: 0 },
  server: { headers: process.env.COI ? isolation : {} },
  preview: { headers: process.env.COI ? isolation : {} },
  optimizeDeps: { exclude: ['@yowasp/clang'] }, // never pre-bundle it: it locates its .wasm via import.meta.url
});
