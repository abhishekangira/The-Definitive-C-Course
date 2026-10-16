import { createHashRouter, type RouteObject } from 'react-router';
import { Layout } from './Layout';
import { NotFound } from './pages/NotFound';
import { RouteError } from './pages/RouteError';
import { RouteLoading } from './RouteLoading';

/**
 * Every page is its own chunk, loaded when its route is first visited, so the entry chunk holds only the router,
 * the layout and the progress store. (Each page's named export becomes the route component.)
 */
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load())[name] }),
});

// Hash routing: deep links work on any static host and subpath without server rewrites.
export const router = createHashRouter([
  {
    element: <Layout />,
    errorElement: <Layout><RouteError /></Layout>,
    HydrateFallback: RouteLoading,
    children: [
      { index: true, ...page(() => import('./pages/CourseMap'), 'CourseMap') },
      { path: 'm/:moduleId', ...page(() => import('./pages/ModulePage'), 'ModulePage') },
      { path: 'm/:moduleId/retrieval', ...page(() => import('./pages/RetrievalPage'), 'RetrievalPage') },
      { path: 'm/:moduleId/project', ...page(() => import('./pages/ProjectPage'), 'ProjectPage') },
      { path: 'm/:moduleId/checkpoint', ...page(() => import('./pages/CheckpointPage'), 'CheckpointPage') },
      { path: 'm/:moduleId/:lessonStem', ...page(() => import('./pages/LessonPage'), 'LessonPage') },
      { path: 'settings', ...page(() => import('./pages/SettingsPage'), 'SettingsPage') },
      { path: 'about', ...page(() => import('./pages/AboutPage'), 'AboutPage') },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
