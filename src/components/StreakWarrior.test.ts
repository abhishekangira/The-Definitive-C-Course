// The first-time transformation is a frame sequence (crouch, aura ramp, flash, new form), not a CSS scale or glow.
// Rendered with renderToStaticMarkup: Vitest does not collect .tsx tests.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TRANSFORM_BEATS, TransformationSequence } from './StreakWarrior';
import { composeFrame, crouchSprite, FORM_FRAMES } from './warrior-sprites';

const css = readFileSync(new URL('./StreakWarrior.module.css', import.meta.url), 'utf8');

const html = (from: 'kid' | 'warrior' | 'crimson', to: 'warrior' | 'ape') =>
  renderToStaticMarkup(createElement(TransformationSequence, { from, to, mood: 'ready' }));

function stepTag(markup: string, n: number): string {
  const m = markup.match(new RegExp(`<span\\b[^>]*\\bdata-transform-step="${n}"[^>]*>`));
  expect(m, `step ${n}`).not.toBeNull();
  return m![0];
}

function stepSlice(markup: string, n: number): string {
  const start = markup.indexOf(`data-transform-step="${n}"`);
  const next = markup.indexOf(`data-transform-step="${n + 1}"`);
  return markup.slice(start, next === -1 ? undefined : next);
}

describe('transformation sequence', () => {
  it('lists stand, crouch, flicker, blaze, flash, then the new form', () => {
    expect(TRANSFORM_BEATS.map(b => b.kind === 'flash' ? 'flash' : `${b.who}:${b.aura}${b.crouch ? ':crouch' : ''}`)).toEqual([
      'from:none', 'from:none:crouch', 'from:flicker:crouch', 'from:blaze:crouch', 'flash', 'to:blaze',
    ]);
  });

  it('draws the ramp on the kid and the blaze on the new form, and the flash is the kid\'s silhouette', () => {
    const markup = html('kid', 'warrior');
    expect(markup.match(/data-transform-step="/g)).toHaveLength(6);
    expect(stepTag(markup, 0)).toContain('data-form="kid"');
    expect(stepTag(markup, 0)).toContain('data-aura="none"');
    expect(stepTag(markup, 0)).not.toContain('data-crouch');
    expect(stepTag(markup, 1)).toContain('data-crouch=""');
    expect(stepTag(markup, 2)).toContain('data-aura="flicker"');
    expect(stepTag(markup, 3)).toContain('data-aura="blaze"');
    expect(stepTag(markup, 4)).toContain('data-flash=""');
    expect(stepTag(markup, 4)).toContain('data-form="kid"');
    expect(stepTag(markup, 5)).toContain('data-form="warrior"');
    expect(stepTag(markup, 5)).toContain('data-aura="blaze"');
    expect(stepSlice(markup, 0)).not.toContain('data-aura-layer');
    expect(stepSlice(markup, 2)).toContain('data-aura="flicker"');
    expect(stepSlice(markup, 2)).toContain('data-aura-layer="tongue"');
    expect(stepSlice(markup, 3)).toContain('data-aura-layer="glow"');
    expect(stepSlice(markup, 4)).toContain('data-flash-figure=""');
    expect(stepSlice(markup, 4)).not.toContain('data-aura-layer');
    expect(stepSlice(markup, 5)).toContain('data-aura="blaze"');
    expect(stepSlice(markup, 5)).toContain('aria-label="Rio, your streak warrior, in the Warrior form, looks fired up."');
  });

  it('blaze on the arriving ape, which has no aura by default', () => {
    const markup = html('crimson', 'ape');
    expect(stepTag(markup, 0)).toContain('data-form="crimson"');
    expect(stepTag(markup, 5)).toContain('data-form="ape"');
    expect(stepSlice(markup, 5)).toContain('data-aura="blaze"');
    expect(stepSlice(markup, 5)).toContain('data-aura-layer="tongue"');
  });

  it('crouch beats draw the crouch pose in place, with no translate, and no CSS rule moves the crouch', () => {
    const markup = html('kid', 'warrior');
    for (const n of [1, 2, 3]) {
      expect(stepSlice(markup, n), `beat ${n}`).toMatch(/<g[^>]*data-crouch=""/);
      expect(stepSlice(markup, n), `beat ${n}`).not.toContain('transform="translate(');
    }
    for (const n of [0, 5]) expect(stepSlice(markup, n), `beat ${n}`).not.toContain('data-crouch=""');
    // The crouch draws different pixels from the stand, and every crouch beat draws the same crouch.
    const figure = (n: number) => stepSlice(markup, n).match(/<g[^>]*data-frame="0"[^>]*>[\s\S]*?<\/g>/)?.[0];
    expect(figure(1)).toBeDefined();
    expect(figure(1)).not.toBe(figure(0));
    expect(figure(2)).toBe(figure(1));
    expect(figure(3)).toBe(figure(1));
    expect(css).not.toMatch(/\[data-crouch\][^{]*\{[^}]*\}/);
    expect(css).toContain('--beat: 0.4s');
    expect(css).not.toContain('radial-gradient');
    expect(css).toContain('.art, .art * { animation: none !important; }');
  });

  it('the flash beat has no fill of its own: no background, border, gradient or shadow on [data-flash]', () => {
    expect(css).not.toMatch(/\[data-flash\][^{]*\{/);
    for (const part of ['Core', 'Ring', 'Edge']) expect(css).toContain(`.flash${part} { fill: var(--flash-${part.toLowerCase()}); }`);
    // Light page: a warm pale-yellow core (near-white vanished into the page) and a 2-cell amber outline (ring = edge).
    expect(css).toContain('--flash-core: #fff1a6; --flash-ring: #f08c00; --flash-edge: #f08c00;');
    // Dark page, chosen in the app or by the system: the white-hot core, which the ring joins, and a 1-cell pale-yellow edge.
    const dark = '--warrior-rim: #59627d; --flash-core: #fffdf0; --flash-ring: #fffdf0; --flash-edge: #fff3a8; }';
    expect(css).toContain(`@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) .art { ${dark} }`);
    expect(css).toContain(`:root[data-theme='dark'] .art { ${dark}`);
  });
});

/** The grid cells a run-length path (`M x y h n v1 h-n z` runs) paints. */
function cellsOf(d: string): string[] {
  const out: string[] = [];
  for (const m of d.matchAll(/M(-?\d+) (-?\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(m[3]); i++) out.push(`${Number(m[1]) + i},${m[2]}`);
  }
  expect(d.replace(/M(-?\d+) (-?\d+)h(\d+)v1h-\d+z/g, ''), 'only pixel runs').toBe('');
  return out;
}

describe('the flash beat paints only Rio\'s pixels', () => {
  for (const from of ['kid', 'warrior', 'golden', 'mane', 'crimson'] as const) {
    it(`${from}: the crouched silhouette, every opaque pixel and nothing else`, () => {
      const markup = renderToStaticMarkup(createElement(TransformationSequence, { from, to: 'ape', mood: 'ready' }));
      const slice = stepSlice(markup, 4);
      const paths = [...slice.matchAll(/<path\b([^>]*)\/?>/g)].map(m => m[1]);
      expect(paths, 'a core, a ring and an edge').toHaveLength(3);
      expect(paths[0]).toMatch(/class="[^"]*flashCore/);
      expect(paths[1]).toMatch(/class="[^"]*flashRing/);
      expect(paths[2]).toMatch(/class="[^"]*flashEdge/);
      expect(slice).not.toMatch(/data-aura|data-blink|data-frame|<rect|style=/);
      const painted = paths.flatMap(p => cellsOf(p.match(/ d="([^"]*)"/)![1]));
      expect(new Set(painted).size, 'no cell painted twice').toBe(painted.length);
      const sprite = crouchSprite(from, composeFrame(FORM_FRAMES[from].idle[0]));
      const opaque: string[] = [];
      sprite.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') opaque.push(`${sprite.x + i},${sprite.y + j}`); }));
      expect(painted.sort()).toEqual(opaque.sort());
      // The edge and the ring are 1-cell inner outlines, so a full-frame fill (or the whole sprite as outline) fails.
      const [core, ring, edge] = paths.map(p => cellsOf(p.match(/ d="([^"]*)"/)![1]).length);
      expect(edge).toBeGreaterThan(0);
      expect(ring).toBeGreaterThan(0);
      expect(core, 'the core is most of Rio').toBeGreaterThan(edge + ring);
    });
  }
});
