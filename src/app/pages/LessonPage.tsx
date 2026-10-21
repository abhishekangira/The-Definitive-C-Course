import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { MDXProvider } from '@mdx-js/react';
import { lessonLoader, moduleById, samplesFor, sessionsFor } from '../../content-runtime/course';
import { mdxComponents } from '../../content-runtime/mdx-components';
import { LessonProvider } from '../../lesson/LessonContext';
import { isModuleUnlocked, moduleStatus } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import type { SamplesFile, SessionsFile } from '../../content-model/types';
import { preloadCodeEditor } from '../../components/CodeEditor';
import { getRuntime } from '../../runtime/CRuntime';
import { Icon } from '../../components/Icon';
import { Cells } from '../../components/Cells';
import { LESSON_CHAT_ID, LessonChat, type LessonChatHandle } from '../../tutor/LessonChat';
import { lessonTextFrom } from '../../tutor/lessonText';
import { SelectionToolbar } from '../../tutor/SelectionToolbar';
import { useTutorSettings } from '../../tutor/settings';
import chatStyles from '../../tutor/LessonChat.module.css';
import styles from './Pages.module.css';

export function LessonPage() {
  const { moduleId = '', lessonStem = '' } = useParams();
  const m = moduleById(moduleId);
  const progress = useProgress();
  const [Lesson, setLesson] = useState<ComponentType<{ components?: Record<string, unknown> }> | null>(null);
  const [samples, setSamples] = useState<SamplesFile | null | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionsFile | null | undefined>(undefined);
  const storedMode = Boolean(progress.settings.storedOutputMode);
  // The lesson chat and the highlight toolbar exist only for a learner who has set the tutor up.
  const tutorOn = Boolean(useTutorSettings().apiKey);
  const [chatOpen, setChatOpen] = useState(false);
  const chat = useRef<LessonChatHandle>(null);
  const prose = useRef<HTMLDivElement>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  const readLesson = useCallback(() => (prose.current ? lessonTextFrom(prose.current) : ''), []);
  // The button is hidden while the chat is open, so focus returns to it only after it is visible again.
  const refocus = useRef(false);
  const closeChat = useCallback(() => { refocus.current = true; setChatOpen(false); }, []);
  useEffect(() => {
    if (!chatOpen && refocus.current) { refocus.current = false; askButton.current?.focus(); }
  }, [chatOpen]);
  useEffect(() => { if (!tutorOn) setChatOpen(false); }, [tutorOn]);

  useEffect(() => {
    // Start from nothing, and drop whatever arrives after the learner has moved on: a slow load for the previous
    // lesson or module must not replace this one's lesson, samples or sessions.
    let live = true;
    setLesson(null);
    setSamples(undefined);
    setSessions(undefined);
    preloadCodeEditor();
    const load = lessonLoader(moduleId, lessonStem);
    if (load) void load().then(mod => { if (live) setLesson(() => mod.default); });
    void samplesFor(moduleId).then(s => { if (live) setSamples(s); });
    void sessionsFor(moduleId).then(s => { if (live) setSessions(s); });
    // Warm the compiler in the background once the learner is reading a lesson (not in low-memory mode).
    const t = storedMode ? undefined : setTimeout(() => getRuntime().prefetch(), 1500);
    return () => { live = false; clearTimeout(t); };
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
    <div className={styles.lessonLayout} data-tutor={tutorOn ? '' : undefined} data-chat={tutorOn && chatOpen ? 'open' : undefined}>
      {/* First in the DOM, so the keyboard reaches the chat early; it is position: fixed, so this does not move it. */}
      {tutorOn && (
        <button
          type="button" ref={askButton} className={`btn ${chatStyles.fab}`} aria-expanded={chatOpen} aria-controls={LESSON_CHAT_ID}
          data-open={chatOpen ? 'true' : undefined} onClick={() => setChatOpen(true)}
        ><Icon name="chat" /> Ask the tutor</button>
      )}
      <article className={styles.lesson}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${moduleId}`}>{label}</Link>
        </nav>
        <h1>{lesson.frontmatter.title}</h1>
        <div className={styles.lessonMeta}>
          <p className={styles.meta}>Lesson {idx + 1} of {m.lessons.length} · {lesson.frontmatter.minutes} min</p>
        </div>
        {Lesson && samples !== undefined && sessions !== undefined ? (
          <LessonProvider lessonId={lesson.frontmatter.id} moduleId={moduleId} samples={samples} sessions={sessions}>
            <MDXProvider components={mdxComponents}>
              <div ref={prose} className={styles.prose}><Lesson components={mdxComponents} /></div>
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
      {tutorOn && (
        <>
          <SelectionToolbar container={prose} onAction={(action, quote) => { setChatOpen(true); chat.current?.ask(action, quote); }} />
          <LessonChat
            key={lesson.frontmatter.id} ref={chat} open={chatOpen} onClose={closeChat}
            title={lesson.frontmatter.title} moduleLabel={label} readLesson={readLesson}
          />
        </>
      )}
    </div>
  );
}
