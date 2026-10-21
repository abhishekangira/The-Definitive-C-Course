// The answers of the quiz items that read generated data rather than an authored answer, shared by QuizRunner, its
// tests, content-lint and the e2e click-through: `sp` from the gdb trace (tools/trace), `order` with `session` from
// the stored native session (tools/verify). Never from a value typed into the quiz YAML.
import type { SessionResult, TraceFile, TraceStep } from '../content-model/types';
import { pickStep } from './memory-answers';

/**
 * sp: the moment the item pauses at (`line`, its first occurrence), the state one gdb `step` later (`next`: the trace
 * is recorded with `step`, so it is the trace's next step), and where gdb's `next` would have stopped instead (`over`:
 * `next` runs a call to its end, so it is the first later step whose stack is no deeper than now's; none when the
 * program ends first).
 */
export function spSteps(trace: TraceFile, line: number): { now: TraceStep; next: TraceStep; over?: TraceStep } | null {
  const now = pickStep(trace, line);
  const i = now ? trace.steps.indexOf(now) : -1;
  const next = now && trace.steps[i + 1];
  if (!now || !next) return null;
  return { now, next, over: trace.steps.slice(i + 1).find(s => s.stack.length <= now.stack.length) };
}

export type SpStackKey = 'step' | 'before' | 'next';
export type Frames = Array<{ func: string; line: number }>;
const framesKey = (f: Frames) => f.map(x => `${x.func}:${x.line}`).join(' ');

/**
 * sp's second part, "the call stack after the step": the right stack and two wrong ones, all from the trace: the stack
 * before the step, and the stack had the learner typed `next`. `null` when two of them are the same (a line with no
 * call to step into, or the end of a function): there is no question to ask (lint `quiz-schema` reports it).
 */
export function spStackOptions(trace: TraceFile, line: number): Array<{ key: SpStackKey; frames: Frames }> | null {
  const at = spSteps(trace, line);
  if (!at?.over) return null;
  const options = [
    { key: 'step' as const, frames: callStack(at.next) },
    { key: 'before' as const, frames: callStack(at.now) },
    { key: 'next' as const, frames: callStack(at.over) },
  ];
  return new Set(options.map(o => framesKey(o.frames))).size === options.length ? options : null;
}

/** The call stack at a trace step, innermost frame first (as gdb's `bt` lists it). */
export const callStack = (step: TraceStep): Frames => [...step.stack].reverse().map(f => ({ func: f.func, line: f.line }));

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
