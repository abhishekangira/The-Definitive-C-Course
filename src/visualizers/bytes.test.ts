// The oracles are independent of bytes.ts: TextEncoder for UTF-8, and a real C program (run through the browser
// toolchain in Node) for the bytes of a uint32_t in both orders (the big-endian order is built in C with shifts).
import { beforeAll, describe, expect, it } from 'vitest';
import { compileWasm, runWasm } from '../../tools/shared/wasm-node';
import { asciiColumn, hexByte, parseCodePoint, toBytes, utf8Bytes } from './bytes';

const C = `#include <stdint.h>
#include <stdio.h>
#include <string.h>

static void show(uint64_t v, unsigned width) {
  unsigned char mem[8];
  unsigned n = width / 8;
  if (width == 8) { uint8_t x = (uint8_t)v; memcpy(mem, &x, 1); }
  if (width == 16) { uint16_t x = (uint16_t)v; memcpy(mem, &x, 2); }
  if (width == 32) { uint32_t x = (uint32_t)v; memcpy(mem, &x, 4); }
  if (width == 64) { uint64_t x = v; memcpy(mem, &x, 8); }
  printf("%u %llu little", width, (unsigned long long)v);
  for (unsigned i = 0; i < n; i++) printf(" %02X", (unsigned)mem[i]);
  printf("\\n%u %llu big", width, (unsigned long long)v);
  for (unsigned i = 0; i < n; i++) printf(" %02X", (unsigned)((v >> (8 * (n - 1 - i))) & 0xFF));
  printf("\\n");
}

int main(void) {
  show(0x41, 8);
  show(0x1234, 16);
  show(0x12345678u, 32);
  show(0xDEADBEEFu, 32);
  show(0x0123456789ABCDEFull, 64);
  return 0;
}
`;

describe('toBytes agrees with the bytes C stores and with C shifts', () => {
  let lines: string[][] = [];
  beforeAll(async () => {
    const out = await compileWasm({ files: { 'main.c': C }, sources: ['main.c'] });
    if (!out.ok || !out.wasm) throw new Error(out.raw);
    lines = (await runWasm(out.wasm)).stdout.trim().split('\n').map(l => l.split(' '));
  }, 120_000);

  it('matches every line C printed, in both orders and all four widths', () => {
    expect(lines).toHaveLength(10);
    for (const [w, v, endian, ...bytes] of lines) {
      expect(toBytes(BigInt(v), Number(w) as 8, endian as 'little').map(hexByte), `${w}-bit ${v} ${endian}`).toEqual(bytes);
    }
  });
});

describe('utf8Bytes agrees with TextEncoder', () => {
  const samples = [0x41, 0x7F, 0x80, 0xE9, 0x7FF, 0x800, 0x20AC, 0x4E2D, 0xFFFF, 0x10000, 0x1F600, 0x10FFFF];
  it('encodes every boundary of the four lengths', () => {
    for (const cp of samples) {
      expect(utf8Bytes(cp), `U+${cp.toString(16)}`).toEqual([...new TextEncoder().encode(String.fromCodePoint(cp))]);
    }
  });
  it('rejects surrogates and out-of-range values', () => {
    for (const cp of [0xD800, 0xDFFF, 0x110000, -1, 1.5]) expect(utf8Bytes(cp)).toBeNull();
  });
});

describe('asciiColumn and parseCodePoint', () => {
  it('shows printable bytes and dots (checked against the character codes of known text)', () => {
    expect(asciiColumn([...new TextEncoder().encode('Hi!')])).toBe('Hi!');
    expect(asciiColumn([0x00, 0x1F, 0x7F, 0x80, 0xFF])).toBe('.....');
    expect(asciiColumn([0x20, 0x7E])).toBe(' ~');
  });
  it('reads a typed character or a code', () => {
    expect(parseCodePoint('€')).toBe(0x20AC);
    expect(parseCodePoint('😀 and more')).toBe(0x1F600);
    expect(parseCodePoint('U+20AC')).toBe(0x20AC);
    expect(parseCodePoint('0x41')).toBe(0x41);
    expect(parseCodePoint('  ')).toBeNull();
  });
});
