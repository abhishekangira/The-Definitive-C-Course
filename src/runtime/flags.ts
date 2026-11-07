// Compiler and linker flags for the in-browser toolchain (@yowasp/clang, wasm32-wasip1).
// Shared by the compiler worker and by tools/verify (Node), so CI compiles exactly what learners compile.

export const COMPILE_FLAGS = [
  '-std=c17', '-Wall', '-Wextra', '-pedantic', '-O0', '-g', '-fno-color-diagnostics',
  '-D_WASI_EMULATED_PROCESS_CLOCKS', '-D_WASI_EMULATED_SIGNAL', // clock(), signal()/raise()
];

export const LINK_FLAGS = [
  '-lc-printscan-long-double', // printf("%Lf") traps without it
  '-lwasi-emulated-process-clocks', '-lwasi-emulated-signal',
  '-Wl,-z,stack-size=1048576', // 1 MiB shadow stack (wasm-ld default is 64 KiB)
  '-Wl,--max-memory=268435456', // 256 MiB cap: malloc() returns NULL instead of eating the tab
];

/** Guardrail mode: UBSan with our own runtime (ubsan_rt.c); stops at the first error like native. */
export const GUARDRAIL_FLAGS = ['-fsanitize=undefined', '-fno-sanitize-recover=all'];

/** Browser leak checker: allocation sites via -include, global registry + free interception via --wrap. */
export const LEAKCHECK_COMPILE_FLAGS = ['-include', 'leakcheck.h'];
export const LEAKCHECK_LINK_FLAGS = ['-Wl,--wrap=malloc', '-Wl,--wrap=calloc', '-Wl,--wrap=realloc', '-Wl,--wrap=free'];

/** File the leak checker writes its JSON-lines report to (inside the WASI filesystem). */
export const LEAKCHECK_REPORT = '.leakcheck';

export interface BuildOptions {
  /** Translation units to compile and link (names in the file tree). */
  sources: string[];
  guardrail?: boolean;
  leakcheck?: boolean;
  /** Extra flags, e.g. ["-O2"] or ["-DLEARNER_SRC=..."]. Appended after the base flags. */
  extraFlags?: string[];
  output?: string;
}

export const SUPPORT_SOURCES = {
  courseRt: 'course_rt.c',
  ubsanRt: 'ubsan_rt.c',
  leakcheckC: 'leakcheck.c',
} as const;

/** Full clang argv for a compile+link. Support files must be present in the tree (see compile-core). */
export function clangArgs(o: BuildOptions): string[] {
  const out = o.output ?? 'main.wasm';
  const sources = [...o.sources, SUPPORT_SOURCES.courseRt];
  const compile = [...COMPILE_FLAGS];
  const link = [...LINK_FLAGS];
  if (o.guardrail) { compile.push(...GUARDRAIL_FLAGS); sources.push(SUPPORT_SOURCES.ubsanRt); }
  if (o.leakcheck) { compile.push(...LEAKCHECK_COMPILE_FLAGS); link.push(...LEAKCHECK_LINK_FLAGS); sources.push(SUPPORT_SOURCES.leakcheckC); }
  return ['clang', ...compile, ...(o.extraFlags ?? []), ...sources, '-o', out, ...link];
}

/** The pipeline views the explorer can ask the compiler worker for, besides the source itself. */
export type Stage = 'E' | 'S' | 'objdump-t' | 'objdump-d' | 'nm' | 'link';

/** The stages that are one clang run writing one text file (-E and -S). */
export type TextStage = Extract<Stage, 'E' | 'S'>;

/** clang argv for one text pipeline stage: preprocess only (-E -P, without line markers) or emit assembly (-S). */
export function stageArgs(stage: TextStage, source: string, opt: '-O0' | '-O1' | '-O2' = '-O0'): { args: string[]; output: string } {
  const base = COMPILE_FLAGS.filter(f => f !== '-g' && f !== '-O0');
  const output = stage === 'E' ? 'main.i' : 'main.s';
  const extra = stage === 'E' ? ['-E', '-P'] : ['-S', opt];
  return { args: ['clang', ...base, ...extra, source, '-o', output], output };
}
