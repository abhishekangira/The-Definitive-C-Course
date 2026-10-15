import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexSync } from './sha256';

// FIPS 180-2 / NIST test vectors.
const VECTORS: Array<[string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
];

describe('sha256', () => {
  it('matches the FIPS test vectors (pure JS and Web Crypto)', async () => {
    for (const [input, hex] of VECTORS) {
      expect(sha256HexSync(input)).toBe(hex);
      expect(await sha256Hex(input)).toBe(hex);
    }
  });
  it('agrees with node:crypto across block boundaries and non-ASCII text', async () => {
    for (let n = 0; n < 200; n += 7) {
      const s = 'é✓x'.repeat(n).slice(0, n * 2);
      const want = createHash('sha256').update(s, 'utf8').digest('hex');
      expect(sha256HexSync(s)).toBe(want);
      expect(await sha256Hex(s)).toBe(want);
    }
  });
  it('a million "a"s', () => {
    expect(sha256HexSync('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});
