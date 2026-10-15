import { describe, expect, it } from 'vitest';
import {
  classifyPointerText, lineDiff, markPointerConversions, normaliseRun, originalColumn, pointerMode,
  rebaseGroups, remapColumns, usesPointerFormat,
} from './normalise';

const O = '\x1e';
const C = '\x1f';

describe('markPointerConversions', () => {
  it('wraps %p (with flags/width) in octal-escaped markers and nothing else', () => {
    const src = 'printf("a=%p b=%-14p c=%d %%p %#x\\n", p, q, 1, 2);\n';
    const m = markPointerConversions(src);
    expect(m.count).toBe(2);
    expect(m.code).toBe('printf("a=\\036%p\\037 b=\\036%-14p\\037 c=%d %%p %#x\\n", p, q, 1, 2);\n');
  });

  it('skips comments, char literals and wide strings', () => {
    const src = [
      '// printf("%p")',
      '/* "%p" */',
      "char c = '%'; char d = 'p';",
      'wprintf(L"%p", p);',
      'printf(u8"%p", p);',
    ].join('\n');
    const m = markPointerConversions(src);
    expect(m.count).toBe(1);
    expect(m.code).toContain('u8"\\036%p\\037"');
    expect(m.code).toContain('L"%p"');
  });

  it('octal escapes do not swallow following hex digits', () => {
    // "\x1fab" would be one (out-of-range) hex escape; "\037ab" is \037 followed by "ab".
    expect(markPointerConversions('printf("%pab");').code).toBe('printf("\\036%p\\037ab");');
  });

  it('detects %p usage', () => {
    expect(usesPointerFormat('printf("%d", 1);')).toBe(false);
    expect(usesPointerFormat('printf("%p", (void *)0);')).toBe(true);
    expect(pointerMode('printf("%#x", 1);', undefined)).toBe('none');
    expect(pointerMode('printf("%#x", 1);', 'ptr')).toBe('heuristic');
    expect(pointerMode('printf("%p", p);', 'none')).toBe('none');
    expect(pointerMode('printf("%p", p);', undefined)).toBe('markers');
  });

  it('maps marked columns back to the original source', () => {
    const src = 'int main(void) {\n  printf("%p %d\\n", p, x + 1);\n}\n';
    const m = markPointerConversions(src);
    // In the original, `x` is at column 24 of line 2; the marked line has 8 extra characters before it.
    const markedLine = m.code.split('\n')[1];
    const markedCol = markedLine.indexOf('x + 1') + 1;
    expect(markedCol).toBe(24 + 8);
    expect(originalColumn(m.insertions, 2, markedCol)).toBe(24);
    expect(remapColumns(`main.c:2:${markedCol}: runtime error: signed integer overflow`, m.insertions)).toBe('main.c:2:24: runtime error: signed integer overflow');
    expect(originalColumn(m.insertions, 1, 5)).toBe(5); // other lines untouched
  });
});

