// The streak pet's mood, derived from the streak status. The pet is sad when no streak is running (never started, or a
// day was missed), worried on the day after a submission (today's first one keeps the streak), and happier the longer
// an active streak gets.
import { dayWord, type StreakStatus } from './streak';

export type PetMood = 'sad' | 'worried' | 'content' | 'happy' | 'joyful' | 'ecstatic';

/** Streak lengths (in days) at which an active streak makes the pet happier. */
export const HAPPY_AT = 3;
export const JOYFUL_AT = 7;
export const ECSTATIC_AT = 30;

export function petMood(st: StreakStatus): PetMood {
  if (st.state === 'none') return 'sad';
  if (st.state === 'at-risk') return 'worried';
  if (st.current >= ECSTATIC_AT) return 'ecstatic';
  if (st.current >= JOYFUL_AT) return 'joyful';
  if (st.current >= HAPPY_AT) return 'happy';
  return 'content';
}

/** One short line for the pet to say, in the mood's voice. */
export function petMessage(st: StreakStatus): string {
  switch (petMood(st)) {
    case 'sad':
      return st.longest > 0
        ? 'Your streak ended. Submit a problem solution or a quiz answer today and I will cheer up.'
        : 'No streak yet. Submit a problem solution or a quiz answer and I will perk up.';
    case 'worried':
      return `Your ${dayWord(st.current)} streak needs a submission today. Please don't let it go!`;
    case 'content':
      return st.current === 1 ? 'A streak has started. Come back tomorrow to keep it going.' : `${dayWord(st.current)} in a row. Nice and steady.`;
    case 'happy':
      return `${dayWord(st.current)} in a row. I'm feeling great!`;
    case 'joyful':
      return `${dayWord(st.current)} in a row! Look at us go!`;
    case 'ecstatic':
      return `${dayWord(st.current)} in a row! I'm over the moon!`;
  }
}
