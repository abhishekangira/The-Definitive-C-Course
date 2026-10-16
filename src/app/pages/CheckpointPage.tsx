import { Link, Navigate, useParams } from 'react-router';
import { moduleById } from '../../content-runtime/course';
import { isCheckpointUnlocked, isModuleUnlocked } from '../../progress/gating';
import { useProgress } from '../../progress/store';
import { QuizRunner } from './QuizRunner';
import { Icon } from '../../components/Icon';
import styles from './Pages.module.css';

export function CheckpointPage() {
  const { moduleId = '' } = useParams();
  const m = moduleById(moduleId);
  const progress = useProgress();
  if (!m || !isModuleUnlocked(progress, moduleId)) return <Navigate to="/" replace />;
  if (!isCheckpointUnlocked(progress, moduleId)) return <Navigate to={`/m/${moduleId}`} replace />;
  return (
    <div className={styles.narrow}>
      <nav className={styles.crumbs} aria-label="Breadcrumb"><Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${moduleId}`}>{m.meta.title}</Link></nav>
      <h1>Checkpoint</h1>
      <p className={styles.lede}>Everything from this module, including one problem in a situation you haven't seen. Your first answer to each question counts; you need 80% to pass. There are no hints or solutions here. If you don't pass, review and retake it.</p>
      <QuizRunner moduleId={moduleId} kind="checkpoint" />
      <p><Link to={`/m/${moduleId}`}><Icon name="arrow-left" /> Back to the module</Link></p>
    </div>
  );
}
