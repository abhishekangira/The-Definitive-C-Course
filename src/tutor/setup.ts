// Where the learner is in setting up the tutor, from the saved settings. The exercise panel and the lesson chat show
// the same four states.
import { consentCovers, isOpenRouter, type TutorSettings } from './settings';

export type TutorSetup = 'no-key' | 'needs-model' | 'needs-consent' | 'ready';

export function tutorSetup(s: TutorSettings): TutorSetup {
  if (!s.apiKey) return 'no-key';
  // No model chosen and no course default for this host: asking cannot work.
  if (!s.model && !isOpenRouter(s.baseUrl)) return 'needs-model';
  if (!consentCovers(s)) return 'needs-consent';
  return 'ready';
}
