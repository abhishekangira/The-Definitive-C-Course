import { useEffect, useState } from 'react';
import type { SamplesFile } from '../../content-model/types';
import { coursePredictionStats } from '../../progress/perfect';
import { Link } from 'react-router';
import { course, modules, orderedModules, samplesFor } from '../../content-runtime/course';
import { isModuleUnlocked, moduleStatus } from '../../progress/gating';
import { moduleLabel, nextStep } from '../../progress/next';
import { Cells } from '../../components/Cells';
import { StreakWarrior } from '../../components/StreakWarrior';
import { useProgress } from '../../progress/store';
import styles from './Pages.module.css';

export function CourseMap() {
  const progress = useProgress();
  const [loaded, setLoaded] = useState<Array<{ samples: SamplesFile | null; lessons: Array<{ stem: string }> }> | null>(null);
  const [samplesFailed, setSamplesFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all(Object.entries(modules).map(async ([id, m]) => ({ samples: await samplesFor(id), lessons: m.lessons })))
      .then(value => { if (live) setLoaded(value); }).catch(() => { if (live) setSamplesFailed(true); });
    return () => { live = false; };
  }, []);
  const perfect = loaded ? coursePredictionStats(loaded, progress) : null;
  const total = course.modules.reduce((s, m) => s + m.hours, 0);
  const list = orderedModules();
  const next = nextStep(progress);
  const nextModule = next.moduleId ? list.find(x => x.entry.id === next.moduleId) : undefined;
  const nextStatus = next.moduleId ? moduleStatus(progress, next.moduleId) : null;
  return (
    <div>
      <header className={styles.homeTitle}>
        <h1>{course.title}</h1>
        <p className={styles.lede}>
          C and the machine underneath it, for people who already build for the web. You'll write real C from the first minute, compiled by
          clang right here in your browser, and by the end you'll match a Harvard CS50 student on everything CS50 teaches through C, then go further:
          the CPU, memory hierarchy, linking and the operating system.
        </p>
        <p className={styles.muted}>Just want to try C? Open the <Link to="/playground">playground</Link>: a free editor and compiler, no quiz or progress needed.</p>
      </header>

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.upNext} ${styles.span8}`} aria-labelledby="up-next">
          <h2 id="up-next" className={styles.cardLabel}>Up next</h2>
          <div>
            <p className={styles.nextTitle}>{next.title}</p>
            <p className={styles.nextWhere}>{next.where}</p>
          </div>
          {nextStatus && nextModule && (
            <div className={styles.nextProgress}>
              <Cells done={nextStatus.lessonsDone + (nextStatus.projectPassed ? 1 : 0) + (nextStatus.checkpointPassed ? 1 : 0)} total={nextStatus.lessonsTotal + 2} label={`${moduleLabel(nextModule.entry)} steps done`} />
              <span className={styles.nextCount}>{nextStatus.lessonsDone} of {nextStatus.lessonsTotal} lessons</span>
            </div>
          )}
          <div className={styles.actions}>
            {next.to ? <Link className="btn btn-primary" to={next.to}>{next.verb}</Link> : <Link className="btn btn-primary" to="/playground">Open the playground</Link>}
            {next.moduleId && next.kind !== 'warmup' && <Link className="btn" to={`/m/${next.moduleId}`}>See the module</Link>}
          </div>
        </section>
        <section className={`${styles.card} ${styles.streakCard} ${styles.span4}`} aria-label="Your streak">
          <StreakWarrior size={104} />
        </section>
      </div>

      {samplesFailed && <p>Perfect lesson counts unavailable. Reload to try again.</p>}
      {perfect && <p data-perfect-total="">Perfect lessons: {perfect.perfect} of {perfect.total}</p>}
      <div className={styles.ledgerHead}>
        <h2>The course</h2>
        <ul className={styles.facts}>
          <li><strong>{course.modules.length - 1} modules + capstone</strong></li>
          <li><strong>≈{Math.round(total)} hours</strong> · about {Math.round(total / course.hoursPerWeek)} weeks at {course.hoursPerWeek} h/week</li>
          <li><strong>Never passive:</strong> you predict, write, fix or draw every few minutes</li>
        </ul>
      </div>
      <ol className={styles.ledger}>
        {list.map(({ entry, module }) => {
          const unlocked = module ? isModuleUnlocked(progress, entry.id) : false;
          const st = module ? moduleStatus(progress, entry.id) : null;
          const done = st ? st.lessonsDone + (st.checkpointPassed ? 1 : 0) + (st.projectPassed ? 1 : 0) : 0;
          const steps = st ? st.lessonsTotal + 2 : 0;
          const label = moduleLabel(entry);
          const state = !module ? 'Coming soon' : st?.complete ? 'Complete' : unlocked ? (done > 0 ? 'In progress' : 'Start here') : 'Locked';
          const body = (
            <>
              <span className={styles.rowNo}>{label}</span>
              <span className={styles.rowTitle}>{entry.title}</span>
              <span className={styles.rowCells}>{module && unlocked ? <Cells done={done} total={steps} label={`${label} steps done`} /> : null}</span>
              <span className={styles.rowHours}>{entry.hours} h</span>
              <span className={styles.rowState}>
                {st?.complete ? <span className="badge badge-ok">{state}</span> : unlocked ? <span className="badge badge-accent">{state}</span> : <span className={styles.stateText}>{state}</span>}
              </span>
            </>
          );
          return (
            <li key={entry.id}>
              {module && unlocked
                ? <Link to={`/m/${entry.id}`} className={styles.row} aria-label={`${label}: ${entry.title}. ${state}.`}>{body}</Link>
                : <div className={`${styles.row} ${styles.soon}`} aria-label={`${label}: ${entry.title}. ${state}.`}>{body}</div>}
            </li>
          );
        })}
      </ol>

      <section className={styles.how}>
        <h2>How it works</h2>
        <div className={styles.howGrid}>
          <div><h3>Predict, then run</h3><p>Every code example asks you to commit to what it will print before the Run button unlocks. Wrong guesses are where the learning happens.</p></div>
          <div><h3>Real tools</h3><p>Real clang error messages from the first lesson. From Module 3 you'll also use your own compiler, debugger and AddressSanitizer.</p></div>
          <div><h3>Your pace, your browser</h3><p>No account and no server: progress lives in this browser. Export a backup from <Link to="/settings">Progress &amp; settings</Link>.</p></div>
        </div>
      </section>
    </div>
  );
}
