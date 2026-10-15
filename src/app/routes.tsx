import { createHashRouter } from 'react-router';
import { Layout } from './Layout';
import { CourseMap } from './pages/CourseMap';
import { ModulePage } from './pages/ModulePage';
import { LessonPage } from './pages/LessonPage';
import { ProjectPage } from './pages/ProjectPage';
import { CheckpointPage } from './pages/CheckpointPage';
import { RetrievalPage } from './pages/RetrievalPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';
import { NotFound } from './pages/NotFound';

// Hash routing: deep links work on any static host and subpath without server rewrites.
export const router = createHashRouter([
  {
    element: <Layout />,
    errorElement: <Layout><NotFound /></Layout>,
    children: [
      { index: true, element: <CourseMap /> },
      { path: 'm/:moduleId', element: <ModulePage /> },
      { path: 'm/:moduleId/retrieval', element: <RetrievalPage /> },
      { path: 'm/:moduleId/project', element: <ProjectPage /> },
      { path: 'm/:moduleId/checkpoint', element: <CheckpointPage /> },
      { path: 'm/:moduleId/:lessonStem', element: <LessonPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
