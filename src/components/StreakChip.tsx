// The header's streak: a flame and the number of days, once the learner has submitted a problem solution or a quiz answer.
// It stays on the day after a submission (dashed, "at risk") and disappears when a whole day was missed.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useProgress } from '../progress/store';
import { dayWord, streakStatus } from '../progress/streak';
import { Icon } from './Icon';

/** The current time, refreshed every minute, so the chip is right in a tab that stays open past midnight. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function StreakChip({ className, riskClassName }: { className?: string; riskClassName?: string }) {
  const streak = useProgress().streak;
  const st = streakStatus(streak, useNow());
  const [announce, setAnnounce] = useState('');
  const seen = useRef(st.current);
  useEffect(() => {
    // Tell screen reader users when the streak grows (not on page load).
    if (st.current > seen.current) setAnnounce(st.current === 1 ? 'Streak started: 1 day.' : `Streak: ${dayWord(st.current)}.`);
    seen.current = st.current;
  }, [st.current]);
  const atRisk = st.state === 'at-risk';
  const label = atRisk
    ? `Streak: ${dayWord(st.current)}. Submit a problem solution or a quiz answer today to keep it going.`
    : `Streak: ${dayWord(st.current)}. You have submitted something today.`;
  // The live region keeps its place in the tree whether or not the chip is shown, so a first submission is announced.
  return (
    <>
      {st.state !== 'none' && (
        <Link to="/settings" className={`${className ?? ''} ${atRisk ? riskClassName ?? '' : ''}`.trim()} aria-label={label} title={label} data-streak={st.state}>
          <Icon name="flame" />
          <span aria-hidden="true">{st.current}</span>
        </Link>
      )}
      <span className="visually-hidden" role="status">{announce}</span>
    </>
  );
}
