// Source-line mapping for V7's stored native panes (gcc -S -g and objdump -d -l), over the stored text itself.
// A map is parallel to the text's lines (0-based): the 1-based source line each instruction line belongs to, or null.
// Only instruction lines map. Labels (main:, .LC0:), directives (.section, .string, .globl, .loc, .cfi_*), objdump's
// function headers and its `main():` lines stay null, so the end of one function cannot claim the next function's
// header or a format string. The line info is `.loc <file> <line>` in the assembly and a `file:line` marker line
// before each group of instructions in objdump -l output. Nothing here reads an address, so the normaliser's
// placeholders (and the offsets it leaves alone) cannot break the mapping.

export type LineMap = Array<number | null>;

const lastQuoted = (s: string): string => [...s.matchAll(/"([^"]*)"/g)].at(-1)?.[1] ?? '';
const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/** `\t.file 1 "main.c"` or `\t.file 0 "<dir>" "main.c" md5 <addr1>`: the last quoted name is the file. */
const ASM_FILE = /^\s*\.file\s+(\d+)\s+(.+)$/;
/** `\t.loc 1 8 9`, `\t.loc 0 3 0 # main.c:3:0`, with optional trailing flags. */
const ASM_LOC = /^\s*\.loc\s+(\d+)\s+(\d+)\b/;
/** A gcc/clang instruction line: indented with a tab; directives and comments start with `.` or `#`, labels at column 0. */
const ASM_INSN = /^\t(?![.#])\S/;
/** An objdump instruction line: `   0:\tf3 0f 1e fa  ...`. */
const OBJ_INSN = /^\s+[0-9a-f]+:\t/;
/** A source marker line in objdump -l, with an optional discriminator suffix: `<dir>/main.c:9 (discriminator 1)`. */
const OBJ_MARK = /^(?:.*[\\/])?([^\\/:]+):(\d+)(?:\s+\(discriminator \d+\))?$/;

/**
 * Maps a gcc/clang `-S -g` listing: an instruction line belongs to the source line of the `.loc` in force. The
 * `.loc` and `.file` lines themselves, labels and directives are not instructions and stay unmapped.
 */
export function mapAsmLines(text: string, file = 'main.c'): LineMap {
  const lines = text.split('\n');
  const files = new Map<number, string>();
  const map: LineMap = new Array(lines.length).fill(null);
  let current: number | null = null;
  lines.forEach((line, i) => {
    const f = ASM_FILE.exec(line);
    if (f) { files.set(Number(f[1]), baseName(lastQuoted(f[2]))); current = null; return; }
    const l = ASM_LOC.exec(line);
    if (l) { current = files.get(Number(l[1])) === file ? Number(l[2]) : null; return; }
    if (ASM_INSN.test(line)) map[i] = current;
  });
  return map;
}

/**
 * Maps an `objdump -d -l` listing: an instruction line belongs to the source line of the `file:line` marker before
 * it. The marker lines, function headers (`0000000000000013 <main>:`) and `main():` lines stay unmapped.
 */
export function mapObjdumpLines(text: string, file = 'main.c'): LineMap {
  const lines = text.split('\n');
  const map: LineMap = new Array(lines.length).fill(null);
  let current: number | null = null;
  lines.forEach((line, i) => {
    const m = OBJ_MARK.exec(line.trimEnd());
    if (m) { current = m[1] === file ? Number(m[2]) : null; return; }
    if (OBJ_INSN.test(line)) map[i] = current;
  });
  return map;
}

/** The 1-based text line indices mapped to a 1-based source line, or [] when none are. */
export function linesFor(map: LineMap, sourceLine: number): number[] {
  const out: number[] = [];
  map.forEach((line, i) => { if (line === sourceLine) out.push(i + 1); });
  return out;
}

/** The 1-based source line a 1-based text line belongs to, or null. */
export function lineAt(map: LineMap, textLine: number): number | null {
  return map[textLine - 1] ?? null;
}
