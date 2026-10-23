import { useEffect, useState } from 'react';
import type { SamplesFile } from '../../content-model/types';
import { lessonPredictionStats, lessonQuiz } from '../../progress/perfect';
import { Link, Navigate, useParams } from 'react-router';
import { moduleById, quizFor, exercises, samplesFor } from '../../content-runtime/course';
import { isCheckpointUnlocked, isLessonComplete, isModuleUnlocked, moduleStatus } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import { Exercise } from '../../interactions/Exercise';
import { Icon } from '../../components/Icon';
import styles from './Pages.module.css';

const SC_NAMES: Record<string, string> = {
  SC1: 'Source → running process', SC2: 'Memory layout', SC3: 'Pointers, arrays, strings, structs, heap', SC4: 'Debugger and sanitizers',
  SC5: 'Data structures', SC6: 'Big-O, sorting and searching', SC7: 'Data representation and bitwise ops', SC8: 'CPU, registers, caches',
  SC9: 'Reading assembly', SC10: 'System calls and the OS', SC11: 'Multi-file builds, Make, headers, ABI',
};
const LEVEL = { I: 'introduced', D: 'developed', A: 'assessed' } as const;

type StepState = 'done' | 'next' | 'open' | 'locked';
/** The mark at the start of a step: a check when done, the data hue when it is the one to do now, grey otherwise. */
function StepMark({ state }: { state: StepState }) {
  return <span className={`${styles.mark} ${styles[`mark_${state}`]}`} aria-hidden="true"><Icon name={state === 'done' ? 'check' : 'dot'} /></span>;
}

