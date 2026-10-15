// Answer logic for memory diagrams, shared by the component and the e2e click-through.
import type { TraceFile, TraceStep, TraceVar } from '../content-model/types';
import { formatValue } from '../visualizers/trace-format';

export function pickStep(trace: TraceFile, line?: number, occurrence = 1, step?: number): TraceStep | undefined {
  if (step !== undefined) return trace.steps[step];
  if (line === undefined) return trace.steps[trace.steps.length - 1];
  return trace.steps.filter(s => s.line === line)[occurrence - 1];
}

export function correctAnswer(v: TraceVar): string {
  if (v.value.t === 'ptr') {
    if (v.value.v === '0x0' || v.value.v === '0') return 'NULL';
    const r = v.value.ref;
    if (!r) return '?';
    return r.kind === 'heap' || r.kind === 'freed' ? `heap #${r.id}` : `${r.name}`;
  }
  if (v.value.t === 'char' && typeof v.value.v === 'number') return String(v.value.v);
  return formatValue(v.value);
}
