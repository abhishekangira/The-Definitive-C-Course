import { update, useProgress, type Platform } from '../progress/store';
import { PLATFORM_LABEL } from './platform';
import styles from './Interaction.module.css';

/** "Which machine will you use?" Chooses which stored native output to show. */
export function PlatformPicker() {
  const progress = useProgress();
  return (
    <label className={styles.platform}>
      <span>Your machine:</span>
      <select value={progress.settings.platform ?? ''} onChange={e => update(p => { p.settings.platform = (e.target.value || undefined) as Platform | undefined; })}>
        <option value="">Choose…</option>
        {(Object.keys(PLATFORM_LABEL) as Platform[]).map(k => <option key={k} value={k}>{PLATFORM_LABEL[k]}</option>)}
      </select>
    </label>
  );
}
