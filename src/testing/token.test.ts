// Fixed vectors: check.mjs (bundled from token.ts) and the app must produce exactly these codes.
// If a vector changes, every code a learner already pasted stops verifying, so only change them
// together with TOKEN_FORMAT / RUNNER_VERSION.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_RUNNER_VERSIONS, encodeCompletionToken, encodeProgressCode, generateSeed, isExerciseId, isSeed, normaliseExerciseId, normaliseSeed, parseCode,
  parseLearnerFile, PUBLIC_SALT, RUNNER_VERSION, serializeLearnerFile, sourceHash, verifyCode,
} from './token';

const SEED_A = '0123456789abcdef';
const SEED_B = 'fedcba9876543210';

const TOKEN_VECTORS = [
  { seed: SEED_A, input: { exercise: 'caesar', bits: '010100000', run: 3, src: '1a2b3c4d' }, code: 'TDCC1-R1-caesar-010100000-3-1a2b3c4d-07353f62' },
  { seed: SEED_B, input: { exercise: 'm03-gdb-hunt', bits: '1111', run: 12, src: 'deadbeef' }, code: 'TDCC1-R1-m03-gdb-hunt-1111-12-deadbeef-6ecc5a4c' },
];
const COMPLETION_VECTORS = [
  { seed: SEED_A, exercise: 'caesar', token: 'TDCC1-R1-caesar-DONE-556da3a2' },
  { seed: SEED_B, exercise: 'm03-gdb-hunt', token: 'TDCC1-R1-m03-gdb-hunt-DONE-3f319f91' },
];

describe('token vectors', () => {
  it('encodes progress codes', async () => {
    for (const v of TOKEN_VECTORS) expect(await encodeProgressCode(v.input, v.seed)).toBe(v.code);
  });
  it('encodes completion tokens', async () => {
    for (const v of COMPLETION_VECTORS) expect(await encodeCompletionToken({ exercise: v.exercise }, v.seed)).toBe(v.token);
  });
  it('MAC = first 8 hex of SHA-256(payload|seed|salt), checked with node:crypto', () => {
    const mac = (payload: string, seed: string) => createHash('sha256').update(`${payload}|${seed}|${PUBLIC_SALT}`).digest('hex').slice(0, 8);
    expect(TOKEN_VECTORS[0].code.endsWith(mac('tdcc1|r1|caesar|010100000|3|1a2b3c4d', SEED_A))).toBe(true);
    expect(COMPLETION_VECTORS[0].token.endsWith(mac('tdcc1|r1|caesar|done', SEED_A))).toBe(true);
  });
  it('hashes sources independently of order and line endings', async () => {
    expect(await sourceHash({ 'caesar.c': 'int main(void) { return 0; }\n' })).toBe('243e4b3f');
    expect(await sourceHash({ 'b.c': 'B', 'a.c': 'A\r\n' })).toBe('0f4ee515');
    expect(await sourceHash({ 'a.c': 'A\n', 'b.c': 'B' })).toBe('0f4ee515');
  });
});

describe('app-style exercise ids (with "/")', () => {
  // The app's ids are folder paths: project/mario-more, cash/variants/1. In codes "/" is written ".".
  it('writes "/" as "." and accepts either spelling everywhere', async () => {
    expect(normaliseExerciseId(' Project/Mario-More ')).toBe('project.mario-more');
    expect(isExerciseId('project/mario-more')).toBe(true);
    expect(isExerciseId('project//')).toBe(false);
    const code = 'TDCC1-R1-project.mario-more-111-1-deadbeef-71b6e7a2';
    expect(await encodeProgressCode({ exercise: 'project/mario-more', bits: '111', run: 1, src: 'deadbeef' }, SEED_A)).toBe(code);
    expect(await encodeCompletionToken({ exercise: 'project.mario-more' }, SEED_A)).toBe('TDCC1-R1-project.mario-more-DONE-9e173196');
    expect(await encodeCompletionToken({ exercise: 'cash/variants/1' }, SEED_A)).toBe('TDCC1-R1-cash.variants.1-DONE-ac6281a1');
    expect(await verifyCode(code, SEED_A, { exercise: 'project/mario-more' })).toMatchObject({ ok: true, passed: 3, total: 3 });
    expect(await verifyCode(code, SEED_A, { exercise: 'project/mario-less' })).toMatchObject({ ok: false, reason: 'wrong-exercise' });
  });
  it('.learner stores the normalised id, and tolerates a missing "version"', () => {
    expect(parseLearnerFile('{"seed":"0123456789abcdef","exercise":"project/mario-more"}')).toEqual({ version: 1, seed: SEED_A, exercise: 'project.mario-more' });
  });
});

