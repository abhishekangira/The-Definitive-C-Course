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

// ---------------------------------------------------------------- IEEE 754 float / double (V1 float editor, float drill)

export type FloatWidth = 32 | 64;
export type FloatClass = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan';

/** Field sizes: float is 1 + 8 + 23 bits, double is 1 + 11 + 52. */
export const FLOAT_LAYOUT: Record<FloatWidth, { exponentBits: number; fractionBits: number; bias: number }> = {
  32: { exponentBits: 8, fractionBits: 23, bias: 127 },
  64: { exponentBits: 11, fractionBits: 52, bias: 1023 },
};

export interface FloatFields {
  sign: 0 | 1;
  /** The stored (biased) exponent field. */
  exponent: number;
  fraction: bigint;
  cls: FloatClass;
  /** Exponent after removing the bias (-126 / -1022 for subnormals); null for infinity and NaN. */
  unbiased: number | null;
}

/** The bit pattern of `value` stored as a float (32) or double (64), through a DataView. */
export function floatToBits(value: number, width: FloatWidth): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  if (width === 32) { dv.setFloat32(0, value); return BigInt(dv.getUint32(0)); }
  dv.setFloat64(0, value);
  return dv.getBigUint64(0);
}

/** The number a bit pattern means (a float's value is exact as a double). */
export function floatFromBits(bits: bigint, width: FloatWidth): number {
  const dv = new DataView(new ArrayBuffer(8));
  if (width === 32) { dv.setUint32(0, Number(bits & mask(32))); return dv.getFloat32(0); }
  dv.setBigUint64(0, bits & mask(64));
  return dv.getFloat64(0);
}

export function floatFields(bits: bigint, width: FloatWidth): FloatFields {
  const { exponentBits, fractionBits, bias } = FLOAT_LAYOUT[width];
  const b = bits & mask(width);
  const sign = Number(b >> BigInt(width - 1)) as 0 | 1;
  const exponent = Number((b >> BigInt(fractionBits)) & ((1n << BigInt(exponentBits)) - 1n));
  const fraction = b & ((1n << BigInt(fractionBits)) - 1n);
  const top = (1 << exponentBits) - 1;
  const cls: FloatClass = exponent === top ? (fraction === 0n ? 'infinity' : 'nan') : exponent === 0 ? (fraction === 0n ? 'zero' : 'subnormal') : 'normal';
  const unbiased = cls === 'infinity' || cls === 'nan' ? null : cls === 'normal' ? exponent - bias : 1 - bias;
  return { sign, exponent, fraction, cls, unbiased };
}

/** How the value is written for a learner: "-0", "Infinity" and "NaN" included (JS prints -0 as "0"). */
export function floatText(bits: bigint, width: FloatWidth): string {
  const f = floatFields(bits, width);
  if (f.cls === 'nan') return 'NaN';
  if (f.cls === 'zero') return f.sign ? '-0' : '0';
  return String(floatFromBits(bits, width));
}

/** The text a JavaScript Number gives for a bit pattern read as a double (the V1 "JS Number" line). */
export function jsNumberText(bits: bigint): string {
  return floatText(bits, 64);
}

/** Moves a wheel position by `delta` and wraps at 2^width, like an unsigned counter in C. */
export function wheelStep(bits: bigint, delta: number, width: Width): bigint {
  return toBits((bits & mask(width)) + BigInt(delta), width);
}

/** Angle in degrees, clockwise from the top, of a bit pattern on a wheel of `width` bits. */
export function wheelAngle(bits: bigint, width: Width): number {
  return Number(((bits & mask(width)) * 360000n) >> BigInt(width)) / 1000;
}

/**
 * Whether a decode drill has an exact short decimal answer: the float must equal its 9-significant-digit
 * decimal form. (0.5 and -2.5 do; 0.1f does not, because it is 0.100000001490116...)
 */
export function hasExactDecimal(value: number): boolean {
  return Number.isFinite(value) && Number(value.toPrecision(9)) === value;
}

/** The bit pattern of a float drill's value: a number to encode, or "0x..." text to decode (32 bits). */
export function floatDrillBits(value: number | string): bigint {
  return typeof value === 'string' ? (parseNumber(value) ?? 0n) & mask(32) : floatToBits(value, 32);
}
