import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useEffect, useState } from 'react';
import { useTheme, type ThemeChoice } from './theme';
import { useProgress, daysSinceExport, storageWorks } from '../progress/store';
import { course } from '../content-runtime/course';
import styles from './Layout.module.css';

const THEME_LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };

/** Inline SVG icons: the Unicode glyphs (sun, moon, half circle) are missing from most UI fonts. */
function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (theme === 'dark') return <svg {...common}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
  if (theme === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" /></svg>;
}

export function Layout({ children }: { children?: ReactNode }) {
  const [theme, setTheme] = useTheme();
  const progress = useProgress();
  const location = useLocation();
  const [persistent] = useState(storageWorks);
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
          <NavLink to="/playground" className={({ isActive }) => (isActive ? styles.active : undefined)}>Playground</NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? styles.active : undefined)}>Progress &amp; settings</NavLink>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${styles.themeBtn}`}
            onClick={() => setTheme(NEXT[theme])}
            aria-label={`${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT[theme]].toLowerCase()}.`}
            title={`${THEME_LABEL[theme]} (click to change)`}
          >
            <ThemeIcon theme={theme} />
          </button>
        </nav>
      </header>
      {!persistent && (
        <div className={styles.banner} role="status">
          This browser is blocking site storage (a private window or blocked site data), so your progress will be lost when you close the tab.
          {' '}Allow storage for this site, or <Link to="/settings">export a backup</Link> before you leave.
        </div>
      )}
      {persistent && remindExport && location.pathname !== '/settings' && (
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
