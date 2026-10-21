// The answers of the quiz items that read generated data rather than an authored answer, shared by QuizRunner, its
// tests, content-lint and the e2e click-through: `sp` from the gdb trace (tools/trace), `order` with `session` from
// the stored native session (tools/verify). Never from a value typed into the quiz YAML.
import type { SessionResult, TraceFile, TraceStep } from '../content-model/types';
import { pickStep } from './memory-answers';

/** sp: the moment the item pauses at (`line`, its first occurrence) and the state one gdb `step` later. */
export function spSteps(trace: TraceFile, line: number): { now: TraceStep; next: TraceStep } | null {
  const now = pickStep(trace, line);
  const next = now && trace.steps[trace.steps.indexOf(now) + 1];
  return now && next ? { now, next } : null;
}

/** The call stack at a trace step, innermost frame first (as gdb's `bt` lists it). */
export const callStack = (step: TraceStep): Array<{ func: string; line: number }> => [...step.stack].reverse().map(f => ({ func: f.func, line: f.line }));

/**
 * order with `session`: the commands the session runs, in order. Every stored platform must run the same commands,
 * or there is no one right order; then the platforms that disagree are named instead.
 */
export function sessionOrder(result: SessionResult): { order: string[] } | { problem: string } {
  const runs = Object.entries(result.runs).filter(([, steps]) => steps?.length) as Array<[string, NonNullable<SessionResult['runs'][keyof SessionResult['runs']]>]>;
  if (!runs.length) return { problem: `session "${result.id}" has no stored run` };
  const [first, ...rest] = runs.map(([p, steps]) => [p, steps.map(s => s.cmd)] as const);
  const other = rest.find(([, cmds]) => cmds.join('\n') !== first[1].join('\n'));
  return other ? { problem: `session "${result.id}" runs different commands on ${first[0]} and ${other[0]}` } : { order: [...first[1]] };
}

export const sameOrder = (given: readonly string[], want: readonly string[]): boolean => given.length === want.length && given.every((x, i) => x === want[i]);
