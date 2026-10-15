import { Link, Navigate, useParams } from 'react-router';
import { moduleById, quizFor, exercises } from '../../content-runtime/course';
import { isCheckpointUnlocked, isLessonComplete, isModuleUnlocked, moduleStatus } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import { Exercise } from '../../interactions/Exercise';
import styles from './Pages.module.css';

const SC_NAMES: Record<string, string> = {
  SC1: 'Source → running process', SC2: 'Memory layout', SC3: 'Pointers, arrays, strings, structs, heap', SC4: 'Debugger and sanitizers',
  SC5: 'Data structures', SC6: 'Big-O, sorting and searching', SC7: 'Data representation and bitwise ops', SC8: 'CPU, registers, caches',
  SC9: 'Reading assembly', SC10: 'System calls and the OS', SC11: 'Multi-file builds, Make, headers, ABI',
};
const LEVEL = { I: 'introduced', D: 'developed', A: 'assessed' } as const;

export function ModulePage() {
  const { moduleId = '' } = useParams();
  const m = moduleById(moduleId);
  const progress = useProgress();
  if (!m) return <Navigate to="/" replace />;
  if (!isModuleUnlocked(progress, moduleId)) {
    return (
      <div className={styles.narrow}>
        <h1>{m.meta.title}</h1>
        <p>This module unlocks when you complete the previous one (its checkpoint and project).</p>
        <Link to="/" className="btn">Back to the course</Link>
      </div>
    );
  }
  const st = moduleStatus(progress, moduleId);
  const hasRetrieval = quizFor(moduleId, 'retrieval').length > 0;
  const checkpointOpen = isCheckpointUnlocked(progress, moduleId);
  const t = m.meta.time;
  const firstOpen = m.lessons.find(l => !isLessonComplete(progress, l.frontmatter.id));

  return (
    <div className={styles.narrow}>
      <p className={styles.eyebrow}>{m.meta.number === 'cap' ? 'Capstone' : `Module ${m.meta.number}`} · {m.meta.hours} hours · about {m.meta.weeks} weeks</p>
      <h1>{m.meta.title}</h1>
      <p className={styles.lede}>{m.meta.why}</p>
      <p className={styles.timeLine}>
        Time: lessons {t.lessons} h{t.problemSet ? ` · problem set ${t.problemSet} h` : ''} · project {t.project} h · variants {t.variants} h · quizzes {t.quizCheckpoint} h
      </p>

      <ol className={styles.steps} aria-label="Module steps">
        {hasRetrieval && (
          <li className={st.retrievalDone ? styles.stepDone : styles.stepNext}>
            <div className={styles.stepHead}><span>Warm-up quiz</span>{st.retrievalDone && <span className="badge badge-ok">done</span>}</div>
            <p>{moduleId === 'm01' ? 'A quick check of the JavaScript you already know, so we know what to build on.' : 'A few questions from earlier modules: retrieval makes memories stick.'}</p>
            <Link className={`btn ${st.retrievalDone ? '' : 'btn-primary'}`} to={`/m/${moduleId}/retrieval`}>{st.retrievalDone ? 'Retake' : 'Start the warm-up'}</Link>
          </li>
        )}
        <li className={st.lessonsDone === st.lessonsTotal ? styles.stepDone : st.retrievalDone ? styles.stepNext : styles.stepLocked}>
          <div className={styles.stepHead}><span>Lessons</span><span className="badge">{st.lessonsDone}/{st.lessonsTotal}</span></div>
          <ol className={styles.lessonList}>
            {m.lessons.map((l, i) => {
              const done = isLessonComplete(progress, l.frontmatter.id);
              return (
                <li key={l.stem}>
                  {st.retrievalDone ? (
                    <Link to={`/m/${moduleId}/${l.stem}`} className={styles.lessonLink}>
                      <span className={styles.lessonNo}>{i + 1}</span>
                      <span className={styles.lessonTitle}>{l.frontmatter.title}</span>
                      <span className={styles.lessonMeta}>{l.frontmatter.minutes} min {done ? <span className="badge badge-ok">done</span> : firstOpen?.stem === l.stem ? <span className="badge badge-accent">next</span> : null}</span>
                    </Link>
                  ) : (
                    <span className={styles.lessonLink} aria-disabled="true">
                      <span className={styles.lessonNo}>{i + 1}</span><span className={styles.lessonTitle}>{l.frontmatter.title}</span><span className={styles.lessonMeta}>{l.frontmatter.minutes} min</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {!st.retrievalDone && <p className={styles.muted}>Lessons open after the warm-up quiz.</p>}
        </li>
        {m.meta.problemSet.length > 0 && (
          <li className={styles.stepPlain}>
            <div className={styles.stepHead}><span>Problem set</span></div>
            <p>Practice problems that mirror CS50's problem set for this material. Solve them in the browser.</p>
            {m.meta.problemSet.map(id => (
              <details key={id} className={styles.problem}>
                <summary>
                  {exercises[id]?.meta.title ?? id}
                  {progress.exercises[id]?.passed && <span className="badge badge-ok">passed</span>}
                </summary>
                {st.retrievalDone ? <Exercise id={id} /> : <p className={styles.muted}>Opens after the warm-up quiz.</p>}
              </details>
            ))}
          </li>
        )}
        <li className={st.projectPassed ? styles.stepDone : styles.stepPlain}>
          <div className={styles.stepHead}><span>Project</span>{st.projectPassed && <span className="badge badge-ok">passed</span>}</div>
          <p>A bigger program with automated checks. Required to finish the module.</p>
          <Link className="btn" to={`/m/${moduleId}/project`}>Open the project</Link>
        </li>
        <li className={st.checkpointPassed ? styles.stepDone : checkpointOpen ? styles.stepNext : styles.stepLocked}>
          <div className={styles.stepHead}><span>Checkpoint</span>{st.checkpointPassed && <span className="badge badge-ok">passed</span>}</div>
          <p>A mix of everything in this module, including one problem in an unfamiliar setting. You need 80% to unlock the next module.</p>
          {checkpointOpen ? <Link className="btn" to={`/m/${moduleId}/checkpoint`}>{st.checkpointPassed ? 'Retake' : 'Take the checkpoint'}</Link> : <p className={styles.muted}>Opens when every lesson is complete.</p>}
        </li>
      </ol>

      {st.outstandingVariants.length > 0 && (
        <p className={styles.warnBox}>To finish the module, solve the variant for: {st.outstandingVariants.map(id => exercises[id]?.meta.title ?? id).join(', ')}. You viewed the solution, so a fresh variant proves the skill.</p>
      )}
      {st.complete && <p className={styles.okBox}>Module complete. The next module is unlocked. <Link to="/">Back to the course</Link></p>}

      <section>
        <h2>What you'll be able to do</h2>
        <ul className={styles.scList}>
          {m.meta.successCriteria.map(s => <li key={s.sc}><span className={`badge ${s.level === 'A' ? 'badge-ok' : ''}`}>{s.sc}</span> {SC_NAMES[s.sc] ?? s.sc} <span className={styles.muted}>({LEVEL[s.level]})</span></li>)}
        </ul>
        <h2>Go deeper (optional)</h2>
        <ul>
          {m.meta.resources.map(r => <li key={r.title}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}: {r.detail}</li>)}
        </ul>
      </section>
    </div>
  );
}
