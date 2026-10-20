import { useEffect, useState, type ComponentType } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { MDXProvider } from '@mdx-js/react';
import { lessonLoader, moduleById, samplesFor } from '../../content-runtime/course';
import { mdxComponents } from '../../content-runtime/mdx-components';
import { LessonProvider } from '../../lesson/LessonContext';
import { isModuleUnlocked, moduleStatus } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import type { SamplesFile } from '../../content-model/types';
import { preloadCodeEditor } from '../../components/CodeEditor';
import { getRuntime } from '../../runtime/CRuntime';
import { Icon } from '../../components/Icon';
import { Cells } from '../../components/Cells';
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
    preloadCodeEditor();
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

  const label = m.meta.number === 'cap' ? 'Capstone' : `Module ${m.meta.number}`;
  const doneCount = m.lessons.filter(l => progress.lessons[l.frontmatter.id]).length;

  return (
    <div className={styles.lessonLayout}>
      <article className={styles.lesson}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${moduleId}`}>{label}</Link>
        </nav>
        <h1>{lesson.frontmatter.title}</h1>
        <p className={styles.meta}>Lesson {idx + 1} of {m.lessons.length} · {lesson.frontmatter.minutes} min</p>
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
      {/* After the article in the DOM, so the keyboard reaches the lesson first; the grid puts it on the right. */}
      <aside className={styles.rail} aria-label={`In ${label}`}>
        <h2 className={styles.railTitle}>{label}</h2>
        <ol className={styles.railList}>
          {m.lessons.map((l, i) => {
            const lessonDone = Boolean(progress.lessons[l.frontmatter.id]);
            return (
              <li key={l.stem}>
                <Link to={`/m/${moduleId}/${l.stem}`} className={styles.railLink} aria-current={l.stem === lessonStem ? 'page' : undefined}>
                  <span className={styles.railNo}>{i + 1}</span>
                  <span className={styles.railName}>{l.frontmatter.title}</span>
                  {lessonDone && <span className={styles.railDone}><Icon name="check" label="done" /></span>}
                </Link>
              </li>
            );
          })}
        </ol>
        <div className={styles.railProgress}>
          <Cells done={doneCount} total={m.lessons.length} label="Lessons done" />
          <span className={styles.nextCount}>{doneCount} of {m.lessons.length} lessons</span>
        </div>
      </aside>
    </div>
  );
}
