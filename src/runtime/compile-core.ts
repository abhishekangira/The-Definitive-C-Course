// Environment-neutral compile step: builds the virtual file tree, runs @yowasp/clang, parses diagnostics.
// The compiler worker (browser) and tools/verify (Node) both call compileC().
import { clangArgs, type BuildOptions } from './flags';
import type { Diagnostic, Severity } from '../content-model/types';

export type RunClang = (
  args: string[] | null,
  files?: Record<string, unknown>,
  opts?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface SupportFiles {
  'course_rt.c': string;
  'ubsan_rt.c': string;
  'leakcheck.c': string;
  'leakcheck.h': string;
  'learnc.h': string;
}

export interface CompileInput extends BuildOptions {
  /** Learner/sample files: name → contents. */
  files: Record<string, string>;
}

export interface CompileOutput {
  ok: boolean;
  wasm?: Uint8Array;
  diagnostics: Diagnostic[];
  raw: string;
  ms: number;
}

const DIAG_RE = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*?)(?: \[([^\]]+)\])?$/gm;

/** Parses clang/gcc text diagnostics. Flags are normalised to one canonical warning name. */
export function parseDiagnostics(text: string): Diagnostic[] {
  return [...text.matchAll(DIAG_RE)].map(m => ({
    file: m[1].replace(/^\.?\//, ''),
    line: Number(m[2]),
    col: Number(m[3]),
    severity: m[4] as Severity,
    message: m[5],
    flag: normaliseFlag(m[6]),
  }));
}

/** "-Wformat=" → "-Wformat"; "-Werror,-Wunused-variable" / "-Werror=unused-variable" → "-Wunused-variable". */
export function normaliseFlag(f?: string): string | undefined {
  if (!f) return undefined;
  const parts = f.split(',').map(s => s.trim()).filter(p => p.startsWith('-W'));
  let flag = parts.find(p => !p.startsWith('-Werror')) ?? parts[0];
  if (!flag) return undefined;
  if (flag.startsWith('-Werror=')) flag = '-W' + flag.slice('-Werror='.length);
  return flag.replace(/=$/, '');
}

export async function compileC(runClang: RunClang, support: SupportFiles, input: CompileInput): Promise<CompileOutput> {
  const t0 = performance.now();
  const tree: Record<string, string> = { ...support, ...input.files };
  let raw = '';
  const dec = new TextDecoder();
  const sink = (b: Uint8Array | null) => { if (b) raw += dec.decode(b, { stream: true }); };
  const output = input.output ?? 'main.wasm';
  try {
    const out = await runClang(clangArgs({ ...input, output }), tree, { stdout: sink, stderr: sink, decodeASCII: false });
    raw += dec.decode();
    return { ok: true, wasm: out[output] as Uint8Array, diagnostics: parseDiagnostics(raw), raw, ms: performance.now() - t0 };
  } catch (err) {
    if (typeof (err as { code?: unknown })?.code !== 'number') throw err; // not a yowasp Exit
    raw += dec.decode();
    return { ok: false, diagnostics: parseDiagnostics(raw), raw, ms: performance.now() - t0 };
  }
}
