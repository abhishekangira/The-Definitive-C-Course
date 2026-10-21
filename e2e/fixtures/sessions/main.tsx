// Test-only page: the real app (router, lesson page, MDX pipeline, session loading) over a one-module course whose lesson
// shows <Transcript>s of the m97 fixture sessions (served by e2e/transcript.spec.ts through a throwaway Vite server rooted
// here, so the app's globs read ./content and ./src/generated/sessions, a link to tools/verify/fixtures/generated/sessions).
// No shipped module has a session yet. Never part of the app build.
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from '../../../src/app/routes';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist-mono/index.css';
import '../../../src/styles/tokens.css';
import '../../../src/styles/base.css';

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
