import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The colour tokens are the accessibility contract (AGENTS.md: WCAG AA, 4.5:1 for text, 3:1 for the edge of a form
// control and for focus), so the pairs are read from the real stylesheet. The dark theme is written twice (for the
// system preference and for the explicit choice); a third test keeps the copies the same.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const interactionCss = readFileSync(new URL('../interactions/Interaction.module.css', import.meta.url), 'utf8');

function declarationsIn(sheet: string, selector: string): Record<string, string> {
  // Strip comments first: prose like "surfaces: ground < surface ..." would otherwise parse as a declaration and
  // swallow the property after it.
  const clean = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = clean.indexOf(`${selector} {`);
  if (open < 0) throw new Error(`no block for ${selector}`);
  const body = clean.slice(clean.indexOf('{', open) + 1, clean.indexOf('}', open));
  return Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const declarations = (selector: string) => declarationsIn(css, selector);

const light = declarations(':root');
// The dark blocks only restate what changes; everything else (the terminal text colours, for one) is inherited from the light block.
const dark = { ...light, ...declarations(':root[data-theme="dark"]') };
const darkForSystem = { ...light, ...declarations(':root:not([data-theme="light"])') };

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--bg', '--bg-elev', '--bg-sunken', '--bg-code', '--info-soft'];
const TEXT = ['--text', '--text-muted', '--text-faint', '--data', '--ok', '--warn', '--err'];
const PILLS: Array<[string, string]> = [['--ok-ink', '--ok-soft'], ['--warn-ink', '--warn-soft'], ['--err-ink', '--err-soft'], ['--data-ink', '--data-soft'], ['--text-muted', '--bg-sunken']];
const ON_TERMINAL = ['--terminal-text', '--terminal-muted', '--terminal-err', '--terminal-in'];

for (const [name, t] of [['light', light], ['dark', dark]] as const) {
  describe(`${name} theme`, () => {
    it('every colour token is a plain hex value', () => {
      for (const [k, v] of Object.entries(t)) if (/^--(bg|border|control|text|accent|data|focus|ok|warn|err|info|terminal|celebrate)/.test(k) && k !== '--control-height') expect(v, k).toMatch(/^#[0-9a-f]{6}$/);
    });
    it('text and the data hue reach 4.5:1 on every surface they sit on', () => {
      for (const surface of SURFACES) for (const fg of TEXT) expect(ratio(t[fg], t[surface]), `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    });
    it('pills, the primary button and the terminal reach 4.5:1', () => {
      for (const [fg, bg] of PILLS) expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const bg of ['--accent', '--accent-hover']) expect(ratio(t['--accent-text'], t[bg]), `accent-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const fg of ON_TERMINAL) expect(ratio(t[fg], t['--terminal-bg']), `${fg} on terminal`).toBeGreaterThanOrEqual(4.5);
    });
    it('the picked compiler-error line marks its state at 3:1', () => {
      // Read the tokens `.linePicked` actually uses, from the component stylesheet, not a copy.
      const picked = declarationsIn(interactionCss, '.linePicked');
      expect(picked['border-left-color']).toBe('var(--data)');
      expect(picked.background).toBe('var(--data-soft)');
      // WCAG 1.4.11: the border is the state indicator, on the picked line and on the unpicked code surface.
      for (const bg of ['--data-soft', '--bg-code']) {
        expect(ratio(t['--data'], t[bg]), `--data on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
    it('form control edges and the focus ring reach 3:1 against the surface and the ground', () => {
      for (const surface of ['--bg', '--bg-elev']) {
        expect(ratio(t['--control'], t[surface]), `control on ${surface}`).toBeGreaterThanOrEqual(3);
        expect(ratio(t['--focus'], t[surface]), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
    it('diff mark text reaches 4.5:1 on its tinted terminal background', () => {
      expect(ratio(t['--terminal-diff-text'], t['--terminal-diff-bg']), 'terminal-diff-text on terminal-diff-bg').toBeGreaterThanOrEqual(4.5);
    });
  });
}

describe('the picked compiler-error line', () => {
  it('hover never overrides its background', () => {
    // `.codeLine:hover` must exclude the picked line: the border marks the pick, and a hover tint on top would hide
    // the line's own background. Any hover rule that paints a background has to carry `:not(.linePicked)`.
    const hoverBackgrounds = [...interactionCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selectors, body]) => selectors.includes(':hover') && /(?:^|;)\s*background:/.test(body))
      .map(([, selectors]) => selectors.trim());
    expect(hoverBackgrounds.filter(sel => !sel.includes(':not(.linePicked)'))).toEqual([]);
    expect(hoverBackgrounds.length).toBeGreaterThan(0);
  });
});

describe('dark theme copies', () => {
  it('the system-preference block and the explicit data-theme block declare the same values', () => {
    const { '--shadow-lg': _a, ...a } = darkForSystem;
    const { '--shadow-lg': _b, ...b } = dark;
    expect(a).toEqual(b);
    expect(Object.keys(dark).length).toBeGreaterThan(20);
  });
});
