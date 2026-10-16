import { isRouteErrorResponse, useRouteError } from 'react-router';
import { NotFound } from './NotFound';
import styles from './Pages.module.css';

/**
 * Error element for every route. A missing page is a 404 route response and shows the not-found page; anything else
 * (typically a lazy chunk that failed to load: offline, or a stale chunk after a deploy) must not claim the page
 * does not exist, so it says what happened and offers a reload, which also picks up a newer deploy.
 */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return (
    <div className={styles.narrow} role="alert">
      <h1>This page could not be loaded</h1>
      <p>Part of the app failed to download. You may be offline, or the site may have been updated while this tab was open. Check your connection, then retry. If it keeps failing, reload the tab.</p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button>
    </div>
  );
}
