import { useEffect, useState } from 'react';

/** The current time, refreshed every minute, so the streak is right in a tab that stays open past midnight. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
