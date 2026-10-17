// The header's streak: Rio's head in the current form and the number of days, once the learner has submitted a problem
// solution or a quiz answer. It stays while the streak can still be kept (dashed, "at risk") and disappears when it ended.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useNow } from './useNow';
import { useProgress } from '../progress/store';
import { dayWord, streakStatus } from '../progress/streak';
import { formFor, formRank, WARRIOR_NAME, warriorMood } from '../progress/warrior';
import { WarriorHead } from './StreakWarrior';

export function StreakChip({ className, riskClassName }: { className?: string; riskClassName?: string }) {
  const streak = useProgress().streak;
  const st = streakStatus(streak, useNow());
  const form = formFor(st.current);
  const [announce, setAnnounce] = useState('');
  const seen = useRef(st.current);
  // The head pops only for a form reached while the page is open, not on page load.
  const firstForm = useRef(form.id);
  useEffect(() => {
    // Tell screen reader users when the streak grows (not on page load).
    if (st.current > seen.current) {
      const grown = formRank(formFor(st.current).id) > formRank(formFor(seen.current).id);
      setAnnounce(`${st.current === 1 ? 'Streak started: 1 day.' : `Streak: ${dayWord(st.current)}.`}${grown ? ` ${WARRIOR_NAME} reached a new form: ${formFor(st.current).name}.` : ''}`);
    }
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
          <WarriorHead form={form.id} mood={warriorMood(st)} pop={form.id !== firstForm.current} />
          <span aria-hidden="true">{st.current}</span>
        </Link>
      )}
      <span className="visually-hidden" role="status">{announce}</span>
    </>
  );
}
