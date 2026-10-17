// A3 shows an 8-bit counter, a signed reading of the same bits, an unsigned wrap and a signed-overflow report.
// This test compiles and runs C with the learner toolchain and fails if any value on screen is stale.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileWasm, runWasm } from '../shared/wasm-node';
import { ANIM_DIR } from './lib.mjs';

const ID = 'a03-twos-complement-wheel';
const scene = (f: string) => readFileSync(path.join(ANIM_DIR, ID, 'compositions', f), 'utf8');
const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' };
const plain = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot);/g, m => ENT[m]);
const text = (html: string, id: string) => plain(html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</div>`))![1]);

async function run(code: string, guardrail = false) {
  const out = await compileWasm({ files: { 'main.c': code }, sources: ['main.c'], guardrail });
  expect(out.ok, out.raw).toBe(true);
  return runWasm(out.wasm!);
}
const bits = (n: number) => n.toString(2).padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1 $2');

describe('A3: what the animation shows is what C does', () => {
  it('scene 1: the counter values and bit patterns are what unsigned char holds, and the dial labels are every 32nd value', { timeout: 120_000 }, async () => {
    const s = scene('tw-01-wheel.html');
    const r = await run('#include <stdio.h>\nint main(void) {\n  unsigned char c = 253;\n  for (int i = 0; i < 4; i++) { printf("%d\\n", c); c += 1; }\n  return 0;\n}\n');
    const vals = r.stdout.trim().split('\n').map(Number);
    expect(vals).toEqual([253, 254, 255, 0]);
    vals.forEach((v, i) => {
      expect(text(s, `tw01-v${i}`)).toBe(String(v));
      expect(text(s, `tw01-b${i}`)).toBe(bits(v));
    });
    const labels = [...s.matchAll(/class="tw01-lbl"[^>]*>(\d+)<\/text>/g)].map(m => Number(m[1]));
    expect(labels).toEqual([0, 32, 64, 96, 128, 160, 192, 224]);
    // The hand ends at 360 degrees (= 256 values): 255 + 1 wraps to 0.
    expect(s).toContain('rotation: 360.00');
  });

  it('scene 2: the weights add up to the signed value, and the unsigned reading is 251', { timeout: 120_000 }, async () => {
    const s = scene('tw-02-signed.html');
    const r = await run('#include <stdio.h>\nint main(void) {\n  unsigned char u = 0xFB;\n  signed char g = (signed char)u;\n  unsigned char t = 0x80;\n  printf("%d %d %d %d\\n", u, g, t, (signed char)t);\n  return 0;\n}\n');
    expect(r.stdout).toBe('251 -5 128 -128\n');
    const weights = [...s.matchAll(/class="tw02-w"[^>]*>(-?\d+)</g)].map(m => Number(m[1]));
    const on = [...s.matchAll(/class="tw-cell tw02-c[^"]*"[^>]*>([01])</g)].map(m => Number(m[1]));
    expect(weights).toEqual([-128, 64, 32, 16, 8, 4, 2, 1]);
    expect(on.join('')).toBe('11111011');
    expect(on.reduce((a, b, i) => a + b * weights[i], 0)).toBe(-5);
    expect(on.reduce((a, b, i) => a + b * Math.abs(weights[i]), 0)).toBe(251);
    const p = plain(s);
    expect(p).toContain('-128 + 64 + 32 + 16 + 8 + 2 + 1 = -5');
    expect(text(s, 'tw02-un')).toContain('251');
    expect(text(s, 'tw02-sg')).toContain('-5');
    expect(p).toContain('1000 0000 is 128 unsigned and -128 signed');
  });

  it('scene 3: the unsigned snippet prints 4, and the signed one reports exactly the message on screen', { timeout: 120_000 }, async () => {
    const s = scene('tw-03-wrap.html');
    const shownOk = plain(s.match(/<div class="tw03-code">unsigned[\s\S]*?<\/div>/)![0]);
    const ok = await run(`#include <stdio.h>\nint main(void) {\n${shownOk.split('\n').map(l => '  ' + l).join('\n')}\n  return 0;\n}\n`);
    expect(ok.stdout).toBe(`${text(s, 'tw03-out')}\n`);
    expect(ok.stdout).toBe('4\n');

    const shownUb = plain(s.match(/<div class="tw03-code">volatile[\s\S]*?<\/div>/)![0]);
    const ub = await run(`#include <stdio.h>\n#include <limits.h>\nint main(void) {\n${shownUb.split('\n').map(l => '  ' + l).join('\n')}\n  printf("%d\\n", next);\n  return 0;\n}\n`, true);
    expect(ub.exitCode).not.toBe(0);
    expect(ub.stderr).toContain(text(s, 'tw03-msg'));
  });
});
