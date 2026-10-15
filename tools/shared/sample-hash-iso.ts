// The sample hash: identifies "this exact program with this exact input and mode". tools/verify
// writes it into src/generated/samples/<module>.json (SampleResult.hash); the editor recomputes it
// for the learner's current code/stdin/args/mode, and when the two differ the stored outputs (and
// the stepper trace) no longer apply (PLAN §3.2 "Edits").
//
// Definition (keep both implementations in sync; tests pin a vector):
//   payload = JSON.stringify([code, stdin ?? "", args ?? [], guardrail === true])
//   hash    = first 16 hex chars of SHA-256(UTF-8(payload))
//
// This file is isomorphic (SubtleCrypto: browsers and Node ≥ 19), so the app can import it.
// tools/shared/sample-hash.ts is the synchronous node:crypto twin used by the build tools.

export interface SampleHashInput {
  code: string;
  stdin?: string;
  args?: string[];
  /** Browser guardrail (UBSan) mode. */
  guardrail?: boolean;
}

export const SAMPLE_HASH_LENGTH = 16;

/** The exact string that is hashed. Missing stdin/args/guardrail hash like their empty values. */
export function sampleHashPayload(i: SampleHashInput): string {
  return JSON.stringify([i.code, i.stdin ?? '', i.args ?? [], i.guardrail === true]);
}

export async function sampleHashIso(i: SampleHashInput): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sampleHashPayload(i)));
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, SAMPLE_HASH_LENGTH);
}
