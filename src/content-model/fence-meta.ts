// Parses code-fence meta strings like:  id=sum stdin="3 4\n" expect=warning choices="7|8|34"
// Quoted values use JSON string escapes. Bare words are boolean flags. Shared by app and tools.
import type { SampleMeta, Expect } from './types';

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

export function toSampleMeta(raw: RawMeta): SampleMeta | null {
  for (const k of Object.keys(raw)) if (!KNOWN.has(k)) throw new FenceMetaError(`unknown fence key "${k}"`);
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
  const flag = (k: string) => raw[k] === true || raw[k] === 'true';
  if (flag('fragment')) return { id: str('id') ?? '', fragment: true };
  const id = str('id');
  if (!id) return null;
  const expect = str('expect') as Expect | undefined;
  if (expect && !/^(success|warning|compile-error|runtime-error|ub|exit:\d+)$/.test(expect)) throw new FenceMetaError(`bad expect=${expect}`);
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
