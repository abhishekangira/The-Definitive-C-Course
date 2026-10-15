// SHA-256, isomorphic. Uses Web Crypto when it is there and falls back to a small pure-JS
// implementation otherwise: Node 18 has no global `crypto`, and browsers hide crypto.subtle on
// non-secure origins (e.g. a LAN address served over plain http). Both paths give identical results
// (sha256.test.ts checks them against the FIPS 180-2 test vectors).

const enc = new TextEncoder();

/** Round constants and initial hash: fractional parts of cube/square roots of the first primes. */
const K = new Uint32Array(64);
const H0 = new Uint32Array(8);
(() => {
  let n = 0;
  for (let p = 2; n < 64; p++) {
    let prime = true;
    for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (n < 8) H0[n] = (Math.sqrt(p) * 2 ** 32) | 0;
    K[n++] = (Math.cbrt(p) * 2 ** 32) | 0;
  }
})();

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Sync(data: Uint8Array): Uint8Array {
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = len * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = Uint32Array.from(H0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** Hex SHA-256 of a UTF-8 string, synchronously (pure JS). */
export function sha256HexSync(text: string): string {
  return toHex(sha256Sync(enc.encode(text)));
}

/** Hex SHA-256 of a UTF-8 string: Web Crypto when available, otherwise the pure-JS version. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    try {
      return toHex(new Uint8Array(await subtle.digest('SHA-256', enc.encode(text))));
    } catch {
      // fall through (some embedded browsers expose subtle but refuse to digest)
    }
  }
  return sha256HexSync(text);
}
