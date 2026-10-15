// Integration: gdb 15 + tracer.py on the three reference programs (skipped without gdb).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { TraceFile, TraceValue } from '../../src/content-model/types';
import { generateTrace, mergeValgrind } from './trace';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'tdcc-trace-test-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const hasGdb = spawnSync('gdb', ['--version']).status === 0 && process.platform === 'linux' && process.arch === 'x64';

const trace = (name: string, stdin?: string): TraceFile =>
  generateTrace({ id: name, code: readFileSync(path.join(HERE, 'fixtures', `${name}.c`), 'utf8'), stdin }, { workDir: work }).trace;
type Ptr = Extract<TraceValue, { t: 'ptr' }>;

describe.skipIf(!hasGdb)('tracer (gdb)', () => {
  it('swap: pointer parameters resolve to main\'s locals and the values swap', () => {
    const t = trace('swap');
    expect(t).toMatchObject({ version: 1, sample: 'swap', platform: 'linux-x86_64-gcc', truncated: false, exit_code: 0, signal: null });
    const inSwap = t.steps.find(s => s.func === 'swap' && s.line === 6)!;
    const [main, swap] = inSwap.stack;
    expect(main.func).toBe('main');
    const a = swap.vars.find(v => v.name === 'a')!;
    expect(a).toMatchObject({ type: 'int *', size: 8, param: true });
    expect((a.value as Ptr).ref).toEqual({ kind: 'local', frame: 0, name: 'x', offset: 0 });
    expect((swap.vars.find(v => v.name === 'b')!.value as Ptr).v).toBe(main.vars.find(v => v.name === 'y')!.addr);
    expect(inSwap.stdout).toBe('before: x=1 y=2\n');
    const last = t.steps.at(-1)!;
    expect(last.stack[0].vars.map(v => [v.name, (v.value as { v: number }).v])).toEqual([['x', 2], ['y', 1]]);
    expect(last.return_value).toEqual({ t: 'int', v: 0 });
    expect(t.steps.map(s => s.event)).toContain('call');
    expect(t.steps.map(s => s.event)).toContain('return');
  });

  it('factorial(4): four frames deep, return values 1, 2, 6, 24', () => {
    const t = trace('factorial');
    expect(Math.max(...t.steps.map(s => s.stack.length))).toBe(5); // main + 4 × factorial
    const rets = t.steps.filter(s => s.func === 'factorial' && s.return_value).map(s => (s.return_value as { v: number }).v);
    expect(rets).toEqual([1, 2, 6, 24]);
    const deepest = t.steps.find(s => s.stack.length === 5)!;
    expect(deepest.stack.slice(1).map(f => (f.vars[0].value as { v: number }).v)).toEqual([4, 3, 2, 1]);
    // Frames sit at decreasing (rebased) stack addresses.
    const addrs = deepest.stack.slice(1).map(f => BigInt(f.vars[0].addr));
    expect([...addrs].sort((x, y) => (x > y ? -1 : 1))).toEqual(addrs);
    expect(t.steps.at(-1)!.stdout).toBe('4! = 24\n');
  });

  it('linked list: typed heap blocks, a 3 → 2 → 1 chain, then a dangling pointer after free', () => {
    const t = trace('list');
    const built = t.steps.find(s => s.func === 'main' && s.line === 27)!;
    expect(built.heap.map(h => [h.id, h.addr, h.size])).toEqual([[1, '0x555002a0', 16], [2, '0x555002c0', 16], [3, '0x555002e0', 16]]);
    const node2 = built.heap.find(h => h.id === 2)!;
    expect(node2.value).toMatchObject({ t: 'struct', fields: [{ name: 'value', value: { t: 'int', v: 20 } }, { name: 'next', value: { t: 'ptr', ref: { kind: 'heap', id: 1, offset: 0 } } }] });
    expect(built.globals[0]).toMatchObject({ name: 'node_count', value: { t: 'int', v: 3 } });
    const afterFree = t.steps.find(s => s.line === 33 && s.heap.some(h => h.freed))!;
    const list = afterFree.stack[0].vars.find(v => v.name === 'list')!.value as Ptr;
    expect(list).toMatchObject({ dangling: true, ref: { kind: 'freed', id: 3, offset: 0 } });
    expect(afterFree.heap.find(h => h.id === 3)).toEqual({ id: 3, addr: '0x555002e0', size: 16, freed: true });
    expect(t.steps.at(-1)!.heap).toEqual([]);
    expect(t.steps.at(-1)!.stdout).toBe('30\n20\n10\n');
  });

  it('a crash ends with a signal step that still has the stack', () => {
    const code = '#include <stdio.h>\nint main(void) {\n    int *p = NULL;\n    printf("about to crash\\n");\n    *p = 1;\n    return 0;\n}\n';
    const t = generateTrace({ id: 'crash', code }, { workDir: work }).trace;
    expect(t.signal).toBe('SIGSEGV');
    const last = t.steps.at(-1)!;
    expect(last).toMatchObject({ event: 'signal', signal: 'SIGSEGV', line: 5, func: 'main', stdout: 'about to crash\n' });
    expect(last.stack[0].vars[0]).toMatchObject({ name: 'p', value: { t: 'ptr', v: '0x0', ref: null } });
  });

  it('caps the number of steps', () => {
    const code = 'int main(void) {\n    int s = 0;\n    for (int i = 0; i < 100000; i++) {\n        s += i;\n    }\n    return s & 1;\n}\n';
    const t = generateTrace({ id: 'long', code }, { workDir: work, maxSteps: 50 }).trace;
    expect(t.truncated).toBe(true);
    expect(t.steps).toHaveLength(50);
  });
});

describe('mergeValgrind', () => {
  const step = (line: number, init?: boolean) => ({ i: 0, line, func: 'main', event: 'step' as const, stdout: '', globals: [], heap: [], stack: [{ func: 'main', line, vars: [{ name: 'a', type: 'int', addr: '0x1', size: 4, value: { t: 'int' as const, v: 0 }, ...(init === undefined ? {} : { init }) }] }] });
  const file = (steps: TraceFile['steps']): TraceFile => ({ version: 1, sample: 's', platform: 'linux-x86_64-gcc', source: '', steps, truncated: false, exit_code: 0, signal: null });

  it('copies definedness when both passes stepped the same lines', () => {
    const native = file([step(3), step(4)]);
    expect(mergeValgrind(native, file([step(3, false), step(4, true)]))).toBe(true);
    expect(native.steps.map(s => s.stack[0].vars[0].init)).toEqual([false, true]);
  });

  it('refuses to merge diverging passes', () => {
    const native = file([step(3), step(4)]);
    expect(mergeValgrind(native, file([step(3, false), step(5, true)]))).toBe(false);
    expect(native.steps[0].stack[0].vars[0].init).toBeUndefined();
  });
});
