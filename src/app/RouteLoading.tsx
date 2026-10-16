/** Shown while the first page chunk loads. A polite status, so screen readers hear it; no layout of its own. */
export function RouteLoading() {
  return <p role="status" style={{ padding: 'var(--space-4, 1rem)' }}>Loading…</p>;
}
