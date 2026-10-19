import { describe, expect, it } from 'vitest';
import { tutorEligible } from './eligibility';

const ok = {
  kind: 'ct', runsIn: 'browser', substantive: 1, latestFailed: true,
  assessment: false, isVariant: false, allowTutor: true, exerciseId: 'hello-world',
};

describe('tutorEligible', () => {
  it('shows after a failed substantive check on a browser ct, fb or pa exercise', () => {
    expect(tutorEligible(ok)).toBe(true);
    expect(tutorEligible({ ...ok, kind: 'fb', exerciseId: 'fix-pyramid' })).toBe(true);
    expect(tutorEligible({ ...ok, kind: 'pa', exerciseId: 'countdown-order' })).toBe(true);
  });

  it('hides before a failed check, and on assessments, variants, quizzes, projects, local tasks and native runs', () => {
    expect(tutorEligible({ ...ok, substantive: 0 })).toBe(false);
    expect(tutorEligible({ ...ok, latestFailed: false })).toBe(false);
    expect(tutorEligible({ ...ok, assessment: true })).toBe(false);
    expect(tutorEligible({ ...ok, isVariant: true })).toBe(false);
    expect(tutorEligible({ ...ok, allowTutor: false })).toBe(false);
    expect(tutorEligible({ ...ok, exerciseId: 'project/mario-more' })).toBe(false);
    expect(tutorEligible({ ...ok, kind: 'lt' })).toBe(false);
    expect(tutorEligible({ ...ok, runsIn: 'native' })).toBe(false);
  });
});
