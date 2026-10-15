// Synchronous Node twin of sample-hash-iso.ts (same payload, same digest). See that file for the
// definition; the build tools use this one because it needs no await.
import { createHash } from 'node:crypto';
import { sampleHashPayload, SAMPLE_HASH_LENGTH, type SampleHashInput } from './sample-hash-iso';

export type { SampleHashInput } from './sample-hash-iso';

export function sampleHash(i: SampleHashInput): string {
  return createHash('sha256').update(sampleHashPayload(i), 'utf8').digest('hex').slice(0, SAMPLE_HASH_LENGTH);
}