describe('normaliseRun (markers)', () => {
  it('preserves pointer equality, numbers in first-seen order, shared across stdout and stderr', () => {
    const out = `a=${O}0x7ffd5e0c1a2c${C} b=${O}0x7ffd5e0c1a28${C} again=${O}0x7ffd5e0c1a2c${C}\n`;
    const err = `b again: ${O}0x7ffd5e0c1a28${C}\n`;
    const n = normaliseRun(out, err, 'markers', 'none');
    expect(n.stdout).toBe('a=<addr1> b=<addr2> again=<addr1>\n');
    expect(n.stderr).toBe('b again: <addr2>\n');
  });

  it('treats every NULL spelling printed by %p as <NULL>', () => {
    const out = ['(nil)', '0', '0x0', '0000000000000000', '(null)'].map(s => `${O}${s}${C}`).join(' ');
    expect(normaliseRun(out, '', 'markers', 'none').stdout).toBe('<NULL> <NULL> <NULL> <NULL> <NULL>');
  });

  it('only %p spans are touched: other hex and a bare 0 stay as written', () => {
    const out = `p=${O}0xffff8${C} magic=0xdeadbeef count=0 mask=0x0\n`;
    expect(normaliseRun(out, '', 'markers', 'none').stdout).toBe('p=<addr1> magic=0xdeadbeef count=0 mask=0x0\n');
  });

  it('matches wasm, glibc, macOS and MSVC spellings of the same layout', () => {
    const wasm = `${O}0xffff8${C} ${O}0xffff4${C} ${O}0xffff8${C} ${O}0${C}`;
    const glibc = `${O}0x7ffc1113c390${C} ${O}0x7ffc1113c394${C} ${O}0x7ffc1113c390${C} ${O}(nil)${C}`;
    const msvc = `${O}000000E5A5AFF6C0${C} ${O}000000E5A5AFF6C4${C} ${O}000000E5A5AFF6C0${C} ${O}0000000000000000${C}`;
    const want = '<addr1> <addr2> <addr1> <NULL>';
    for (const s of [wasm, glibc, msvc]) expect(normaliseRun(s, '', 'markers', 'none').stdout).toBe(want);
  });

  it('drops %14p padding in the normalised text but keeps it in the display text', () => {
    const n = normaliseRun(`[${O}       0xffff8${C}]`, '', 'markers', 'none');
    expect(n.stdout).toBe('[<addr1>]');
    expect(n.stdoutDisplay).toBe('[       0xffff8]');
  });

  it('leaves non-address text inside a span alone (e.g. puts("%p") printing the literal)', () => {
    expect(normaliseRun(`use ${O}%p${C} for pointers`, '', 'markers', 'none').stdout).toBe('use %p for pointers');
    expect(classifyPointerText('%p')).toEqual({ kind: 'other' });
  });

  it('strips stray markers (truncated output)', () => {
    expect(normaliseRun(`x=${O}0x1234`, '', 'markers', 'none').stdout).toBe('x=0x1234');
  });

  it('display: native addresses are rebased (ASLR-independent, offsets kept); wasm is shown as printed', () => {
    const run1 = `&a=${O}0x7ffe6140dbf0${C} &b=${O}0x7ffe6140dbf4${C} h=${O}0x5569eee302a0${C} nil=${O}(nil)${C}\n`;
    const run2 = `&a=${O}0x7ffde653c5b0${C} &b=${O}0x7ffde653c5b4${C} h=${O}0x5623263112a0${C} nil=${O}(nil)${C}\n`;
    const d1 = normaliseRun(run1, '', 'markers', 'linux-x86_64').stdoutDisplay;
    expect(d1).toBe(normaliseRun(run2, '', 'markers', 'linux-x86_64').stdoutDisplay);
    expect(d1).toBe('&a=0x7ffd4a3c1bc0 &b=0x7ffd4a3c1bc4 h=0x55d0c14002a0 nil=(nil)\n');
    expect(normaliseRun(`p=${O}0xffff8${C}`, '', 'markers', 'none').stdoutDisplay).toBe('p=0xffff8');
  });
});

describe('normaliseRun (heuristic, norm=ptr without %p literals)', () => {
  it('tokenises ≥5-digit 0x hex and (nil)/0x0, keeps short hex', () => {
    const n = normaliseRun('p=0x110a0 q=0x7ffd5e0c1a2c r=0x110a0 n=(nil) z=0x0 mask=0xbeef\n', '', 'heuristic', 'none');
    expect(n.stdout).toBe('p=<addr1> q=<addr2> r=<addr1> n=<NULL> z=<NULL> mask=0xbeef\n');
  });

  it('mode none changes nothing', () => {
    expect(normaliseRun('p=0x7ffd5e0c1a2c', 'e', 'none', 'linux-x86_64')).toEqual({ stdout: 'p=0x7ffd5e0c1a2c', stderr: 'e' });
  });
});

describe('rebaseGroups / lineDiff', () => {
  it('groups addresses within 1 MiB and keeps offsets', () => {
    const map = rebaseGroups([0x7ffe6140dbf0n, 0x7ffe6140dbf4n, 0x5569e9014010n]);
    expect(map(0x7ffe6140dbf4n) - map(0x7ffe6140dbf0n)).toBe(4n);
    expect(map(0x5569e9014010n)).toBe(0x55d0c1400010n);
  });

  it('produces a readable line diff', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toBe('  a\n- b\n+ B\n  c');
  });
});
