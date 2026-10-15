import { Link } from 'react-router';
import styles from './Pages.module.css';

export function NotFound() {
  return (
    <div className={styles.narrow}>
      <h1>Page not found</h1>
      <p>That page doesn't exist (yet). It might belong to a module that hasn't been built.</p>
      <Link to="/" className="btn btn-primary">Go to the course map</Link>
    </div>
  );
}
