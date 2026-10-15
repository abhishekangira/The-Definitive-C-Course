import { Link, Navigate, useParams } from 'react-router';
import { moduleById } from '../../content-runtime/course';
import { isModuleUnlocked } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import { QuizRunner } from './QuizRunner';
import styles from './Pages.module.css';

export function RetrievalPage() {
  const { moduleId = '' } = useParams();
  const m = moduleById(moduleId);
  const progress = useProgress();
  if (!m || !isModuleUnlocked(progress, moduleId)) return <Navigate to="/" replace />;
  return (
    <div className={styles.narrow}>
      <nav className={styles.crumbs} aria-label="Breadcrumb"><Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${moduleId}`}>{m.meta.title}</Link></nav>
      <h1>Warm-up</h1>
      <p className={styles.lede}>{moduleId === 'm01'
        ? 'Before any C: a few questions about the JavaScript you already know. Some JS behaviours you take for granted are exactly what C does differently, so we will come back to them.'
        : 'Questions from earlier modules. Pulling things back out of memory is how they stay there. This quiz is not graded.'}</p>
      <QuizRunner moduleId={moduleId} kind="retrieval" />
      <p><Link to={`/m/${moduleId}`}>← Back to the module</Link></p>
    </div>
  );
}
