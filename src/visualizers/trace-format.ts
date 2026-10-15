import type { TraceValue, TraceVar, TraceStep } from '../content-model/types';

/** Human-readable value for the stepper and memory diagrams. */
export function formatValue(v: TraceValue | undefined, opts: { addresses?: boolean } = {}): string {
  if (!v) return '?';
  switch (v.t) {
    case 'int': case 'uint': case 'float': case 'bool': return String(v.v);
    case 'char': return typeof v.v === 'number' ? `${v.v} '${printable(v.v)}'` : String(v.v);
    case 'ptr': {
      if (v.v === '0x0' || v.v === '0') return 'NULL';
      if (v.ref) {
        const target = v.ref.kind === 'heap' || v.ref.kind === 'freed' ? `heap block #${v.ref.id}` : v.ref.name ?? '?';
        const off = v.ref.offset ? ` + ${v.ref.offset}` : '';
        const where = v.ref.kind === 'freed' ? ' (freed!)' : '';
        return `→ ${target}${off}${where}${opts.addresses ? ` (${v.v})` : ''}`;
      }
      return opts.addresses ? v.v : 'pointer (dangling or not tracked)';
    }
    case 'array': return v.str !== undefined ? JSON.stringify(v.str) : `{${v.elems.map(e => formatValue(e, opts)).join(', ')}}`;
    case 'struct': return `{ ${v.fields.map(f => `.${f.name} = ${formatValue(f.value, opts)}`).join(', ')} }`;
    case 'raw': return `bytes ${v.hex}`;
  }
}

function printable(c: number): string {
  if (c === 0) return '\\0';
  if (c === 10) return '\\n';
  if (c >= 32 && c < 127) return String.fromCharCode(c);
  return '?';
}

/** Finds a variable by "frame.name" (frame = function name, innermost match first) or "name" (innermost). */
export function findVar(step: TraceStep, path: string): { frameIndex: number; v: TraceVar } | null {
  const [fn, name] = path.includes('.') ? path.split('.', 2) : [null, path];
  for (let i = step.stack.length - 1; i >= 0; i--) {
    const f = step.stack[i];
    if (fn && f.func !== fn) continue;
    const v = f.vars.find(x => x.name === name);
    if (v) return { frameIndex: i, v };
  }
  const g = step.globals.find(x => x.name === name);
  return g ? { frameIndex: -1, v: g } : null;
}

/** Steps that are worth predicting: the next line is not simply the following line (calls, returns, loops). */
export function isInterestingTransition(a: TraceStep, b: TraceStep): boolean {
  return b.line !== a.line + 1 || b.func !== a.func || b.stack.length !== a.stack.length;
}