describe('parseCode', () => {
  it('parses both kinds, including exercise ids with dashes', () => {
    expect(parseCode(TOKEN_VECTORS[1].code)).toEqual({
      ok: true, code: { type: 'progress', runner: 1, exercise: 'm03-gdb-hunt', bits: '1111', run: 12, src: 'deadbeef', mac: '6ecc5a4c' },
    });
    expect(parseCode(COMPLETION_VECTORS[1].token)).toEqual({ ok: true, code: { type: 'completion', runner: 1, exercise: 'm03-gdb-hunt', mac: '3f319f91' } });
  });
  it('tolerates whitespace, line breaks, case and surrounding text', () => {
    const messy = `  Progress code: tdcc1-r1-CAESAR-0101\n00000-3-1A2B3C4D-07353F62.  `;
    const r = parseCode(messy);
    expect(r.ok && r.code.type === 'progress' && r.code.mac).toBe('07353f62');
  });
  it('rejects malformed input with a reason', () => {
    expect(parseCode('hello').ok).toBe(false);
    expect(parseCode('TDCC2-R1-caesar-DONE-556da3a2')).toEqual({ ok: false, error: 'this code comes from a different version of the course runner' });
    expect(parseCode('TDCC1-caesar-DONE-556da3a2').ok).toBe(false);
    expect(parseCode('TDCC1-R1-caesar-0102-3-1a2b3c4d-07353f62').ok).toBe(false);
    expect(parseCode('TDCC1-R1-caesar-0101-3-1a2b3c4d').ok).toBe(false);
  });
});

describe('verifyCode', () => {
  it('accepts genuine codes and reports the score', async () => {
    const r = await verifyCode(TOKEN_VECTORS[0].code, SEED_A, { exercise: 'caesar' });
    expect(r).toMatchObject({ ok: true, passed: 2, total: 9 });
    expect((await verifyCode(COMPLETION_VECTORS[0].token, SEED_A)).ok).toBe(true);
  });
  it('rejects tampering, the wrong seed, the wrong exercise and old runners', async () => {
    const tampered = TOKEN_VECTORS[0].code.replace('-010100000-', '-111111111-');
    expect(await verifyCode(tampered, SEED_A)).toMatchObject({ ok: false, reason: 'mac' });
    expect(await verifyCode(TOKEN_VECTORS[0].code, SEED_B)).toMatchObject({ ok: false, reason: 'mac' });
    expect(await verifyCode(TOKEN_VECTORS[0].code, SEED_A, { exercise: 'mario' })).toMatchObject({ ok: false, reason: 'wrong-exercise' });
    expect(await verifyCode(TOKEN_VECTORS[0].code, SEED_A, { acceptedRunners: [2] })).toMatchObject({ ok: false, reason: 'runner-version' });
    expect(await verifyCode('nonsense', SEED_A)).toMatchObject({ ok: false, reason: 'malformed' });
  });
  it('the current runner version is accepted', () => {
    expect(ACCEPTED_RUNNER_VERSIONS).toContain(RUNNER_VERSION);
  });
});

describe('seeds and .learner', () => {
  it('generates and normalises seeds', () => {
    const s = generateSeed();
    expect(isSeed(s)).toBe(true);
    expect(generateSeed()).not.toBe(s);
    expect(normaliseSeed(' 0123 4567 89AB CDEF ')).toBe(SEED_A);
    expect(normaliseSeed('xyz')).toBeUndefined();
  });
  it('round-trips .learner and rejects damaged files', () => {
    const text = serializeLearnerFile({ version: 1, seed: SEED_A, exercise: 'caesar', module: 'm03' });
    expect(parseLearnerFile(text)).toEqual({ version: 1, seed: SEED_A, exercise: 'caesar', module: 'm03' });
    expect(() => parseLearnerFile('{')).toThrow(/not valid JSON/);
    expect(() => parseLearnerFile('{"seed":"12","exercise":"x"}')).toThrow(/seed/);
  });
});
