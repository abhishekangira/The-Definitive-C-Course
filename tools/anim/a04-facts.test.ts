// A4 decodes two float bit patterns and shows 0.1 + 0.2. This test compiles and runs C with the learner toolchain
// and fails if any bit pattern, field, decoded number or printed value on screen is stale.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileWasm, runWasm } from '../shared/wasm-node';
import { ANIM_DIR } from './lib.mjs';

const ID = 'a04-float-fields';
const scene = (f: string) => readFileSync(path.join(ANIM_DIR, ID, 'compositions', f), 'utf8');
const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' };
const plain = (html: string) => html.replace(/<br \/>/g, '\n').replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot);/g, m => ENT[m]);
const text = (html: string, id: string) => plain(html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:div|p|span)>\\s*(?:<|$)`))![1]);
const group = (bits: string, size: number) => bits.replace(new RegExp(`(.{${size}})(?=.)`, 'g'), '$1 ').trim();

async function run(code: string) {
  const out = await compileWasm({ files: { 'main.c': code }, sources: ['main.c'] });
  expect(out.ok, out.raw).toBe(true);
  return runWasm(out.wasm!);
}

// Prints: hex bits, sign, exponent field, fraction field, significand, value for the float with the given source text.
const decode = (lit: string) => `#include <stdio.h>
#include <stdint.h>
#include <string.h>
int main(void) {
  float f = ${lit};
  uint32_t u; memcpy(&u, &f, 4);
  uint32_t e = (u >> 23) & 0xFF, m = u & 0x7FFFFF;
  printf("%08X %u %u %u %.9f %.17g\\n", u, u >> 31, e, m, 1.0 + m / 8388608.0, (double)f);
  return 0;
}
`;

describe('A4: what the animation shows is what C does', () => {
  const cases: Array<[number, string]> = [[1, '1.0f'], [2, '0.1f']];
  for (const [n, lit] of cases) {
    it(`scene ${n}: the fields of ${lit} are decoded exactly as shown`, { timeout: 120_000 }, async () => {
      const s = scene(n === 1 ? 'ff-01-decode.html' : 'ff-02-tenth.html');
      const p = `ff0${n}`;
      const [hexs, sign, e, m, sig, val] = (await run(decode(lit))).stdout.trim().split(' ');
      expect(text(s, `${p}-hex`)).toBe(`0x${hexs} read as a float`);
      expect(text(s, `${p}-sb`)).toBe(sign);
      expect(text(s, `${p}-eb`)).toBe(group(Number(e).toString(2).padStart(8, '0'), 4));
      const fr = Number(m).toString(2).padStart(23, '0');
      expect(text(s, `${p}-fb`)).toBe(`${fr.slice(0, 3)} ${group(fr.slice(3), 4)}`);
      expect(text(s, `${p}-ed`)).toContain(`${e} - 127 = ${Number(e) - 127}`);
      expect(text(s, `${p}-ed`)).toContain(`scale 2^${Number(e) - 127}`);
      const shownSig = text(s, `${p}-fd`).split('\n')[0];
      expect(Number(shownSig)).toBeCloseTo(Number(sig), 9);
      expect(text(s, `${p}-fd`)).toContain(`1 + ${m} / 2^23`);
      expect(text(s, `${p}-res`)).toBe(n === 1 ? `(+1) x ${shownSig} x 2^0 = ${val}` : `${shownSig} x 2^${Number(e) - 127} = ${val}`);
    });
  }

  it('scene 3: 0.1 + 0.2 prints 0.30000000000000004 and is not equal to 0.3', { timeout: 120_000 }, async () => {
    const s = scene('ff-03-sum.html');
    const shown = plain(s.match(/<div class="ff03-c" id="ff03-src">([\s\S]*?)<\/div>/)![1]);
    const r = await run(`#include <stdio.h>\nint main(void) {\n${shown.split('\n').map(l => '  ' + l).join('\n')}\n  return 0;\n}\n`);
    expect(r.stdout.split('\n').slice(0, 2)).toEqual([text(s, 'ff03-o1'), text(s, 'ff03-o2')]);
    expect(r.stdout).toBe('0.30000000000000004\n0\n');
    // The caption under the 0 says what the comparison gave: the printed 0 means false.
    expect(shown).toContain('sum == 0.3');
    const [, flag] = r.stdout.trim().split('\n');
    expect(plain(s)).toContain(`sum == 0.3 is ${flag === '1' ? 'true' : 'false'}`);
  });
});
