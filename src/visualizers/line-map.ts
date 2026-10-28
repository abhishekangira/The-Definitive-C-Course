// Source-line mapping for V7's stored native panes (gcc -S -g and objdump -d -l), over the stored text itself.
// A map is parallel to the text's lines (0-based): the 1-based source line each output line belongs to, or null.
// The listing is what the tool printed: `.loc <file> <line>` in the assembly, and a `file:line` marker line before
// each group of instructions in objdump -l output. Nothing here reads an address, so the normaliser's placeholders
// (and the offsets it leaves alone) cannot break the mapping.

export type LineMap = Array<number | null>;

const lastQuoted = (s: string): string => [...s.matchAll(/"([^"]*)"/g)].at(-1)?.[1] ?? '';
const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/** `\t.file 1 "main.c"` or `\t.file 0 "<dir>" "main.c" md5 <addr1>`: the last quoted name is the file. */
const ASM_FILE = /^\s*\.file\s+(\d+)\s+(.+)$/;
/** `\t.loc 1 8 9`, `\t.loc 0 3 0 # main.c:3:0`, with optional trailing flags. */
const ASM_LOC = /^\s*\.loc\s+(\d+)\s+(\d+)\b/;
/** `<dir>/main.c:8` on its own line (objdump -l), with an optional path. */
const OBJ_MARK = /^(?:.*[\\/])?([^\\/:]+):(\d+)$/;

/**
 * Maps a gcc/clang `-S -g` listing: every line from a `.loc` naming `file` until the next `.loc` belongs to that
 * source line. `.file` directives name the numbered files the `.loc`s refer to (gcc numbers from 1, clang from 0).
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
    if (l) { current = files.get(Number(l[1])) === file ? Number(l[2]) : null; map[i] = current; return; }
    map[i] = current;
  });
  return map;
}

/** Maps an `objdump -d -l` listing: every line after a `file:line` marker belongs to that source line. */
export function mapObjdumpLines(text: string, file = 'main.c'): LineMap {
  const lines = text.split('\n');
  const map: LineMap = new Array(lines.length).fill(null);
  let current: number | null = null;
  lines.forEach((line, i) => {
    const m = OBJ_MARK.exec(line.trimEnd());
    if (m) { current = m[1] === file ? Number(m[2]) : null; map[i] = current; return; }
    map[i] = current;
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
