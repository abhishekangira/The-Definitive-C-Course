import { useEffect, useState, type ComponentType } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { MDXProvider } from '@mdx-js/react';
import { lessonLoader, moduleById, samplesFor } from '../../content-runtime/course';
import { mdxComponents } from '../../content-runtime/mdx-components';
import { LessonProvider } from '../../lesson/LessonContext';
import { isModuleUnlocked, moduleStatus } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import type { SamplesFile } from '../../content-model/types';
import { getRuntime } from '../../runtime/CRuntime';
import { Icon } from '../../components/Icon';
import styles from './Pages.module.css';

export function LessonPage() {
  const { moduleId = '', lessonStem = '' } = useParams();
  const m = moduleById(moduleId);
  const progress = useProgress();
  const [Lesson, setLesson] = useState<ComponentType<{ components?: Record<string, unknown> }> | null>(null);
  const [samples, setSamples] = useState<SamplesFile | null | undefined>(undefined);
  const storedMode = Boolean(progress.settings.storedOutputMode);

  useEffect(() => {
    setLesson(null);
    const load = lessonLoader(moduleId, lessonStem);
    if (load) void load().then(mod => setLesson(() => mod.default));
    void samplesFor(moduleId).then(setSamples);
    // Warm the compiler in the background once the learner is reading a lesson (not in low-memory mode).
    if (storedMode) return;
    const t = setTimeout(() => getRuntime().prefetch(), 1500);
    return () => clearTimeout(t);
  }, [moduleId, lessonStem, storedMode]);

  if (!m) return <Navigate to="/" replace />;
  const idx = m.lessons.findIndex(l => l.stem === lessonStem);
  if (idx < 0) return <Navigate to={`/m/${moduleId}`} replace />;
  if (!isModuleUnlocked(progress, moduleId) || !moduleStatus(progress, moduleId).retrievalDone) return <Navigate to={`/m/${moduleId}`} replace />;
  const lesson = m.lessons[idx];
  const prev = m.lessons[idx - 1];
  const next = m.lessons[idx + 1];
  const done = Boolean(progress.lessons[lesson.frontmatter.id]);

  return (
    <article className={styles.lesson}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${moduleId}`}>{m.meta.number === 'cap' ? 'Capstone' : `Module ${m.meta.number}`}</Link>
      </nav>
      <p className={styles.eyebrow}>Lesson {idx + 1} of {m.lessons.length} · {lesson.frontmatter.minutes} min</p>
      <h1>{lesson.frontmatter.title}</h1>
      {Lesson && samples !== undefined ? (
        <LessonProvider lessonId={lesson.frontmatter.id} moduleId={moduleId} samples={samples}>
          <MDXProvider components={mdxComponents}>
            <div className={styles.prose}><Lesson components={mdxComponents} /></div>
          </MDXProvider>
        </LessonProvider>
      ) : <p>Loading lesson…</p>}
      <footer className={styles.lessonFooter}>
        {done ? <p className={styles.okBox}>Lesson complete.</p> : <p className={styles.muted}>Finish each part to reveal the next one.</p>}
        <div className={styles.pager}>
          {prev ? <Link className="btn" to={`/m/${moduleId}/${prev.stem}`}><Icon name="arrow-left" /> {prev.frontmatter.title}</Link> : <span />}
          {next ? (
            <Link className={`btn ${done ? 'btn-primary' : ''}`} to={`/m/${moduleId}/${next.stem}`}>{next.frontmatter.title} <Icon name="arrow-right" /></Link>
          ) : (
            <Link className={`btn ${done ? 'btn-primary' : ''}`} to={`/m/${moduleId}`}>Back to the module <Icon name="arrow-right" /></Link>
          )}
        </div>
      </footer>
    </article>
  );
}
