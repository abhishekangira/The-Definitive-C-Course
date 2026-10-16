import type { SampleResult, TargetId, RunOutcome } from '../content-model/types';
import type { Platform } from '../progress/store';

export const PLATFORM_LABEL: Record<Platform, string> = {
  'mac-arm': 'Mac with Apple Silicon (arm64)',
  'mac-intel': 'Intel Mac (x86-64)',
  wsl: 'Windows with WSL (x86-64 Linux)',
  'linux-x86': 'Linux on x86-64',
  'linux-arm': 'Linux on arm64 (or WSL on an ARM laptop)',
};

const TARGET_FOR: Record<Platform, TargetId[]> = {
  'mac-arm': ['macos-arm64-appleclang'],
  'mac-intel': ['linux-x86_64-clang22'],
  wsl: ['linux-x86_64-gcc13'],
  'linux-x86': ['linux-x86_64-gcc13'],
  'linux-arm': ['linux-aarch64-gcc'],
};

export const TARGET_LABEL: Record<TargetId, string> = {
  'wasm32-clang22': 'Your browser (wasm32, clang 22)',
  'linux-x86_64-gcc13': '64-bit Linux / WSL (x86-64, gcc 13)',
  'linux-x86_64-clang22': '64-bit Linux (x86-64, clang 22)',
  'macos-arm64-appleclang': 'macOS on Apple Silicon (arm64, Apple clang)',
  'linux-aarch64-gcc': '64-bit Linux on arm64 (gcc)',
  'windows-x64-msvc': 'Windows, native MSVC (x64)',
};

/** The stored native result to show for this learner, falling back to x86-64 Linux gcc. */
export function nativeFor(sample: SampleResult, platform: Platform | undefined): { target: TargetId; run?: RunOutcome; fallback: boolean } {
  const wanted = platform ? TARGET_FOR[platform] : [];
  for (const t of wanted) if (sample.results[t]) return { target: t, run: sample.results[t]!.run, fallback: false };
  return { target: 'linux-x86_64-gcc13', run: sample.results['linux-x86_64-gcc13']?.run, fallback: Boolean(platform) };
}

/** What to show where a stored run's output would go. Undefined-behaviour output is never stored, and never shown. */
export const UB_OUTPUT_NOTE = 'Undefined behaviour: the program has no defined output, and it can differ from run to run, so none is shown.';

/** The stored stdout of a sample's run, or a note for expect=ub samples (their output is garbage by definition). */
export function storedOutputText(sample: SampleResult, run: RunOutcome | undefined): string {
  if (!run) return '—';
  if (sample.meta.expect === 'ub') return UB_OUTPUT_NOTE;
  return (run.stdoutDisplay ?? run.stdout) || '(no output)';
}

export function describeOutcome(run: RunOutcome | undefined, compiled = true): string {
  if (!compiled) return 'Does not compile.';
  if (!run) return '—';
  if (run.signal) return `Crashes with ${run.signal}.`;
  if (run.trap) return `Stops with a runtime trap (${run.trap}).`;
  if (run.timedOut) return 'Runs forever (stopped by the time limit).';
  return `Exits with status ${run.exit}.`;
}

/** Normalises output for comparing a prediction: trailing spaces per line and at the end don't matter. */
export function normOutput(s: string): string {
  return s.replace(/\r/g, '').split('\n').map(l => l.trimEnd()).join('\n').trimEnd();
}
