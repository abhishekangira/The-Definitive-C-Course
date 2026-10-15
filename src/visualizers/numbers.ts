// Integer representation helpers (two's complement) used by the Number Playground and drills.
export type Width = 8 | 16 | 32 | 64;

export function mask(width: Width): bigint { return (1n << BigInt(width)) - 1n; }

/** Raw bit pattern (0 .. 2^width-1) for a value, wrapping like a C conversion to an unsigned type. */
export function toBits(value: bigint, width: Width): bigint { return ((value % (1n << BigInt(width))) + (1n << BigInt(width))) & mask(width); }

export function asUnsigned(bits: bigint, width: Width): bigint { return bits & mask(width); }
export function asSigned(bits: bigint, width: Width): bigint {
  const b = bits & mask(width);
  return b >> BigInt(width - 1) ? b - (1n << BigInt(width)) : b;
}

export function binary(bits: bigint, width: Width, group = 4): string {
  const s = (bits & mask(width)).toString(2).padStart(width, '0');
  return s.replace(new RegExp(`(.{${group}})(?=.)`, 'g'), '$1 ');
}
export function hex(bits: bigint, width: Width): string {
  return '0x' + (bits & mask(width)).toString(16).toUpperCase().padStart(width / 4, '0');
}

export function ctype(width: Width, signed: boolean): string {
  const base = { 8: 'char', 16: 'short', 32: 'int', 64: 'long long' }[width];
  if (width === 8) return signed ? 'signed char' : 'unsigned char';
  return signed ? base : `unsigned ${base}`;
}

export function limits(width: Width, signed: boolean): [bigint, bigint] {
  return signed ? [-(1n << BigInt(width - 1)), (1n << BigInt(width - 1)) - 1n] : [0n, mask(width)];
}

/** Parses "42", "-7", "0x2A", "0b101010" (spaces and underscores ignored). */
export function parseNumber(text: string): bigint | null {
  const t = text.trim().replace(/[\s_]/g, '').toLowerCase();
  if (!t) return null;
  try {
    const neg = t.startsWith('-');
    const body = neg ? t.slice(1) : t;
    let v: bigint;
    if (/^0x[0-9a-f]+$/.test(body)) v = BigInt(body);
    else if (/^0b[01]+$/.test(body)) v = BigInt(body);
    else if (/^\d+$/.test(body)) v = BigInt(body);
    else return null;
    return neg ? -v : v;
  } catch { return null; }
}
