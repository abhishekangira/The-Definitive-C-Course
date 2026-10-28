// The line mapping behind V7's native panes, on tools/verify's committed output for the m97 `pipeline` session:
// gcc and clang `-S -g` (.loc) and `objdump -d -l` (file:line markers). The expected values are source line numbers
// of the session's own main.c, checked against the instruction the tool emitted for them. Only instructions map:
// labels, directives, function headers and marker lines are null.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionsFile } from '../content-model/types';
import { lineAt, linesFor, mapAsmLines, mapObjdumpLines } from './line-map';

const m97 = JSON.parse(readFileSync(path.join(process.cwd(), 'tools/verify/fixtures/generated/sessions/m97.json'), 'utf8')) as SessionsFile;
const run = (platform: 'linux-gcc' | 'linux-clang', i: number) => m97.sessions.pipeline.runs[platform]![i].stdout;
const gccAsmText = run('linux-gcc', 2);
const gccObjdumpText = run('linux-gcc', 4);
const clangAsmText = run('linux-clang', 2);
const clangObjdumpText = run('linux-clang', 4);
const asmGcc = mapAsmLines(gccAsmText);
const objGcc = mapObjdumpLines(gccObjdumpText);
const asmClang = mapAsmLines(clangAsmText);
const objClang = mapObjdumpLines(clangObjdumpText);

/** 1-based line number of the first line containing `needle`. */
const at = (text: string, needle: string) => {
  const i = text.split('\n').findIndex(l => l.includes(needle));
  if (i < 0) throw new Error(`no line contains ${needle}`);
  return i + 1;
};
const textAt = (text: string, index: number) => text.split('\n')[index - 1];

describe('mapAsmLines (-S -g)', () => {
  it('maps each gcc instruction to the source line of the .loc in force', () => {
    expect(lineAt(asmGcc, at(gccAsmText, 'movl\t$5,'))).toBe(8); // int n = 5;
    expect(lineAt(asmGcc, at(gccAsmText, 'imull\t%eax, %eax'))).toBe(4); // return x * x;
    expect(lineAt(asmGcc, at(gccAsmText, 'call\tsquare'))).toBe(9); // int sq = square(n);
    expect(lineAt(asmGcc, at(gccAsmText, 'call\tprintf@PLT'))).toBe(10); // printf(...)
  });

  it('maps clang’s file-0 .loc and its comments to the same source lines', () => {
    expect(lineAt(asmClang, at(clangAsmText, '$5, -8(%rbp)'))).toBe(8);
    expect(lineAt(asmClang, at(clangAsmText, 'callq\tsquare'))).toBe(9);
    expect(lineAt(asmClang, at(clangAsmText, 'imull\t-4(%rbp), %eax'))).toBe(4);
  });

  it('returns all instructions of a source line and none of its neighbour', () => {
    const eight = linesFor(asmGcc, 8).map(n => textAt(gccAsmText, n));
    expect(eight.some(l => l.includes('$5,'))).toBe(true);
    expect(eight.some(l => l.includes('call\tsquare'))).toBe(false);
    const nine = linesFor(asmGcc, 9).map(n => textAt(gccAsmText, n));
    expect(nine.some(l => l.includes('call\tsquare'))).toBe(true);
    expect(nine.some(l => l.includes('$5,'))).toBe(false);
  });

  it('leaves labels and directives unmapped, so a function’s } cannot claim the next function', () => {
    for (const needle of ['.LC0:', '.string', '.globl\tmain', '.section\t.rodata', '.cfi_endproc', '.size\tmain']) {
      expect(lineAt(asmGcc, at(gccAsmText, needle)), needle).toBeNull();
    }
    expect(lineAt(asmGcc, at(gccAsmText, 'main:'))).toBeNull();
    const five = linesFor(asmGcc, 5).map(n => textAt(gccAsmText, n));
    expect(five.some(l => l.includes('.LC0:'))).toBe(false);
    expect(five.some(l => l.includes('.string'))).toBe(false);
    expect(five.some(l => l.includes('.globl'))).toBe(false);
    expect(five.some(l => l === 'main:')).toBe(false);
    expect(five.some(l => /\b(popq|ret)\b/.test(l))).toBe(true);
    // clang: the next function's label and the format string are not line 4/11 instructions either.
    expect(lineAt(asmClang, at(clangAsmText, 'main:'))).toBeNull();
    expect(lineAt(asmClang, at(clangAsmText, '.asciz'))).toBeNull();
    const eleven = linesFor(asmClang, 11).map(n => textAt(clangAsmText, n));
    expect(eleven.some(l => l.includes('.asciz'))).toBe(false);
    expect(eleven.some(l => l.includes('xorl'))).toBe(true);
  });

  it('leaves code-free source lines (the #include) without instructions', () => {
    expect(linesFor(asmGcc, 1)).toEqual([]);
    expect(linesFor(asmGcc, 1)).toEqual(linesFor(asmClang, 1));
  });

  it('does not map another file’s .loc to the source', () => {
    // The session carries stdio.h's name in a .file directive, but no instruction belongs to it.
    expect(mapAsmLines('\t.file 2 "/usr/include/stdio.h"\n\t.loc 2 12 1\n\tnop\n', 'main.c')).toEqual([null, null, null, null]);
  });
});

describe('mapObjdumpLines (objdump -d -l)', () => {
  it('maps gcc instructions after a file:line marker', () => {
    expect(lineAt(objGcc, at(gccObjdumpText, '$0x5,'))).toBe(8);
    expect(lineAt(objGcc, at(gccObjdumpText, '\tcall'))).toBe(9);
  });

  it('maps clang instructions after a file:line marker', () => {
    expect(lineAt(objClang, at(clangObjdumpText, '$0x5,'))).toBe(8);
    expect(lineAt(objClang, at(clangObjdumpText, '\tcall'))).toBe(9);
  });

  it('leaves marker lines, function headers and main(): unmapped', () => {
    expect(lineAt(objGcc, at(gccObjdumpText, '<dir>/main.c:3'))).toBeNull();
    expect(lineAt(objGcc, at(gccObjdumpText, '<main>:'))).toBeNull();
    expect(lineAt(objGcc, at(gccObjdumpText, 'main():'))).toBeNull();
    expect(lineAt(objClang, at(clangObjdumpText, '<main>:'))).toBeNull();
    const five = linesFor(objGcc, 5).map(n => textAt(gccObjdumpText, n));
    expect(five.some(l => l.includes('<main>:'))).toBe(false);
    expect(five.some(l => l.includes('main():'))).toBe(false);
    expect(five.some(l => /\b(pop|ret)\b/.test(l))).toBe(true);
  });

  it('accepts a discriminator suffix on a source marker', () => {
    const map = mapObjdumpLines('main.c:9 (discriminator 1)\n  29:\te8 00 00 00 00\tcall foo\n');
    expect(map[0]).toBeNull();
    expect(map[1]).toBe(9);
  });

  it('returns the instructions of a source line, and null before the first marker', () => {
    const eight = linesFor(objGcc, 8).map(n => textAt(gccObjdumpText, n));
    expect(eight.some(l => l.includes('$0x5,'))).toBe(true);
    expect(eight.some(l => l.includes('\tcall'))).toBe(false);
    expect(lineAt(objGcc, at(gccObjdumpText, 'Disassembly of section .text:'))).toBeNull();
  });
});
