import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useEffect } from 'react';
import { useTheme, type ThemeChoice } from './theme';
import { useProgress, daysSinceExport } from '../progress/store';
import { course } from '../content-runtime/course';
import styles from './Layout.module.css';

const THEME_LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };

export function Layout({ children }: { children?: ReactNode }) {
  const [theme, setTheme] = useTheme();
  const progress = useProgress();
  const location = useLocation();
  const days = daysSinceExport(progress);
  const hasProgress = Object.keys(progress.lessons).length > 0;
  const remindExport = hasProgress && (days === null || days >= 7);

  // Move focus to the main heading on navigation, so screen readers announce the new page.
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>('main h1');
    h1?.setAttribute('tabindex', '-1');
    h1?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label={`${course.title}: course map`}>
          <span className={styles.logo} aria-hidden="true">C</span>
          <span className={styles.title}>{course.title}</span>
        </Link>
        <nav className={styles.nav} aria-label="Site">
          <NavLink to="/" end className={({ isActive }) => (isActive ? styles.active : undefined)}>Course</NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? styles.active : undefined)}>Progress &amp; settings</NavLink>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${styles.themeBtn}`}
            onClick={() => setTheme(NEXT[theme])}
            aria-label={`${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT[theme]].toLowerCase()}.`}
            title={`${THEME_LABEL[theme]} (click to change)`}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}</span>
          </button>
        </nav>
      </header>
      {remindExport && location.pathname !== '/settings' && (
        <div className={styles.banner} role="note">
          Your progress lives only in this browser. <Link to="/settings">Export a backup</Link>
          {days === null ? '' : ` (last export ${days} days ago)`}.
        </div>
      )}
      <main id="main" tabIndex={-1} className={styles.main}>
        {children ?? <Outlet />}
      </main>
      <footer className={styles.footer}>
        <span>Real C, compiled in your browser by clang. </span>
        <Link to="/about">About &amp; licenses</Link>
      </footer>
    </div>
  );
}
