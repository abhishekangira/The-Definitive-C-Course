// Byte Viewer helpers (V2): the bytes of an integer in memory order, the ASCII column of a hexdump line, and the
// UTF-8 bytes of one code point. Pure TypeScript.
import { mask, type Width } from './numbers';

export type Endian = 'little' | 'big';

/** The bytes of an unsigned `width`-bit pattern in memory order (index 0 is the lowest address). */
export function toBytes(bits: bigint, width: Width, endian: Endian): number[] {
  const n = width / 8;
  const b = bits & mask(width);
  const big = Array.from({ length: n }, (_, k) => Number((b >> BigInt(8 * (n - 1 - k))) & 0xFFn));
  return endian === 'big' ? big : big.reverse();
}

/** Printable ASCII as itself, every other byte as a dot (the right-hand column of a hexdump). */
export function asciiColumn(bytes: number[]): string {
  return bytes.map(b => (b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.')).join('');
}

export const hexByte = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
export const binByte = (b: number) => b.toString(2).padStart(8, '0');

/** The UTF-8 encoding of a code point (U+0000 to U+10FFFF, not a surrogate); null when it is not a scalar value. */
export function utf8Bytes(codePoint: number): number[] | null {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return null;
  if (codePoint < 0x80) return [codePoint];
  if (codePoint < 0x800) return [0xC0 | (codePoint >> 6), 0x80 | (codePoint & 0x3F)];
  if (codePoint < 0x10000) return [0xE0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F)];
  return [0xF0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3F), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F)];
}

/** The first code point of typed text, or a "U+20AC" / "0x20AC" code; null when there is none. */
export function parseCodePoint(text: string): number | null {
  const t = text.trim();
  const m = /^(?:u\+|0x)([0-9a-f]{1,6})$/i.exec(t);
  if (m) return parseInt(m[1], 16);
  const first = t.codePointAt(0);
  return first === undefined ? null : first;
}
