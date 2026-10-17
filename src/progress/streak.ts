// The learner's daily streak: the number of calendar days in a row (in the learner's own time zone) on which they
// submitted a problem solution or a quiz answer. It starts with the first submission. Only the days are stored; the
// current streak is derived from them and "today", so it needs no timer and survives export, import and merge.
// Spirit beans are derived the same way: replaying the days tells how many the learner has and which missed days they saved.

export interface StreakData {
  /** Days with at least one submission, as local `YYYY-MM-DD`, sorted, unique, at most MAX_DAYS (the most recent). */
  days: string[];
  /** The longest run ever seen, kept apart from `days` because old days are dropped. */
  longest: number;
}

export const MAX_DAYS = 400;

const KEY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyStreak(): StreakData { return { days: [], longest: 0 }; }

/** `1 day`, `3 days`. */
export const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** The local calendar day of a moment: `2026-03-09`. */
export function dayKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days since 1970-01-01 for a `YYYY-MM-DD` key (UTC arithmetic, so daylight saving never skews it). */
function ordinal(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** A key that is a real calendar date, not just the right shape. */
export function isDayKey(v: unknown): v is string {
  if (typeof v !== 'string' || !KEY.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Sorted, unique, valid days, the most recent MAX_DAYS of them. */
export function cleanDays(days: readonly unknown[]): string[] {
  return [...new Set(days.filter(isDayKey))].sort().slice(-MAX_DAYS);
}

function keyOf(ord: number): string {
  const d = new Date(ord * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Spirit beans save a streak over missed days, one bean per day. A learner starts with START_BEANS, earns one on every
 * BEAN_EVERY-th day of a streak and holds at most MAX_BEANS. A bean is used up only when it saves a streak: a gap with
 * more missed days than beans ends the streak and the beans are kept. A saved day keeps the streak but doesn't add to it. */
export const START_BEANS = 1;
export const BEAN_EVERY = 7;
export const MAX_BEANS = 3;

interface Replay {
  /** The streak after the last day (submission days in a row, saved days bridging them). */
  run: number;
  beans: number;
  longest: number;
  /** Missed days that a bean saved. */
  saved: string[];
}

/** Replays a clean history (sorted, unique, valid) day by day. */
function replay(days: readonly string[]): Replay {
  let run = 0;
  let beans = START_BEANS;
  let longest = 0;
  let prev: number | null = null;
  const saved: string[] = [];
  for (const k of days) {
    const o = ordinal(k);
    if (prev !== null && o - prev - 1 <= beans) {
      for (let d = prev + 1; d < o; d++) { saved.push(keyOf(d)); beans--; }
      run++;
    } else {
      run = 1;
    }
    if (run % BEAN_EVERY === 0) beans = Math.min(MAX_BEANS, beans + 1);
    longest = Math.max(longest, run);
    prev = o;
  }
  return { run, beans, longest, saved };
}

/** The longest streak in a history, counting the missed days that spirit beans saved as bridges. */
export function longestRun(days: readonly unknown[]): number {
  return replay(cleanDays(days)).longest;
}

/** `s` with a submission on `key` added (a new object; adding a day that is already there changes nothing). */
export function addDay(s: StreakData, key: string): StreakData {
  if (!isDayKey(key)) return s;
  const days = cleanDays([...s.days, key]);
  return { days, longest: Math.max(s.longest, longestRun(days)) };
}

/** Both histories together: every day from either side, and the longest run seen on either. */
export function mergeStreaks(a: StreakData, b: StreakData): StreakData {
  const days = cleanDays([...a.days, ...b.days]);
  return { days, longest: Math.max(a.longest, b.longest, longestRun(days)) };
}

export type StreakState = 'none' | 'active' | 'at-risk';

export interface StreakStatus {
  /** The streak as the learner should see it now: 0 once more days were missed than spirit beans could save. */
  current: number;
  longest: number;
  /** `none`: no streak running. `active`: a submission today. `at-risk`: a streak that today's first submission keeps alive. */
  state: StreakState;
  /** The most recent day with a submission, if any. */
  lastDay: string | null;
  /** Spirit beans on hand now, after the ones the days since the last submission are using. */
  beans: number;
  /** Missed days since the last submission that beans are saving right now (only while `at-risk`). */
  gapSaved: number;
  /** Every missed day a bean saved, including the ones being saved right now. */
  saved: string[];
}

export function streakStatus(s: StreakData, now: Date = new Date()): StreakStatus {
  const today = dayKey(now);
  // Days after today (a clock that was set wrong once) are ignored rather than allowed to freeze the streak.
  const past = cleanDays(s.days).filter(k => k <= today);
  const r = replay(past);
  const lastDay = past.length ? past[past.length - 1] : null;
  const longest = Math.max(s.longest, r.longest);
  const base = { longest, lastDay, beans: r.beans, gapSaved: 0, saved: r.saved };
  if (lastDay === null) return { ...base, current: 0, state: 'none' };
  const missed = ordinal(today) - ordinal(lastDay) - 1;
  if (missed < 0) return { ...base, current: r.run, state: 'active' };
  if (missed > r.beans) return { ...base, current: 0, state: 'none' };
  const gap = Array.from({ length: missed }, (_, i) => keyOf(ordinal(lastDay) + 1 + i));
  return { ...base, current: r.run, state: 'at-risk', beans: r.beans - missed, gapSaved: missed, saved: [...r.saved, ...gap] };
}

export type DayMark = 'done' | 'saved' | 'missed';

/** The last `count` days ending today, oldest first: a submission, a missed day a spirit bean saved, or neither. */
export function recentDays(s: StreakData, count: number, now: Date = new Date()): Array<{ key: string; mark: DayMark; weekday: string }> {
  const have = new Set(s.days);
  const saved = new Set(streakStatus(s, now).saved);
  const todayOrd = ordinal(dayKey(now));
  return Array.from({ length: count }, (_, i) => {
    const ord = todayOrd - (count - 1 - i);
    const key = keyOf(ord);
    const weekday = new Date(ord * 86_400_000).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return { key, mark: have.has(key) ? 'done' : saved.has(key) ? 'saved' : 'missed', weekday };
  });
}
