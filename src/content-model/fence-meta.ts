// Parses code-fence meta strings like:  id=sum stdin="3 4\n" expect=warning choices="7|8|34"
// Quoted values use JSON string escapes. Bare words are boolean flags. Shared by app and tools.
import type { SampleMeta, Expect, CompilerKey } from './types.ts';

export type RawMeta = Record<string, string | true>;

export function parseRawMeta(meta: string | null | undefined): RawMeta {
  const out: RawMeta = {};
  if (!meta) return out;
  const re = /([A-Za-z_][\w.-]*)(?:=("(?:[^"\\]|\\.)*"|[^\s"]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(meta))) {
    const [, key, value] = m;
    if (value === undefined) out[key] = true;
    else if (value.startsWith('"')) out[key] = JSON.parse(value) as string;
    else out[key] = value;
  }
  return out;
}

const KNOWN = new Set([
  'id', 'fragment', 'predict', 'choices', 'stdin', 'args', 'expect', 'platform', 'predict64', 'reason',
  'target', 'stdout', 'posix', 'guardrail', 'sanitize', 'trace', 'timeout', 'norm', 'files', 'run',
]);

export class FenceMetaError extends Error {}

/** Shell-style split for args="one 'two words' \"three\"". */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  return out;
}

const EXPECT_RE = /^(success|warning|compile-error|runtime-error|ub|exit:\d+)$/;
const COMPILER_KEYS = new Set(['gcc', 'clang', 'wasm', 'apple', 'msvc']);

export function toSampleMeta(raw: RawMeta): SampleMeta | null {
  const expectBy: Partial<Record<CompilerKey, Expect>> = {};
  for (const k of Object.keys(raw)) {
    const m = /^expect\.(\w+)$/.exec(k);
    // warn= / warn.<compiler>= (required warning flags) are checked by tools/verify, not the app.
    const w = /^warn(?:\.(\w+))?$/.exec(k);
    if (w) {
      if (w[1] && !COMPILER_KEYS.has(w[1])) throw new FenceMetaError(`unknown compiler in "${k}" (use gcc, clang, wasm, apple or msvc)`);
      if (typeof raw[k] !== 'string') throw new FenceMetaError(`${k} needs a value, e.g. ${k}=-Wformat`);
      continue;
    }
    if (m) {
      if (!COMPILER_KEYS.has(m[1])) throw new FenceMetaError(`unknown compiler in "${k}" (use gcc, clang, wasm, apple or msvc)`);
      const v = raw[k];
      if (typeof v !== 'string' || !EXPECT_RE.test(v)) throw new FenceMetaError(`bad ${k}=${String(v)}`);
      expectBy[m[1] as CompilerKey] = v as Expect;
      continue;
    }
    if (!KNOWN.has(k)) throw new FenceMetaError(`unknown fence key "${k}"`);
  }
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
  const flag = (k: string) => raw[k] === true || raw[k] === 'true';
  if (flag('fragment') || raw.fragment === 'partial') return { id: str('id') ?? '', fragment: true };
  const id = str('id');
  if (!id) return null;
  const expect = str('expect') as Expect | undefined;
  if (expect && !EXPECT_RE.test(expect)) throw new FenceMetaError(`bad expect=${expect}`);
  const predictRaw = str('predict');
  const predict = (predictRaw ?? (flag('run') ? 'none' : raw.choices ? 'choice' : 'output')) as SampleMeta['predict'];
  if (!['output', 'outcome', 'choice', 'none'].includes(predict!)) throw new FenceMetaError(`bad predict=${predictRaw}`);
  const stdoutMode = str('stdout') as SampleMeta['stdoutMode'];
  if (stdoutMode && !['tty', 'pipe', 'both'].includes(stdoutMode)) throw new FenceMetaError(`bad stdout=${stdoutMode}`);
  const p64 = str('predict64');
  return {
    id,
    predict,
    choices: str('choices')?.split('|'),
    stdin: str('stdin'),
    args: str('args') !== undefined ? splitArgs(str('args')!) : undefined,
    expect,
    expectBy: Object.keys(expectBy).length ? expectBy : undefined,
    platform: flag('platform') || undefined,
    predict64: p64,
    predict64Reason: str('reason'),
    target: str('target') === 'native' ? 'native' : undefined,
    stdoutMode,
    posix: flag('posix') || undefined,
    guardrail: flag('guardrail') || undefined,
    sanitize: raw.sanitize === 'off' ? false : undefined,
    trace: flag('trace') || undefined,
    timeout: str('timeout') ? Number(str('timeout')) : undefined,
    norm: str('norm') as SampleMeta['norm'],
    files: str('files')?.split(','),
  };
}
