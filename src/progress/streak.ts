// The learner's daily streak: the number of consecutive calendar days (in the learner's own time zone) on which they
// submitted a problem solution or a quiz answer. It starts with the first submission. Only the days are stored; the
// current streak is derived from them and "today", so it needs no timer and survives export, import and merge.

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

/** The length of the run of consecutive days that ends on `key` (0 when `key` is not in `days`). */
export function runEndingAt(days: readonly string[], key: string): number {
  const have = new Set(days);
  let n = 0;
  for (let o = ordinal(key); have.has(keyOf(o)); o--) n++;
  return n;
}

function keyOf(ord: number): string {
  const d = new Date(ord * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The whole run of consecutive days that contains `key` (counting forwards as well, for a day that fills a gap). */
function runThrough(days: readonly string[], key: string): number {
  const have = new Set(days);
  let n = 0;
  for (let o = ordinal(key); have.has(keyOf(o)); o--) n++;
  for (let o = ordinal(key) + 1; have.has(keyOf(o)); o++) n++;
  return n;
}

export function longestRun(days: readonly string[]): number {
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const k of cleanDays(days)) {
    const o = ordinal(k);
    run = prev !== null && o === prev + 1 ? run + 1 : 1;
    prev = o;
    best = Math.max(best, run);
  }
  return best;
}

/** `s` with a submission on `key` added (a new object; adding a day that is already there changes nothing). */
export function addDay(s: StreakData, key: string): StreakData {
  if (!isDayKey(key)) return s;
  const days = cleanDays([...s.days, key]);
  return { days, longest: Math.max(s.longest, runThrough(days, key)) };
}

/** Both histories together: every day from either side, and the longest run seen on either. */
export function mergeStreaks(a: StreakData, b: StreakData): StreakData {
  const days = cleanDays([...a.days, ...b.days]);
  return { days, longest: Math.max(a.longest, b.longest, longestRun(days)) };
}

export type StreakState = 'none' | 'active' | 'at-risk';

export interface StreakStatus {
  /** The streak as the learner should see it now: 0 once a whole day has been missed. */
  current: number;
  longest: number;
  /** `none`: no streak running. `active`: a submission today. `at-risk`: a streak that today's first submission keeps alive. */
  state: StreakState;
  /** The most recent day with a submission, if any. */
  lastDay: string | null;
}

export function streakStatus(s: StreakData, now: Date = new Date()): StreakStatus {
  const today = dayKey(now);
  // Days after today (a clock that was set wrong once) are ignored rather than allowed to freeze the streak.
  const past = s.days.filter(k => k <= today);
  const lastDay = past.length ? past[past.length - 1] : null;
  const longest = Math.max(s.longest, longestRun(s.days));
  if (lastDay === null) return { current: 0, longest, state: 'none', lastDay };
  const gap = ordinal(today) - ordinal(lastDay);
  if (gap === 0) return { current: runEndingAt(past, lastDay), longest, state: 'active', lastDay };
  if (gap === 1) return { current: runEndingAt(past, lastDay), longest, state: 'at-risk', lastDay };
  return { current: 0, longest, state: 'none', lastDay };
}

/** The last `count` days ending today, oldest first, each marked when it has a submission. */
export function recentDays(s: StreakData, count: number, now: Date = new Date()): Array<{ key: string; done: boolean; weekday: string }> {
  const have = new Set(s.days);
  const todayOrd = ordinal(dayKey(now));
  return Array.from({ length: count }, (_, i) => {
    const ord = todayOrd - (count - 1 - i);
    const key = keyOf(ord);
    const weekday = new Date(ord * 86_400_000).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return { key, done: have.has(key), weekday };
  });
}
