import { useEffect, useState, type ComponentType } from 'react';
import { preloadCodeEditor } from '../../components/CodeEditor';
import { Link, Navigate, useParams } from 'react-router';
import { MDXProvider } from '@mdx-js/react';
import { exercises, folderFiles, moduleById, projectLoader } from '../../content-runtime/course';
import { mdxComponents } from '../../content-runtime/mdx-components';
import { isModuleUnlocked } from '../../progress/gating';
import { update, useProgress } from '../../progress/store';
import { Exercise } from '../../interactions/Exercise';
import { LocalTask } from '../../interactions/LocalTask';
import { buildZip, downloadBlob } from '../../interactions/zip';
import styles from './Pages.module.css';

export function ProjectPage() {
  const { moduleId = '' } = useParams();
  const m = moduleById(moduleId);
  const progress = useProgress();
  const [Page, setPage] = useState<ComponentType<{ components?: Record<string, unknown> }> | null>(null);
  useEffect(() => {
    preloadCodeEditor();
    const load = projectLoader(moduleId);
    if (load) void load().then(mod => setPage(() => mod.default));
  }, [moduleId]);
  if (!m) return <Navigate to="/" replace />;
  if (!isModuleUnlocked(progress, moduleId)) return <Navigate to={`/m/${moduleId}`} replace />;
  const projectId = m.meta.project;
  const entry = exercises[`project/${projectId}`];
  const passed = Boolean(progress.projects[projectId]?.passed);
  const markPassed = () => update(p => { p.projects[projectId] ??= { passed: true, at: new Date().toISOString() }; p.projects[projectId].passed = true; });

  const download = async () => {
    if (!entry) return;
    const files = await folderFiles(moduleId, entry.folder);
    downloadBlob(await buildZip({ name: projectId, files, exerciseId: entry.id, seed: progress.seed }), `${projectId}.zip`);
  };

  return (
    <div className={styles.narrow}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${moduleId}`}>{m.meta.number === 'cap' ? 'Capstone' : `Module ${m.meta.number}`}</Link>
      </nav>
      <p className={styles.eyebrow}>Project {passed && <span className="badge badge-ok">passed</span>}</p>
      {Page ? <MDXProvider components={mdxComponents}><div className={styles.prose}><Page components={mdxComponents} /></div></MDXProvider> : <h1>Project</h1>}
      {!entry ? <p className={styles.warnBox}>This project's files are missing.</p> : entry.meta.runsIn === 'native' ? (
        <LocalTask entry={entry} projectId={projectId} />
      ) : (
        <>
          <Exercise id={entry.id} onPassed={markPassed} />
          <p className={styles.muted}>
            Prefer your own editor? <button type="button" className="btn btn-sm" onClick={download}>Download the starter + test runner</button> After Module 3 you can run
            {' '}<code>make test</code> locally, and paste the token it prints here instead.
          </p>
        </>
      )}
      {passed && <p className={styles.okBox}>Project passed. <Link to={`/m/${moduleId}`}>Back to the module</Link></p>}
    </div>
  );
}
