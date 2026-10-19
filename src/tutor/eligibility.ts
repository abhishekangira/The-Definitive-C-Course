// When the "Ask the tutor" panel may appear (PLAN.md §2.6). Pure: the exercise renders it
// from the latest check, not from a stale closure inside the check handler.

import type { ReportedCheck } from './prompt';

/** The check the tutor is allowed to talk about. `code` is the source that produced `results`. */
export interface TutorCheckSnapshot {
  code: string;
  results: readonly ReportedCheck[];
  diagnostics: string;
  failed: boolean;
}

export function tutorEligible(input: {
  kind: string;
  runsIn: string;
  substantive: number;
  latestFailed: boolean;
  assessment: boolean;
  isVariant: boolean;
  allowTutor: boolean;
  exerciseId: string;
}): boolean {
  if (!input.allowTutor || input.assessment || input.isVariant) return false;
  if (input.exerciseId.startsWith('project/')) return false;
  if (input.kind !== 'ct' && input.kind !== 'fb' && input.kind !== 'pa') return false;
  if (input.runsIn !== 'browser') return false;
  return input.substantive >= 1 && input.latestFailed;
}
