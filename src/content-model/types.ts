// Shared content model. Imported by the app (src/) and by the build tools (tools/, via tsx).
// Keep this file free of DOM and Node imports.

// ---------- course & modules (content/course.yaml, content/modules/*/module.yaml) ----------

export type RunsIn = 'browser' | 'native' | 'both';
export type ScLevel = 'I' | 'D' | 'A';

export interface CourseManifest {
  title: string;
  hoursPerWeek: number;
  /** Module directory names in order, e.g. "m01-c-in-your-browser". Planned modules may not exist yet. */
  modules: CourseModuleEntry[];
}

export interface CourseModuleEntry {
  id: string; // "m01"
  dir: string; // "m01-c-in-your-browser"
  number: number | 'cap';
  title: string;
  hours: number;
  /** false while the module is planned but not yet built. */
  available: boolean;
}

export interface Resource {
  title: string;
  /** Exact chapter/section/lecture. */
  detail: string;
  url?: string;
}

export interface ModuleMeta {
  id: string; // "m01"
  number: number | 'cap';
  title: string;
  why: string;
  hours: number;
  weeks: number;
  time: { lessons: number; problemSet?: number; project: number; variants: number; quizCheckpoint: number; other?: number };
  lessonsRunIn: RunsIn;
  projectRunsIn: RunsIn;
  successCriteria: Array<{ sc: string; level: ScLevel }>;
  resources: Resource[];
  /** Lesson file stems in order, e.g. "01-hello-compiled-world". */
  lessons: string[];
  /** Exercise ids that form the module's problem set (shown on the module page). */
  problemSet: string[];
  /** Project id (folder under project/). */
  project: string;
  /** Exercise ids whose variants must be mastered before the next module unlocks. */
  coreExercises: string[];
  retrieval: { sources: string[] };
}

export interface LessonFrontmatter {
  id: string; // "m01-l1"
  title: string;
  minutes: number;
  summary: string;
}

// ---------- exercises (content/modules/*/exercises/<id>/exercise.yaml) ----------

/** Exercise kinds that are folder-based. PR, MD, SP, CE, NP are sample/trace-bound components. */
export type ExerciseKind = 'ct' | 'fb' | 'pa' | 'lt';

export interface ExerciseMeta {
  id: string;
  kind: ExerciseKind;
  title: string;
  /** Markdown. For FB this is the symptom report. */
  prompt: string;
  runsIn: 'browser' | 'native';
  /** Exactly three tiers: nudge, concept, partial code. */
  hints: [string, string, string];
  /** File the learner edits (in the exercise folder), default "main.c". */
  file?: string;
  /** Variant folder names under variants/. Empty for variants themselves. */
  variants: string[];
  /** Parsons only: lines are taken from solution.c; distractors are extra wrong lines. */
  parsons?: { distractors: string[]; indent: boolean };
  /** Stdin shown pre-filled in the run panel. */
  sampleStdin?: string;
}

// ---------- tests (tests.json / check.json; shared with tools/check/check.mjs) ----------

export type TextExpect = string | { equals?: string; contains?: string[]; matches?: string; trim?: boolean; notContains?: string[] };

export interface TestRun {
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
}

export interface IoTest {
  name: string;
  run: TestRun;
  expect: { stdout?: TextExpect; stderr?: TextExpect; exit?: number | 'nonzero' };
  hint?: string;
}

export interface UnitTest {
  name: string;
  /** Harness C file (relative to the exercise/project folder) that #includes the learner's file. */
  unit: { harness: string };
  hint?: string;
}

export interface MakeTest {
  name: string;
  /** Native only: make target to run; non-zero exit fails. */
  make: { target: string; expectRebuild?: string[] };
  hint?: string;
}

export interface TestsSpec {
  version: 1;
  /** Files the learner submits (first one defines main for single-file exercises). */
  sources: string[];
  /** "error": the build must be warning-free (the default). */
  warnings?: 'error' | 'allow';
  /** Compile with the browser guardrail (UBSan) runtime. */
  guardrail?: boolean;
  /** Link the browser leak checker (leakcheck.c) and fail on leaks/heap errors. */
  leakcheck?: boolean;
  /** Native only: memory check (ASan+UBSan, LSan/leaks/valgrind). */
  memory?: boolean;
  tests: Array<IoTest | UnitTest | MakeTest>;
}

// ---------- generated sample data (src/generated/samples/<module>.json; written by tools/verify) ----------

export type TargetId =
  | 'wasm32-clang22' // the in-browser compiler (run in Node by CI)
  | 'linux-x86_64-gcc13'
  | 'linux-x86_64-clang22'
  | 'macos-arm64-appleclang'
  | 'linux-aarch64-gcc'
  | 'windows-x64-msvc';

export type Severity = 'error' | 'warning' | 'note' | 'fatal error';

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: Severity;
  message: string;
  flag?: string; // normalised, e.g. "-Wformat"
}

export interface RunOutcome {
  stdout: string;
  /** stdout with %p addresses rebased to stable display values (for showing, not comparing). */
  stdoutDisplay?: string;
  stderr: string;
  exit: number | null;
  signal?: string | null; // native: "SIGSEGV" (or "output-limit"); wasm: trap message
  trap?: string | null;
  timedOut?: boolean;
}

