import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The "Perfect lesson!" letters and the confetti use the --celebrate-0..5 tokens (src/styles/tokens.css; colours live
// in the tokens, not in a component). Each must read on the panel (--bg-elev) in both themes.
const css = readFileSync(new URL('./PerfectLesson.module.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
function block(selector: string): string {
  const open = tokens.indexOf(`${selector} {`);
  if (open < 0) throw new Error(`no block for ${selector}`);
  return tokens.slice(tokens.indexOf('{', open) + 1, tokens.indexOf('}', open));
}
const celebrate = (b: string) => [...b.matchAll(/--celebrate-(\d): (#[0-9a-f]{6});/g)].map(m => m[2]);
const bgElev = (b: string) => /--bg-elev: (#[0-9a-f]{6});/.exec(b)![1];

describe('Perfect lesson! title and confetti colours', () => {
  const [light, darkSystem, darkChosen] = [':root', ':root:not([data-theme="light"])', ':root[data-theme="dark"]'].map(block);
  it('has six distinct colours per theme, and both dark copies agree', () => {
    expect(new Set(celebrate(light)).size).toBe(6); expect(new Set(celebrate(darkSystem)).size).toBe(6);
    expect(celebrate(darkChosen)).toEqual(celebrate(darkSystem));
  });
  it.each([['light', () => light], ['dark', () => darkChosen]] as const)('meets 4.5:1 on the %s panel', (_name, b) => {
    const bg = bgElev(b());
    for (const c of celebrate(b())) expect(ratio(c, bg), `${c} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('the component uses the tokens and declares no colour of its own', () => {
    for (let i = 0; i < 6; i++) expect(css).toContain(`var(--celebrate-${i})`);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
