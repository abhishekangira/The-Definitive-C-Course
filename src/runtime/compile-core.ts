// Environment-neutral compile step: builds the virtual file tree, runs @yowasp/clang, parses diagnostics.
// The compiler worker (browser) and tools/verify (Node) both call compileC().
import { clangArgs, COMPILE_FLAGS, stageArgs, type BuildOptions, type Stage } from './flags';
import type { Diagnostic, Severity } from '../content-model/types';

export type RunClang = (
  args: string[] | null,
  files?: Record<string, unknown>,
  opts?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** nm, objdump and size: the same command shape, exported as runLLVM by the @yowasp bundle. */
export type RunLLVM = RunClang;

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

export interface StageOutput { ok: boolean; text: string; diagnostics: Diagnostic[]; raw: string; ms: number }

/**
 * clang's link step runs wasm-ld on a temporary object whose name changes every run (`/tmp/main-62bf3f.o`), so the
 * learner sees `<tmpN>` instead, numbered by first use, like the native-session normaliser (docs/adr/0005).
 */
export function normaliseLinkOutput(text: string): string {
  const ids = new Map<string, number>();
  return text.replace(/\/tmp\/[^\s:]+/g, path => {
    let n = ids.get(path);
    if (n === undefined) { n = ids.size + 1; ids.set(path, n); }
    return `<tmp${n}>`;
  });
}

/** clang argv for `-c`: one source to the relocatable object the symbol and disassembly views read. */
export function objectArgs(source: string, output = 'main.o'): string[] {
  return ['clang', ...COMPILE_FLAGS, '-c', source, '-o', output];
}

/** The llvm tool and flags for each object view. */
const OBJECT_TOOL: Record<'objdump-t' | 'objdump-d' | 'nm', string[]> = {
  'objdump-t': ['objdump', '-t'],
  'objdump-d': ['objdump', '-d', '-l'],
  nm: ['nm'],
};

/**
 * Runs one pipeline view on one source. -E and -S are a single clang run; the object views compile once with -c and
 * read main.o with llvm-objdump/llvm-nm; link compiles and links with clang (its wasm-ld step) and reports the
 * linked file with llvm-size. Every text is the tool's real output.
 */
export async function compileStage(runClang: RunClang, runLLVM: RunLLVM, support: SupportFiles, files: Record<string, string>, stage: Stage, source = 'main.c', opt?: '-O0' | '-O1' | '-O2'): Promise<StageOutput> {
  const t0 = performance.now();
  const tree: Record<string, string> = { ...support, ...files };
  let raw = '';
  const dec = new TextDecoder();
  const sink = (b: Uint8Array | null) => { if (b) raw += dec.decode(b, { stream: true }); };
  const done = (ok: boolean, text: string, diagnostics = parseDiagnostics(raw)): StageOutput => ({ ok, text, diagnostics, raw, ms: performance.now() - t0 });

  if (stage === 'E' || stage === 'S') {
    const { args, output } = stageArgs(stage, source, opt);
    try {
      const out = await runClang(args, tree, { stdout: sink, stderr: sink, decodeASCII: false });
      raw += dec.decode();
      const bytes = out[output] as Uint8Array | string | undefined;
      const text = typeof bytes === 'string' ? bytes : bytes ? new TextDecoder().decode(bytes) : '';
      return done(true, text);
    } catch (err) {
      if (typeof (err as { code?: unknown })?.code !== 'number') throw err;
      raw += dec.decode();
      return done(false, '');
    }
  }

  if (stage !== 'link') {
    try {
      const obj = await runClang(objectArgs(source), tree, { stdout: sink, stderr: sink, decodeASCII: false });
      raw += dec.decode();
      const tool = new TextDecoder();
      let text = '';
      const toolSink = (b: Uint8Array | null) => { if (b) text += tool.decode(b, { stream: true }); };
      try {
        await runLLVM([...OBJECT_TOOL[stage], 'main.o'], obj, { stdout: toolSink, stderr: toolSink, decodeASCII: false });
        text += tool.decode();
        const diagnostics = parseDiagnostics(raw + text);
        return { ok: true, text, diagnostics, raw: raw + text, ms: performance.now() - t0 };
      } catch (err) {
        if (typeof (err as { code?: unknown })?.code !== 'number') throw err;
        text += tool.decode();
        const diagnostics = parseDiagnostics(raw + text);
        return { ok: false, text, diagnostics, raw: raw + text, ms: performance.now() - t0 };
      }
    } catch (err) {
      if (typeof (err as { code?: unknown })?.code !== 'number') throw err;
      raw += dec.decode();
      return done(false, '');
    }
  }

  // Link: the success itself is silent, so llvm-size reports the artifact wasm-ld wrote; a failure is wasm-ld's message.
  try {
    const out = await runClang(clangArgs({ sources: [source], output: 'main.wasm' }), tree, { stdout: sink, stderr: sink, decodeASCII: false });
    raw += dec.decode();
    const sizeDec = new TextDecoder();
    let text = '';
    const sizeSink = (b: Uint8Array | null) => { if (b) text += sizeDec.decode(b, { stream: true }); };
    try {
      await runLLVM(['size', 'main.wasm'], out, { stdout: sizeSink, stderr: sizeSink, decodeASCII: false });
    } catch {
      // size only describes the artifact; the link itself succeeded.
    }
    text += sizeDec.decode();
    return done(true, text);
  } catch (err) {
    if (typeof (err as { code?: unknown })?.code !== 'number') throw err;
    raw += dec.decode();
    const text = normaliseLinkOutput(raw);
    return { ok: false, text, diagnostics: parseDiagnostics(text), raw: text, ms: performance.now() - t0 };
  }
}
