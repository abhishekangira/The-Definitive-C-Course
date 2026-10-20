import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/routes';
// Geist is self-hosted (OFL-1.1): no request leaves the site for a font. Only the subsets a page uses are downloaded.
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist/wght-italic.css';
import '@fontsource-variable/geist-mono/index.css';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
