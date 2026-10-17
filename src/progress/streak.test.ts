import { describe, expect, it } from 'vitest';
import { addDay, cleanDays, dayKey, emptyStreak, isDayKey, longestRun, MAX_DAYS, mergeStreaks, recentDays, runEndingAt, streakStatus, type StreakData } from './streak';

// Local times on purpose: the streak is counted in the learner's own days.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const withDays = (...days: string[]): StreakData => days.reduce(addDay, emptyStreak());

describe('dayKey', () => {
  it('is the local calendar date, zero padded', () => {
    expect(dayKey(at(2026, 3, 9, 0, 5))).toBe('2026-03-09');
    expect(dayKey(at(2026, 12, 31, 23, 59))).toBe('2026-12-31');
    expect(dayKey(at(2026, 1, 1))).toBe('2026-01-01');
  });
});

describe('isDayKey / cleanDays', () => {
  it('accepts only real calendar dates', () => {
    expect(isDayKey('2026-02-28')).toBe(true);
    expect(isDayKey('2028-02-29')).toBe(true); // leap year
    for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-2-3', '26-02-03', '', 'today', 20260203, null, undefined]) expect(isDayKey(bad)).toBe(false);
  });

  it('sorts, de-duplicates, drops junk and keeps the most recent MAX_DAYS', () => {
    expect(cleanDays(['2026-01-03', '2026-01-01', '2026-01-03', 'nope'])).toEqual(['2026-01-01', '2026-01-03']);
    const many = Array.from({ length: MAX_DAYS + 30 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
    const kept = cleanDays(many);
    expect(kept).toHaveLength(MAX_DAYS);
    expect(kept[kept.length - 1]).toBe(many[many.length - 1]);
  });
});

describe('runs', () => {
  it('counts consecutive days, across month and year ends', () => {
    const days = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'];
    expect(runEndingAt(days, '2026-01-02')).toBe(4);
    expect(runEndingAt(days, '2025-12-31')).toBe(2);
    expect(runEndingAt(days, '2026-01-03')).toBe(0);
    expect(longestRun([...days, '2026-02-01', '2026-02-02'])).toBe(4);
    expect(longestRun([])).toBe(0);
  });

  it('is not fooled by daylight saving changes', () => {
    // 2026-03-08 and 2026-11-01 are US clock-change days; keys are dates, so a 23 or 25 hour day is still one day.
    expect(runEndingAt(['2026-03-07', '2026-03-08', '2026-03-09'], '2026-03-09')).toBe(3);
    expect(runEndingAt(['2026-10-31', '2026-11-01', '2026-11-02'], '2026-11-02')).toBe(3);
  });
});

describe('addDay', () => {
  it('starts a streak with the first submission', () => {
    const s = addDay(emptyStreak(), '2026-03-09');
    expect(s).toEqual({ days: ['2026-03-09'], longest: 1 });
  });

  it('adding the same day again changes nothing', () => {
    const s = withDays('2026-03-09');
    expect(addDay(s, '2026-03-09')).toEqual(s);
  });

  it('extends on the next day, and raises the longest run only when the current run beats it', () => {
    let s = withDays('2026-03-09', '2026-03-10', '2026-03-11');
    expect(s.longest).toBe(3);
    s = addDay(s, '2026-03-20'); // a new run of one
    expect(s.longest).toBe(3);
    s = addDay(addDay(s, '2026-03-21'), '2026-03-22');
    expect(s.longest).toBe(3);
    s = addDay(s, '2026-03-23');
    expect(s.longest).toBe(4);
  });

  it('filling an earlier gap joins two runs', () => {
    expect(addDay(withDays('2026-03-01', '2026-03-02', '2026-03-04', '2026-03-05'), '2026-03-03').longest).toBe(5);
  });

  it('ignores a key that is not a date', () => {
    const s = withDays('2026-03-09');
    expect(addDay(s, 'tomorrow')).toBe(s);
  });
});

describe('streakStatus', () => {
  const s = withDays('2026-03-07', '2026-03-08', '2026-03-09');

  it('has no streak before the first submission', () => {
    expect(streakStatus(emptyStreak(), at(2026, 3, 9))).toEqual({ current: 0, longest: 0, state: 'none', lastDay: null });
  });

  it('is active when something was submitted today', () => {
    expect(streakStatus(s, at(2026, 3, 9, 23, 59))).toEqual({ current: 3, longest: 3, state: 'active', lastDay: '2026-03-09' });
  });

  it('is at risk the day after, and the streak is still counted', () => {
    expect(streakStatus(s, at(2026, 3, 10, 0, 1))).toEqual({ current: 3, longest: 3, state: 'at-risk', lastDay: '2026-03-09' });
  });

  it('is over once a whole day has been missed, but the longest run is remembered', () => {
    expect(streakStatus(s, at(2026, 3, 11))).toEqual({ current: 0, longest: 3, state: 'none', lastDay: '2026-03-09' });
  });

  it('a submission after a miss starts a new streak of one', () => {
    const next = addDay(s, '2026-03-12');
    expect(streakStatus(next, at(2026, 3, 12))).toMatchObject({ current: 1, longest: 3, state: 'active' });
  });

  it('keeps the longest run even when the old days have been dropped', () => {
    expect(streakStatus({ days: ['2026-03-09'], longest: 40 }, at(2026, 3, 9))).toMatchObject({ current: 1, longest: 40 });
  });

  it('ignores days after today, so a clock that was once wrong cannot freeze the streak', () => {
    const odd = { days: ['2026-03-08', '2026-03-09', '2027-01-01'], longest: 2 };
    expect(streakStatus(odd, at(2026, 3, 9))).toMatchObject({ current: 2, state: 'active', lastDay: '2026-03-09' });
  });
});

describe('mergeStreaks', () => {
  it('unions the days and recomputes the longest run', () => {
    const m = mergeStreaks(withDays('2026-03-01', '2026-03-03'), withDays('2026-03-02', '2026-03-10'));
    expect(m.days).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-10']);
    expect(m.longest).toBe(3);
  });
});

describe('recentDays', () => {
  it('lists the last days ending today, oldest first, marking the days with a submission', () => {
    const days = recentDays(withDays('2026-03-08', '2026-03-10'), 4, at(2026, 3, 10));
    expect(days.map(d => d.key)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
    expect(days.map(d => d.done)).toEqual([false, true, false, true]);
    expect(days.map(d => d.weekday)).toEqual(['Sat', 'Sun', 'Mon', 'Tue']);
  });
});