export interface TargetResult {
  target: TargetId;
  compiler: string; // version string
  compile: { ok: boolean; diagnostics: Diagnostic[]; raw: string };
  run?: RunOutcome;
  /** For expect=ub: outcomes observed across repeated runs (deduplicated). */
  observed?: RunOutcome[];
  sanitizer?: { ok: boolean; report?: string; kind?: string; file?: string; line?: number };
  /** stdout=both samples: the run with stdout on a pipe (run is the tty run). */
  runPipe?: RunOutcome;
  guardrail?: RunOutcome;
}

export type Expect = 'success' | 'warning' | 'compile-error' | 'runtime-error' | 'ub' | `exit:${number}`;

/** Short compiler names used in fence meta, e.g. expect.gcc=warning. */
export type CompilerKey = 'gcc' | 'clang' | 'wasm' | 'apple' | 'msvc';

export const COMPILER_TARGET: Record<CompilerKey, TargetId> = {
  gcc: 'linux-x86_64-gcc13',
  clang: 'linux-x86_64-clang22',
  wasm: 'wasm32-clang22',
  apple: 'macos-arm64-appleclang',
  msvc: 'windows-x64-msvc',
};

export interface SampleMeta {
  id: string;
  fragment?: boolean;
  /** Per-compiler overrides of `expect`, e.g. gcc 13 only warns where clang 22 errors. */
  expectBy?: Partial<Record<CompilerKey, Expect>>;
  predict?: 'output' | 'outcome' | 'choice' | 'none';
  choices?: string[];
  stdin?: string;
  args?: string[];
  expect?: Expect;
  platform?: boolean;
  predict64?: string; // question text, or "none"
  predict64Reason?: string;
  target?: 'native';
  stdoutMode?: 'tty' | 'pipe' | 'both';
  posix?: boolean;
  guardrail?: boolean;
  sanitize?: boolean;
  trace?: boolean;
  timeout?: number;
  norm?: 'ptr' | 'none';
  files?: string[];
}

export interface SampleResult {
  id: string;
  module: string;
  lesson: string;
  code: string;
  meta: SampleMeta;
  /** Hash of code + stdin + args + mode; the editor compares against it to detect edits. */
  hash: string;
  results: Partial<Record<TargetId, TargetResult>>;
  /** True when browser output differs from any native target (after normalisation). */
  flagged: boolean;
  diffs?: Array<{ target: TargetId; diff: string }>;
  /** Normalised outcome used to check predictions. */
  answer: {
    stdout: string; // canonical browser stdout (normalised)
    outcome: 'compile-error' | 'runtime-error' | 'runs' | `exit:${number}`;
    native?: { stdout: string; outcome: string };
  };
}

export interface SamplesFile {
  module: string;
  generatedBy: string;
  samples: Record<string, SampleResult>;
}

// ---------- traces (src/generated/traces/<sample>.json; written by tools/trace) ----------

export type TraceValue =
  | { t: 'int' | 'uint' | 'float' | 'char' | 'bool'; v: number | string | boolean }
  | { t: 'ptr'; v: string; ref?: { kind: 'local' | 'global' | 'heap' | 'freed'; frame?: number; name?: string; id?: number; offset: number } | null; dangling?: boolean; /** function pointers */ fn?: string }
  | { t: 'array'; elems: TraceValue[]; str?: string; /** full length when elems was cut at 64 */ len?: number }
  | { t: 'struct'; fields: Array<{ name: string; type: string; offset: number; value: TraceValue }> }
  | { t: 'raw'; hex: string };

export interface TraceVar {
  name: string;
  type: string;
  addr: string;
  size: number;
  value: TraceValue;
  param?: boolean;
  static?: boolean;
  declared?: boolean;
  init?: boolean;
  /** valgrind: per-byte definedness bits (hex), when TRACE_VALGRIND was used. */
  vbits?: string;
}

export interface TraceStep {
  i: number;
  line: number;
  func: string;
  event: 'step' | 'call' | 'return' | 'signal';
  stack: Array<{ func: string; line: number; vars: TraceVar[] }>;
  globals: TraceVar[];
  heap: Array<{ id: number; addr: string; size: number; type?: string; value?: TraceValue; init?: boolean; freed?: boolean; unreferenced?: boolean; vbits?: string }>;
  stdout: string;
  return_value?: TraceValue;
  signal?: string;
  /** valgrind errors reported at this step. */
  errors?: string[];
}

export interface TraceFile {
  version: 1;
  sample: string;
  platform: 'linux-x86_64-gcc';
  source: string;
  steps: TraceStep[];
  truncated: boolean;
  exit_code: number | null;
  signal: string | null;
}

// ---------- videos.json ----------

export interface VideoEntry {
  key: string; // "yt-1"
  id: string; // YouTube id
  title: string;
  channel: string;
  module: string;
  lesson: string;
  start: number;
  end: number;
  anchorStart: string;
  anchorEnd: string;
  why: string;
  verifiedAt: string;
}
