import { describe, expect, it } from 'vitest';
import { ECSTATIC_AT, HAPPY_AT, JOYFUL_AT, petMessage, petMood } from './pet';
import { streakStatus, type StreakStatus } from './streak';

const status = (over: Partial<StreakStatus>): StreakStatus => ({ current: 0, longest: 0, state: 'none', lastDay: null, ...over });
const active = (current: number) => status({ state: 'active', current, longest: current, lastDay: '2026-03-10' });

describe('petMood', () => {
  it('is sad when no streak is running, whether it never started or was broken', () => {
    expect(petMood(status({}))).toBe('sad');
    expect(petMood(status({ longest: 12, lastDay: '2026-02-01' }))).toBe('sad');
  });

  it('is worried on the day after a submission, however long the streak is', () => {
    for (const current of [1, 5, 40]) expect(petMood(status({ state: 'at-risk', current, longest: current }))).toBe('worried');
  });

  it('gets happier as an active streak grows, stepping up exactly at the thresholds', () => {
    expect(petMood(active(1))).toBe('content');
    expect(petMood(active(HAPPY_AT - 1))).toBe('content');
    expect(petMood(active(HAPPY_AT))).toBe('happy');
    expect(petMood(active(JOYFUL_AT - 1))).toBe('happy');
    expect(petMood(active(JOYFUL_AT))).toBe('joyful');
    expect(petMood(active(ECSTATIC_AT - 1))).toBe('joyful');
    expect(petMood(active(ECSTATIC_AT))).toBe('ecstatic');
    expect(petMood(active(365))).toBe('ecstatic');
  });

  it('follows the real streak status: a missed day turns a happy pet sad', () => {
    const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'];
    const at = (d: string) => streakStatus({ days, longest: 4 }, new Date(`${d}T12:00:00`));
    expect(petMood(at('2026-03-04'))).toBe('happy');
    expect(petMood(at('2026-03-05'))).toBe('worried');
    expect(petMood(at('2026-03-06'))).toBe('sad');
  });
});

describe('petMessage', () => {
  it('tells a new learner and a learner with a broken streak apart', () => {
    expect(petMessage(status({}))).toMatch(/No streak yet/);
    expect(petMessage(status({ longest: 3 }))).toMatch(/streak ended/);
  });

  it('names the streak length with the right plural', () => {
    expect(petMessage(status({ state: 'at-risk', current: 1, longest: 1 }))).toContain('1 day streak');
    expect(petMessage(active(8))).toContain('8 days in a row');
  });
});
