import { describe, expect, it } from 'vitest';
import { trapHint } from '../runtime/wasi-run';
import {
  checkExit, checkText, commandLine, decodeBytes, describeCrash, escapeForDisplay, explainSignal, explainTrap,
  findRuntimeError, firstDifference,
} from './compare';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('decodeBytes', () => {
  it('decodes valid UTF-8 unchanged (including a BOM)', () => {
    expect(decodeBytes(new TextEncoder().encode('héllo ✓\n'))).toBe('héllo ✓\n');
    expect(decodeBytes(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('﻿A');
  });
  it('keeps invalid bytes as escapable surrogates instead of U+FFFD', () => {
    // "yx" + 0x89 '}' 0x86 0x86: the caesar starter pushes letters past 'z'.
    const s = decodeBytes(bytes(0x79, 0x78, 0x89, 0x7d, 0x86, 0x86, 0x0a));
    expect(s).not.toContain('�');
    expect(escapeForDisplay(s)).toBe('"yx\\x89}\\x86\\x86\\n"');
  });
  it('keeps valid sequences next to invalid ones', () => {
    expect(escapeForDisplay(decodeBytes(bytes(0xc3, 0xa9, 0xff, 0x41)))).toBe('"é\\xffA"');
  });
  it('rejects overlong encodings and surrogates', () => {
    expect(escapeForDisplay(decodeBytes(bytes(0xc0, 0x80)))).toBe('"\\xc0\\x80"');
    expect(escapeForDisplay(decodeBytes(bytes(0xed, 0xa0, 0x80)))).toBe('"\\xed\\xa0\\x80"');
  });
  it('handles a truncated sequence at the end', () => {
    expect(escapeForDisplay(decodeBytes(bytes(0x41, 0xe2, 0x9c)))).toBe('"A\\xe2\\x9c"');
  });
});

describe('escapeForDisplay', () => {
  it('escapes like a C string literal', () => {
    expect(escapeForDisplay('a\tb\n"q"\\\r\0\x07\x7f')).toBe('"a\\tb\\n\\"q\\"\\\\\\r\\0\\x07\\x7f"');
  });
  it('truncates long text', () => {
    expect(escapeForDisplay('abcdef', 3)).toBe('"abc"…');
  });
});

describe('firstDifference', () => {
  it('locates the first differing character', () => {
    const d = firstDifference('ciphertext: yxocll\n', 'ciphertext: yx\udc89}\n')!;
    expect(d).toMatchObject({ index: 14, line: 1, column: 15, expectedChar: 'o', actualChar: '\udc89' });
    expect(d.summary).toBe("first difference on line 1, character 15: expected 'o', got '\\x89'");
  });
  it('counts lines and columns', () => {
    const d = firstDifference('a\nbc\nde\n', 'a\nbc\ndx\n')!;
    expect(d).toMatchObject({ line: 3, column: 2, expectedLine: 'de', actualLine: 'dx' });
  });
  it('explains a missing final newline and extra output', () => {
    expect(firstDifference('hi\n', 'hi')!.summary).toBe('your output is missing the final newline (\\n)');
    expect(firstDifference('hi\n', 'hi\n\n')!.summary).toBe('your output has an extra newline (\\n) at the end');
    expect(firstDifference('hi\n', 'hi\nthere')!.summary).toBe('your output has extra text at the end: "there"');
    expect(firstDifference('hello world\n', 'hello')!.summary).toBe('your output stops early: it is missing " world\\n"');
  });
  it('returns undefined for equal strings', () => {
    expect(firstDifference('same', 'same')).toBeUndefined();
  });
});

describe('checkText', () => {
  it('treats a string as exact equality', () => {
    expect(checkText('a\n', 'a\n')).toEqual({ ok: true });
    const r = checkText('a\n', 'a');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r).toMatchObject({ how: 'exactly', expected: 'a\n', actual: 'a' });
  });
  it('supports trim, contains, notContains and matches', () => {
    expect(checkText({ equals: 'x', trim: true }, '  x \n')).toEqual({ ok: true });
    expect(checkText({ contains: ['Usage', 'key'] }, 'Usage: ./caesar key\n')).toEqual({ ok: true });
    expect(checkText({ contains: ['Usage', 'nope'] }, 'Usage')).toMatchObject({ ok: false, how: 'containing', expected: 'nope' });
    expect(checkText({ notContains: ['Segmentation'] }, 'Segmentation fault')).toMatchObject({ ok: false, how: 'not containing' });
    expect(checkText({ matches: '^ciphertext: Uryyb, Jbeyq!\\n$' }, 'ciphertext: Uryyb, Jbeyq!\n')).toEqual({ ok: true });
    expect(checkText({ matches: '^\\d+$' }, '12a')).toMatchObject({ ok: false, how: 'matching', expected: '/^\\d+$/' });
  });
  it('tolerates a single string for contains (prototype format)', () => {
    expect(checkText({ contains: 'Usage' as unknown as string[] }, 'Usage')).toEqual({ ok: true });
  });
  it('accepts anything when there is no expectation', () => {
    expect(checkText(undefined, 'whatever')).toEqual({ ok: true });
  });
});

describe('checkExit', () => {
  it('defaults to 0 and supports nonzero', () => {
    expect(checkExit(undefined, 0).ok).toBe(true);
    expect(checkExit(undefined, 1)).toEqual({ ok: false, expected: 'exit code 0' });
    expect(checkExit('nonzero', 3).ok).toBe(true);
    expect(checkExit('nonzero', 0).ok).toBe(false);
    expect(checkExit('nonzero', null).ok).toBe(false);
    expect(checkExit(1, 1).ok).toBe(true);
  });
});

describe('crash explanations', () => {
  it('explains common signals in plain English', () => {
    for (const s of ['SIGSEGV', 'SIGFPE', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGKILL']) expect(explainSignal(s)).not.toContain(s);
    expect(explainSignal('SIGSEGV')).toMatch(/segmentation fault/);
    expect(explainSignal('SIGXCPU')).toBe('the signal SIGXCPU');
  });
  it('agrees with the runtime trap hints in src/runtime/wasi-run.ts', () => {
    const traps = ['unreachable', 'memory access out of bounds', 'divide by zero', 'integer overflow', 'Maximum call stack size exceeded',
      'null function or function signature mismatch', 'something new'];
    for (const t of traps) expect(explainTrap(t)).toBe(trapHint(t));
  });
  it('describes timeouts, traps, signals and output floods', () => {
    expect(describeCrash({ timedOut: true }, 2000)).toMatch(/still running after 2 s/);
    expect(describeCrash({ trap: 'divide by zero' })).toMatch(/Integer division by zero.*SIGFPE.*\(WebAssembly trap: divide by zero\)/);
    expect(describeCrash({ signal: 'SIGSEGV' })).toMatch(/^it crashed with a segmentation fault/);
    expect(describeCrash({ outputLimit: true })).toMatch(/too much output/);
    expect(describeCrash({ signal: null, trap: null })).toBeUndefined();
  });
});

describe('helpers', () => {
  it('finds UBSan runtime errors', () => {
    expect(findRuntimeError("/abs/dir/main.c:7:41: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'\n"))
      .toEqual({ file: 'main.c', line: 7, message: "signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'" });
    expect(findRuntimeError('no errors')).toBeUndefined();
  });
  it('quotes command-line arguments', () => {
    expect(commandLine('caesar', ['23'])).toBe('./caesar 23');
    expect(commandLine('caesar', ['two words', '', "it's"])).toBe("./caesar 'two words' '' 'it'\\''s'");
  });
});