export function ModulePage() {
  const { moduleId = '' } = useParams();
  const m = moduleById(moduleId);
  const [loaded, setLoaded] = useState<{ id: string; samples: SamplesFile | null; failed?: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void samplesFor(moduleId).then(samples => { if (live) setLoaded({ id: moduleId, samples }); })
      .catch(() => { if (live) setLoaded({ id: moduleId, samples: null, failed: true }); });
    return () => { live = false; };
  }, [moduleId]);
  const samples = loaded?.id === moduleId ? loaded.samples : null;
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
  const lessonsState: StepState = st.lessonsDone === st.lessonsTotal ? 'done' : st.retrievalDone ? 'next' : 'locked';
  const checkpointState: StepState = st.checkpointPassed ? 'done' : checkpointOpen ? 'next' : 'locked';
  const label = m.meta.number === 'cap' ? 'Capstone' : `Module ${m.meta.number}`;

  return (
    <div>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/">Course</Link> <span aria-hidden="true">/</span> <span aria-current="page">{label}</span>
      </nav>
      <header className={styles.pageHead}>
        <h1>{m.meta.title}</h1>
        <p className={styles.meta}>{label} · {m.meta.hours} hours · about {m.meta.weeks} weeks</p>
        <p className={styles.lede}>{m.meta.why}</p>
      </header>
      <dl className={styles.timeStrip} aria-label="Time for this module">
        <div><dt>Lessons</dt><dd>{t.lessons} h</dd></div>
        {t.problemSet ? <div><dt>Problem set</dt><dd>{t.problemSet} h</dd></div> : null}
        <div><dt>Project</dt><dd>{t.project} h</dd></div>
        <div><dt>Variants</dt><dd>{t.variants} h</dd></div>
        <div><dt>Quizzes</dt><dd>{t.quizCheckpoint} h</dd></div>
      </dl>

      <div className={styles.moduleGrid}>
        <div>
          <ol className={styles.steps} aria-label="Module steps">
            {hasRetrieval && (
              <li className={styles.step} aria-current={st.retrievalDone ? undefined : 'step'}>
                <StepMark state={st.retrievalDone ? 'done' : 'next'} />
                <div className={styles.stepMain}>
                  <div className={styles.stepHead}><span>Warm-up quiz</span>{st.retrievalDone && <span className="badge badge-ok">done</span>}</div>
                  <p>{moduleId === 'm01' ? 'A quick check of the JavaScript you already know, so we know what to build on.' : 'A few questions from earlier modules: retrieval makes memories stick.'}</p>
                </div>
                <Link className={`btn ${st.retrievalDone ? '' : 'btn-primary'}`} to={`/m/${moduleId}/retrieval`}>{st.retrievalDone ? 'Retake' : 'Start the warm-up'}</Link>
              </li>
            )}
            <li className={styles.step} aria-current={lessonsState === 'next' ? 'step' : undefined}>
              <StepMark state={lessonsState} />
              <div className={`${styles.stepMain} ${styles.stepWide}`}>
                <div className={styles.stepHead}><span>Lessons</span><span className="badge">{st.lessonsDone}/{st.lessonsTotal}</span></div>
                {loaded?.id === moduleId && loaded.failed && <p>Perfect lesson marks unavailable. Reload to try again.</p>}
                <ol className={styles.lessonList}>
                  {m.lessons.map((l, i) => {
                    const done = isLessonComplete(progress, l.frontmatter.id);
                    return (
                      <li key={l.stem}>
                        {st.retrievalDone ? (
                          <Link to={`/m/${moduleId}/${l.stem}`} className={styles.lessonLink}>
                            <span className={styles.lessonNo}>{i + 1}</span>
                            <span className={styles.lessonTitle}>{l.frontmatter.title}{lessonPredictionStats(samples, l.stem, progress, lessonQuiz(l.frontmatter)).perfect && <span className={styles.perfectMark}><Icon name="flame" label="Perfect lesson" /></span>}</span>
                            <span className={styles.lessonMeta}>{l.frontmatter.minutes} min {done ? <span className="badge badge-ok">done</span> : firstOpen?.stem === l.stem ? <span className="badge badge-accent">next</span> : null}</span>
                          </Link>
                        ) : (
                          <span className={`${styles.lessonLink} ${styles.lessonOff}`} aria-disabled="true">
                            <span className={styles.lessonNo}>{i + 1}</span><span className={styles.lessonTitle}>{l.frontmatter.title}{lessonPredictionStats(samples, l.stem, progress, lessonQuiz(l.frontmatter)).perfect && <span className={styles.perfectMark}><Icon name="flame" label="Perfect lesson" /></span>}</span><span className={styles.lessonMeta}>{l.frontmatter.minutes} min</span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {!st.retrievalDone && <p className={styles.muted}>Lessons open after the warm-up quiz.</p>}
              </div>
            </li>
            {m.meta.problemSet.length > 0 && (
              <li className={styles.step}>
                <StepMark state="open" />
                <div className={`${styles.stepMain} ${styles.stepWide}`}>
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
                </div>
              </li>
            )}
            <li className={styles.step}>
              <StepMark state={st.projectPassed ? 'done' : 'open'} />
              <div className={styles.stepMain}>
                <div className={styles.stepHead}><span>Project</span>{st.projectPassed && <span className="badge badge-ok">passed</span>}</div>
                <p>A bigger program with automated checks. Required to finish the module.</p>
              </div>
              <Link className="btn" to={`/m/${moduleId}/project`}>Open the project</Link>
            </li>
            <li className={styles.step} aria-current={checkpointState === 'next' ? 'step' : undefined}>
              <StepMark state={checkpointState} />
              <div className={styles.stepMain}>
                <div className={styles.stepHead}><span>Checkpoint</span>{st.checkpointPassed && <span className="badge badge-ok">passed</span>}</div>
                <p>A mix of everything in this module, including one problem in an unfamiliar setting. You need 80% to unlock the next module.</p>
                {!checkpointOpen && <p className={styles.muted}>Opens when every lesson is complete.</p>}
              </div>
              {checkpointOpen && <Link className="btn" to={`/m/${moduleId}/checkpoint`}>{st.checkpointPassed ? 'Retake' : 'Take the checkpoint'}</Link>}
            </li>
          </ol>

          {st.outstandingVariants.length > 0 && (
            <p className={styles.warnBox}>To finish the module, solve the variant for: {st.outstandingVariants.map(id => exercises[id]?.meta.title ?? id).join(', ')}. You viewed the solution, so a fresh variant proves the skill.</p>
          )}
          {st.complete && <p className={styles.okBox}>Module complete. The next module is unlocked. <Link to="/">Back to the course</Link></p>}
        </div>

        <aside className={styles.side}>
          <section>
            <h2>What you'll be able to do</h2>
            <ul className={styles.scList}>
              {m.meta.successCriteria.map(s => <li key={s.sc}><span className={`badge ${s.level === 'A' ? 'badge-ok' : ''}`}>{s.sc}</span> {SC_NAMES[s.sc] ?? s.sc} <span className={styles.muted}>({LEVEL[s.level]})</span></li>)}
            </ul>
          </section>
          <section>
            <h2>Go deeper (optional)</h2>
            <ul className={styles.resources}>
              {m.meta.resources.map(r => <li key={r.title}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}: {r.detail}</li>)}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
