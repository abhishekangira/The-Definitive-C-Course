// Progress codes and completion tokens for local exercises (kind LT and native projects), PLAN §2.5.
// Shared by check.mjs (which prints them) and the app (which verifies pasted codes), so the two can
// never disagree; token.test.ts pins fixed test vectors. Isomorphic: no DOM or Node imports.
//
//   progress code     TDCC1-R1-<exercise>-<bits>-<run>-<src8>-<mac8>
//   completion token  TDCC1-R1-<exercise>-DONE-<mac8>
//
//   TDCC1      token format version
//   R1         check.mjs runner version (the app keeps ACCEPTED_RUNNER_VERSIONS)
//   exercise   exercise or project id, lowercase, may itself contain "-" (e.g. m03-gdb-hunt). The app's
//              ids contain "/" (project/mario-more, cash/variants/1); in a code "/" is written "."
//              (see normaliseExerciseId), so callers can pass either spelling
//   bits       one "1"/"0" per check, in check order (compile check first, memory check last)
//   run        how many times check.mjs has run in this folder (decimal)
//   src8       first 8 hex digits of SHA-256 over the learner's sources (sourceHash)
//   mac8       first 8 hex digits of SHA-256(payload + "|" + seed + "|" + PUBLIC_SALT)
//
// The payload is the code's fields, lowercase, joined with "|" (see payloadOf). The seed is the
// learner's random 16-hex-digit seed, written into `.learner` when the app builds the project zip.
// Without a backend this is an honour system: the codes are tamper-evident, not tamper-proof (the
// salt is public on purpose, and the seed sits in the learner's own folder).
import { sha256Hex } from './sha256';

export const TOKEN_FORMAT = 'TDCC1';
/** Version of the check.mjs runner this module ships in. Bump when check semantics change. */
export const RUNNER_VERSION = 1;
/** Runner versions whose codes the app accepts. */
export const ACCEPTED_RUNNER_VERSIONS: readonly number[] = [1];
/** Public salt; it only separates these MACs from other uses of SHA-256. */
export const PUBLIC_SALT = 'tdcc:honour-system:v1';

export interface ProgressCode {
  type: 'progress';
  runner: number;
  exercise: string;
  /** "1"/"0" per check. */
  bits: string;
  run: number;
  /** 8 lowercase hex digits. */
  src: string;
  mac: string;
}

export interface CompletionToken {
  type: 'completion';
  runner: number;
  exercise: string;
  mac: string;
}

export type ParsedCode = ProgressCode | CompletionToken;

