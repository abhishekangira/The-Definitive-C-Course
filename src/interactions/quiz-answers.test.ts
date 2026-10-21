// The answer keys of sp and session-backed order items, on generated data only: tools/verify's stored output for the
// m97 fixture sessions and tools/trace's gdb trace of add-frames. Each has a wrong answer that must be marked wrong.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { SessionsFile, TraceFile } from '../content-model/types';
import { callStack, sameOrder, sessionOrder, spSteps } from './quiz-answers';

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const m97 = JSON.parse(read('tools/verify/fixtures/generated/sessions/m97.json')) as SessionsFile;
const trace = JSON.parse(read('src/generated/traces/add-frames.json')) as TraceFile;
const runs = (id: string) => (parseYaml(read(`tools/verify/fixtures/content/modules/m97-sessions/sessions/${id}/session.yaml`)) as { steps: { all: Array<{ run: string }> } }).steps.all.map(s => s.run);

describe('sp: the line one gdb step later, from the trace', () => {
  const line = (text: string) => trace.source.split('\n').findIndex(l => l.includes(text)) + 1;

  it('steps into a call: paused at the call, the next line is the callee\'s first', () => {
    const at = spSteps(trace, line('int result = add(x, y);'))!;
    expect(at.next.line).toBe(line('int sum = a + b;'));
    expect(at.next.line).not.toBe(line('printf'));     // the wrong answer "step goes over the call" (that is `next`)
    expect(callStack(at.now)).toEqual([{ func: 'main', line: at.now.line }]);
    expect(callStack(at.next).map(f => f.func)).toEqual(['add', 'main']);
  });

  it('returns to the caller after the callee\'s closing brace', () => {
    expect(spSteps(trace, line('return sum;'))!.next.line).toBe(line('return sum;') + 1);
    const close = spSteps(trace, line('return sum;') + 1)!;
    expect(close.next.line).toBe(line('printf'));
    expect(callStack(close.next).map(f => f.func)).toEqual(['main']);
  });

  it('has no answer after the last step, or for a line that never runs', () => {
    expect(spSteps(trace, trace.steps.at(-1)!.line)).toBeNull();
    expect(spSteps(trace, 1)).toBeNull();
  });
});

describe('order with a session: the stored commands are the answer key', () => {
  it('is the session\'s steps, in order, as the session.yaml lists them', () => {
    const key = sessionOrder(m97.sessions.make);
    expect(key).toEqual({ order: runs('make') });
  });

  it('marks a swapped order wrong, and the stored order right', () => {
    const { order } = sessionOrder(m97.sessions.make) as { order: string[] };
    expect(sameOrder(order, order)).toBe(true);
    expect(sameOrder([order[1], order[0], ...order.slice(2)], order)).toBe(false);
    expect(sameOrder(order.slice(0, -1), order)).toBe(false);
  });

  it('is no key when the stored platforms ran different commands, or nothing is stored', () => {
    const make = m97.sessions.make;
    const swapped = { ...make, runs: { ...make.runs, 'linux-clang': [...make.runs['linux-clang']!].reverse() } };
    expect(sessionOrder(swapped)).toEqual({ problem: 'session "make" runs different commands on linux-clang and linux-gcc' });
    expect(sessionOrder({ ...make, runs: {} })).toEqual({ problem: 'session "make" has no stored run' });
  });
});
