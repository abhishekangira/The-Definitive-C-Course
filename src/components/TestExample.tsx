// Shows one test case of an exercise or project (input and the exact expected output) straight from its
// generated tests.json/check.json, so examples on project pages are never typed by hand.
import { useEffect, useState } from 'react';
import { exercises, testsFor } from '../content-runtime/course';
import type { IoTest } from '../content-model/types';
import styles from './Content.module.css';

export function TestExample({ exercise, test, caption }: { exercise: string; test: string; caption?: string }) {
  const [found, setFound] = useState<IoTest | null | undefined>(undefined);
  useEffect(() => {
    const entry = exercises[exercise];
    if (!entry) { setFound(null); return; }
    void testsFor(entry.moduleId, entry.folder).then(spec => {
      const t = spec?.tests.find(x => x.name === test);
      setFound(t && 'run' in t && !('unit' in t) && !('make' in t) ? (t as IoTest) : null);
    });
  }, [exercise, test]);
  if (found === undefined) return null;
  if (found === null) return <p className={styles.missing}>Example "{test}" not found in {exercise}.</p>;
  const stdin = found.run.stdin ?? '';
  return (
    <figure className={styles.example}>
      {caption && <figcaption>{caption}</figcaption>}
      {stdin && <div className={styles.exampleRow}><span className={styles.exampleLabel}>Input typed</span><pre>{stdin.replace(/\n$/, '').split('\n').map(l => l || '(empty line)').join('\n')}</pre></div>}
      <div className={styles.exampleRow}><span className={styles.exampleLabel}>Output</span><pre>{typeof found.expect.stdout === 'string' ? found.expect.stdout : found.expect.stdout?.equals ?? ''}</pre></div>
    </figure>
  );
}
