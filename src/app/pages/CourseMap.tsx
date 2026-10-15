import { Link } from 'react-router';
import { course, orderedModules } from '../../content-runtime/course';
import { isModuleUnlocked, moduleStatus } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import styles from './Pages.module.css';

export function CourseMap() {
  const progress = useProgress();
  const total = course.modules.reduce((s, m) => s + m.hours, 0);
  const list = orderedModules();
  return (
    <div>
      <section className={styles.hero}>
        <h1>{course.title}</h1>
        <p className={styles.lede}>
          C and the machine underneath it, for people who already build for the web. You'll write real C from the first minute, compiled by
          clang right here in your browser, and by the end you'll match a Harvard CS50 student on everything CS50 teaches through C, then go further:
          the CPU, memory hierarchy, linking and the operating system.
        </p>
        <ul className={styles.facts}>
          <li><strong>{course.modules.length - 1} modules + capstone</strong></li>
          <li><strong>≈{Math.round(total)} hours</strong> · about {Math.round(total / course.hoursPerWeek)} weeks at {course.hoursPerWeek} h/week</li>
          <li><strong>Never passive:</strong> you predict, write, fix or draw every few minutes</li>
        </ul>
      </section>

      <h2 className={styles.sectionTitle}>The course</h2>
      <ol className={styles.moduleGrid}>
        {list.map(({ entry, module }) => {
          const unlocked = module ? isModuleUnlocked(progress, entry.id) : false;
          const st = module ? moduleStatus(progress, entry.id) : null;
          const pct = st ? Math.round(((st.lessonsDone + (st.checkpointPassed ? 1 : 0) + (st.projectPassed ? 1 : 0)) / (st.lessonsTotal + 2)) * 100) : 0;
          const label = entry.number === 'cap' ? 'Capstone' : `Module ${entry.number}`;
          const state = !module ? 'Coming soon' : st?.complete ? 'Complete' : unlocked ? (pct > 0 ? 'In progress' : 'Start here') : 'Locked';
          const body = (
            <>
              <div className={styles.moduleTop}>
                <span className={styles.moduleNo}>{label}</span>
                <span className={`badge ${st?.complete ? 'badge-ok' : unlocked ? 'badge-accent' : ''}`}>{state}</span>
              </div>
              <div className={styles.moduleTitle}>{entry.title}</div>
              <div className={styles.moduleMeta}>{entry.hours} h</div>
              {module && unlocked && <div className={styles.bar} aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>}
            </>
          );
          return (
            <li key={entry.id} className={`${styles.moduleCard} ${!unlocked ? styles.locked : ''}`}>
              {module && unlocked ? <Link to={`/m/${entry.id}`} className={styles.cardLink} aria-label={`${label}: ${entry.title}. ${state}.`}>{body}</Link> : <div aria-label={`${label}: ${entry.title}. ${state}.`}>{body}</div>}
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
