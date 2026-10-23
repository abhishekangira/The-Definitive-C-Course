import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The "Perfect lesson!" letters each take their own colour. Each must read on the panel (--bg-elev) in both themes.
const css = readFileSync(new URL('./PerfectLesson.module.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const titleColours = (block: string) => [...block.matchAll(/--title-(\d): (#[0-9a-f]{6})/g)].map(m => m[2]);
const bgElev = (selector: string) => new RegExp(`${selector.replace(/[[\]().:*"]/g, '\\$&')} \\{[^}]*--bg-elev: (#[0-9a-f]{6})`).exec(tokens)![1];

describe('Perfect lesson! title colours', () => {
  const light = titleColours(css.slice(css.indexOf('.dialog {'), css.indexOf('}', css.indexOf('.dialog {'))));
  const darkSystem = titleColours(css.slice(css.indexOf(":root:not([data-theme='light']) .dialog"), css.indexOf('}', css.indexOf(":root:not([data-theme='light']) .dialog"))));
  const darkChosen = titleColours(css.slice(css.indexOf(":root[data-theme='dark'] .dialog"), css.indexOf('}', css.indexOf(":root[data-theme='dark'] .dialog"))));
  it('has six distinct colours per theme, and both dark copies agree', () => {
    expect(new Set(light).size).toBe(6); expect(new Set(darkSystem).size).toBe(6);
    expect(darkChosen).toEqual(darkSystem);
  });
  it.each([['light', ':root'], ['dark', ':root[data-theme="dark"]']] as const)('meets 4.5:1 on the %s panel', (name, selector) => {
    const bg = bgElev(selector);
    for (const c of name === 'light' ? light : darkSystem) expect(ratio(c, bg), `${c} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