// Segments of letters, digits and "_", joined by "." or "-" (never empty, never doubled).
const EXERCISE_RE = /^[a-z0-9][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/;
const SEED_RE = /^[0-9a-f]{16}$/;
const HEX8_RE = /^[0-9a-f]{8}$/;

/**
 * The spelling of an exercise id inside codes and .learner: lowercase, with "/" written ".", so
 * "project/mario-more" and "project.mario-more" are the same exercise. A code is one pasteable
 * word, and "/" would end it (parseCode stops at the first character a code cannot contain).
 */
export const normaliseExerciseId = (id: string) => id.trim().toLowerCase().replace(/\//g, '.');

/** True for ids that can appear in a code (after normaliseExerciseId). */
export const isExerciseId = (s: string) => EXERCISE_RE.test(normaliseExerciseId(s));
export const isSeed = (s: string) => SEED_RE.test(s);

/** A fresh learner seed: 16 lowercase hex digits from the platform's CSPRNG. */
export function generateSeed(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/** Lowercases and trims a pasted seed; returns undefined if it is not 16 hex digits. */
export function normaliseSeed(s: string): string | undefined {
  const t = s.replace(/\s+/g, '').toLowerCase();
  return isSeed(t) ? t : undefined;
}

/**
 * First 8 hex digits of SHA-256 over the learner's sources, independent of their order:
 * for each file sorted by path, `path NUL text NUL`. Line endings are normalised to \n first, so a
 * Windows checkout hashes the same as the app's copy.
 */
export async function sourceHash(files: Record<string, string>): Promise<string> {
  const canon = Object.keys(files).sort().map(p => `${p}\0${files[p].replace(/\r\n/g, '\n')}\0`).join('');
  return (await sha256Hex(canon)).slice(0, 8);
}

function payloadOf(c: Omit<ProgressCode, 'mac'> | Omit<CompletionToken, 'mac'>): string {
  const head = [TOKEN_FORMAT.toLowerCase(), `r${c.runner}`, c.exercise];
  return (c.type === 'progress' ? [...head, c.bits, String(c.run), c.src] : [...head, 'done']).join('|');
}

async function macOf(payload: string, seed: string): Promise<string> {
  return (await sha256Hex(`${payload}|${seed}|${PUBLIC_SALT}`)).slice(0, 8);
}

function checkSeed(seed: string): string {
  const s = normaliseSeed(seed);
  if (!s) throw new Error(`invalid learner seed ${JSON.stringify(seed)}: expected 16 hex digits`);
  return s;
}

export interface ProgressInput {
  exercise: string;
  bits: string;
  run: number;
  src: string;
  /** Defaults to RUNNER_VERSION. */
  runner?: number;
}

/** Formats a progress code (see the header comment). */
export async function encodeProgressCode(p: ProgressInput, seed: string): Promise<string> {
  const exercise = normaliseExerciseId(p.exercise);
  if (!isExerciseId(exercise)) throw new Error(`invalid exercise id ${JSON.stringify(p.exercise)}`);
  if (!/^[01]+$/.test(p.bits)) throw new Error(`invalid pass bitmap ${JSON.stringify(p.bits)}`);
  if (!Number.isInteger(p.run) || p.run < 0) throw new Error(`invalid run counter ${p.run}`);
  const src = p.src.toLowerCase();
  if (!HEX8_RE.test(src)) throw new Error(`invalid source hash ${JSON.stringify(p.src)}`);
  const c = { type: 'progress' as const, runner: p.runner ?? RUNNER_VERSION, exercise, bits: p.bits, run: p.run, src };
  const mac = await macOf(payloadOf(c), checkSeed(seed));
  return `${TOKEN_FORMAT}-R${c.runner}-${exercise}-${c.bits}-${c.run}-${src}-${mac}`;
}

/** Formats a completion token (printed when every check passes). */
export async function encodeCompletionToken(p: { exercise: string; runner?: number }, seed: string): Promise<string> {
  const exercise = normaliseExerciseId(p.exercise);
  if (!isExerciseId(exercise)) throw new Error(`invalid exercise id ${JSON.stringify(p.exercise)}`);
  const c = { type: 'completion' as const, runner: p.runner ?? RUNNER_VERSION, exercise };
  const mac = await macOf(payloadOf(c), checkSeed(seed));
  return `${TOKEN_FORMAT}-R${c.runner}-${exercise}-DONE-${mac}`;
}

const MAX_CODE_LENGTH = 200;

/** The canonical spelling of a parsed code (what check.mjs printed): store this, never the pasted text around it. */
export function formatCode(c: ParsedCode): string {
  const head = `${TOKEN_FORMAT}-R${c.runner}-${c.exercise}`;
  return c.type === 'progress' ? `${head}-${c.bits}-${c.run}-${c.src}-${c.mac}` : `${head}-DONE-${c.mac}`;
}

/**
 * Parses a pasted code. Tolerates surrounding text and quotes, spaces or line breaks inside the code,
 * and any letter case. Does not check the MAC (see verifyCode).
 */
export function parseCode(text: string): { ok: true; code: ParsedCode } | { ok: false; error: string } {
  const whole = text.replace(/\s+/g, '').toLowerCase();
  const start = whole.indexOf(TOKEN_FORMAT.toLowerCase() + '-');
  // A code is far shorter than MAX_CODE_LENGTH; looking at no more keeps the trailing-punctuation regex below linear
  // (on a megabyte of dashes it was quadratic).
  const compact = start < 0 ? whole.slice(0, 16) : whole.slice(0, start + MAX_CODE_LENGTH);
  if (start < 0) {
    return /^tdcc\d+-/.test(compact)
      ? { ok: false, error: 'this code comes from a different version of the course runner' }
      : { ok: false, error: 'this does not look like a course code (it should start with TDCC1-)' };
  }
  // Cut at the first character a code cannot contain, then drop trailing punctuation ("…-9f8e7d6c.").
  const s = compact.slice(start).replace(/[^0-9a-z_.-].*$/, '').replace(/[._-]+$/, '');
  const parts = s.split('-');
  const runnerMatch = /^r(\d+)$/.exec(parts[1] ?? '');
  if (!runnerMatch) return { ok: false, error: 'the runner version (R1, R2, …) is missing' };
  const runner = Number(runnerMatch[1]);
  const rest = parts.slice(2);
  // Completion: <exercise…>-done-<mac>
  if (rest.length >= 3 && rest[rest.length - 2] === 'done' && HEX8_RE.test(rest[rest.length - 1])) {
    const exercise = rest.slice(0, -2).join('-');
    if (!isExerciseId(exercise)) return { ok: false, error: 'the exercise id is malformed' };
    return { ok: true, code: { type: 'completion', runner, exercise, mac: rest[rest.length - 1] } };
  }
  // Progress: <exercise…>-<bits>-<run>-<src8>-<mac8>
  if (rest.length >= 5) {
    const [bits, run, src, mac] = rest.slice(-4);
    const exercise = rest.slice(0, -4).join('-');
    if (/^[01]+$/.test(bits) && /^\d{1,9}$/.test(run) && HEX8_RE.test(src) && HEX8_RE.test(mac) && isExerciseId(exercise)) {
      return { ok: true, code: { type: 'progress', runner, exercise, bits, run: Number(run), src, mac } };
    }
  }
  return { ok: false, error: 'the code is incomplete or mistyped (copy the whole line check.mjs printed)' };
}

export type VerifyFailure = 'malformed' | 'runner-version' | 'wrong-exercise' | 'mac';

export type VerifyResult =
  | { ok: true; code: ParsedCode; passed?: number; total?: number }
  | { ok: false; reason: VerifyFailure; message: string; code?: ParsedCode };

export interface VerifyOptions {
  /** The exercise the code was pasted into (either id spelling); a code for another exercise is rejected. */
  exercise?: string;
  acceptedRunners?: readonly number[];
}

/** Parses and checks a pasted code against the learner's seed. */
export async function verifyCode(text: string, seed: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const parsed = parseCode(text);
  if (!parsed.ok) return { ok: false, reason: 'malformed', message: parsed.error };
  const code = parsed.code;
  const accepted = opts.acceptedRunners ?? ACCEPTED_RUNNER_VERSIONS;
  if (!accepted.includes(code.runner)) {
    return { ok: false, reason: 'runner-version', code, message: `this code comes from check.mjs version ${code.runner}, which this course no longer accepts: download the project again for the current check.mjs` };
  }
  if (opts.exercise && code.exercise !== normaliseExerciseId(opts.exercise)) {
    return { ok: false, reason: 'wrong-exercise', code, message: `this code is for "${code.exercise}", not "${opts.exercise}"` };
  }
  const { mac, ...fields } = code;
  if ((await macOf(payloadOf(fields), checkSeed(seed))) !== mac) {
    return { ok: false, reason: 'mac', code, message: "this code doesn't match your learner seed: was it copied exactly, from a project you downloaded from this browser?" };
  }
  if (code.type === 'progress') {
    const passed = [...code.bits].filter(b => b === '1').length;
    return { ok: true, code, passed, total: code.bits.length };
  }
  return { ok: true, code };
}

// ---------------------------------------------------------------- .learner

/** Contents of the `.learner` file the app writes into every project zip (JSON). */
export interface LearnerFile {
  version: 1;
  seed: string;
  /** Exercise or project id the codes are for (any spelling; stored normalised). */
  exercise: string;
  module?: string;
  title?: string;
  createdAt?: string;
}

export const LEARNER_FILE = '.learner';

export function serializeLearnerFile(l: LearnerFile): string {
  return JSON.stringify(l, null, 2) + '\n';
}

/** Parses `.learner`; throws with a friendly message when it is damaged. */
export function parseLearnerFile(text: string): LearnerFile {
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new Error('.learner is not valid JSON (download the project again from the course)'); }
  const o = v as Partial<LearnerFile>;
  const seed = typeof o.seed === 'string' ? normaliseSeed(o.seed) : undefined;
  if (!seed) throw new Error('.learner has no valid seed (download the project again from the course)');
  if (typeof o.exercise !== 'string' || !isExerciseId(o.exercise)) throw new Error('.learner has no valid exercise id');
  return { ...o, version: 1, seed, exercise: normaliseExerciseId(o.exercise) } as LearnerFile;
}
