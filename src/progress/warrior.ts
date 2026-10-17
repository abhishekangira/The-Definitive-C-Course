// Rio, the streak warrior: a kid who trains every day the learner submits something and powers up through six forms as
// the streak grows. The form follows the current streak, so a broken streak sends Rio back to the kid. The gallery keeps
// every form the longest streak has reached. The art is in src/components/WarriorArt.tsx.
import { dayWord, MAX_BEANS, type StreakStatus } from './streak';

export const WARRIOR_NAME = 'Rio';

export type FormId = 'kid' | 'warrior' | 'golden' | 'mane' | 'crimson' | 'ape';

export interface WarriorForm {
  id: FormId;
  /** The streak (in days) that reaches this form. */
  at: number;
  name: string;
  /** What Rio says on an active streak in this form. */
  cheer: (days: number) => string;
}

export const FORMS: readonly WarriorForm[] = [
  { id: 'kid', at: 1, name: 'Kid', cheer: n => (n === 1 ? 'Rio has started training. Come back tomorrow to keep the streak going.' : `${dayWord(n)} in a row. Rio is getting stronger.`) },
  { id: 'warrior', at: 3, name: 'Warrior', cheer: n => `${dayWord(n)} in a row. Rio has grown into a warrior!` },
  { id: 'golden', at: 7, name: 'Golden Warrior', cheer: n => `${dayWord(n)} in a row. Rio's hair blazes gold!` },
  { id: 'mane', at: 14, name: 'Golden Mane', cheer: n => `${dayWord(n)} in a row. Rio's golden mane crackles with lightning!` },
  { id: 'crimson', at: 30, name: 'Crimson Fur', cheer: n => `${dayWord(n)} in a row. Crimson fur and unstoppable focus!` },
  { id: 'ape', at: 50, name: 'Great Ape', cheer: n => `${dayWord(n)} in a row. Rio has become the Great Ape. Legendary!` },
];

export type WarriorMood = 'defeated' | 'worried' | 'ready';

export function formRank(id: FormId): number {
  return FORMS.findIndex(f => f.id === id);
}

export function formById(id: FormId): WarriorForm {
  return FORMS[formRank(id)];
}

export function isFormId(v: unknown): v is FormId {
  return FORMS.some(f => f.id === v);
}

/** The form a streak of `days` reaches (the kid below the first threshold). */
export function formFor(days: number): WarriorForm {
  return FORMS.reduce((best, f) => (days >= f.at ? f : best), FORMS[0]);
}

/** The next form and the days still needed to reach it, or null at the last form. */
export function nextForm(days: number): { form: WarriorForm; in: number } | null {
  const f = FORMS.find(x => x.at > days);
  return f ? { form: f, in: f.at - days } : null;
}

/** Every form a streak this long has ever reached (the kid always). */
export function reachedForms(longest: number): FormId[] {
  return FORMS.filter(f => f.at <= Math.max(1, longest)).map(f => f.id);
}

export function warriorMood(st: StreakStatus): WarriorMood {
  return st.state === 'none' ? 'defeated' : st.state === 'at-risk' ? 'worried' : 'ready';
}

/** One short line from Rio, in the mood's voice. */
export function warriorMessage(st: StreakStatus): string {
  switch (warriorMood(st)) {
    case 'defeated':
      return st.longest > 0
        ? 'Your streak ended and Rio is back to square one. Submit a problem solution or a quiz answer today to start again.'
        : 'No streak yet. Submit a problem solution or a quiz answer and Rio starts training.';
    case 'worried':
      if (st.gapSaved > 0) return `A spirit bean saved your ${st.current}-day streak. Submit something today to keep it going.`;
      return `Your ${st.current}-day streak needs a submission today.${st.beans > 0 ? ' If you miss it, a spirit bean will save it.' : ' No spirit beans left, so don\'t miss it!'}`;
    case 'ready':
      return formFor(st.current).cheer(st.current);
  }
}

/** `2 of 3 spirit beans`. */
export const beansLine = (beans: number) => `${beans} of ${MAX_BEANS} spirit beans`;

/** The form a transformation starts from: the last form shown, when the current form is higher. Null: nothing to play. */
export function transformationFrom(seen: FormId | null, now: FormId): FormId | null {
  const from = seen ?? 'kid';
  return formRank(now) > formRank(from) ? from : null;
}
