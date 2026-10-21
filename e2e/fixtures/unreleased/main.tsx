// Test-only page: the real app (router, layout, pages, gating) over a two-module course of its own, one released and one
// draft (served by e2e/unreleased-modules.spec.ts through a throwaway Vite server rooted here, so the app's content globs
// read ./content; the spec aliases course.yaml too). Never part of the app build.
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from '../../../src/app/routes';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist-mono/index.css';
import '../../../src/styles/tokens.css';
import '../../../src/styles/base.css';

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
