// The aura prop (#107, for #106) and the patch erase character. Rendered with renderToStaticMarkup: Vitest does not collect .tsx tests.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FormId, WarriorMood } from '../progress/warrior';
import { WarriorArt, blinkPaths, type AuraStage } from './WarriorArt';
import { WarriorPortrait } from './StreakWarrior';
import { composeFrame, ERASE, FORM_FRAMES } from './warrior-sprites';

const markup = (form: FormId, mood: WarriorMood, aura?: AuraStage, bare?: boolean) =>
  renderToStaticMarkup(createElement(WarriorArt, { form, mood, ...(aura === undefined ? {} : { aura }), ...(bare ? { bare } : {}) }));

const framesOf = (html: string) => html.match(/data-aura-frame="/g)?.length ?? 0;
const rects = (d: string) => [...d.matchAll(/M(-?\d+) (-?\d+)h(\d+)v1/g)].map(m => ({
  x: Number(m[1]), y: Number(m[2]), n: Number(m[3]),
}));
const cellsIn = (html: string, layer?: string) => {
  const out: Array<[number, number]> = [];
  for (const tag of html.matchAll(/<path\b[^>]*>/g)) {
    if (layer && !tag[0].includes(`data-aura-layer="${layer}"`)) continue;
    const d = tag[0].match(/\bd="([^"]*)"/)?.[1] ?? '';
    for (const r of rects(d)) for (let i = 0; i < r.n; i++) out.push([r.x + i, r.y]);
  }
  return out;
};
const auraChunks = (html: string) => html.split('data-aura-frame="').slice(1).map(part => part.split('</g>')[0]);
const bodyOf = (html: string) => cellsIn(html.split('data-frame="0"')[1]?.split('</g>')[0] ?? '');
const flameOf = (chunk: string) => [...cellsIn(chunk, 'tongue'), ...cellsIn(chunk, 'tip')];
/** Air between the scalp and the flame on it. A longer tongue moves the tip; only the rise opens this gap. */
function scalpGaps(body: Array<[number, number]>, flame: Array<[number, number]>): number[] {
  const bodyTop = Math.min(...body.map(([, y]) => y));
  const colTop = new Map<number, number>();
  for (const [x, y] of body) {
    const prev = colTop.get(x);
    if (prev === undefined || y < prev) colTop.set(x, y);
  }
  const base = new Map<number, number>();
  for (const [x, y] of flame) {
    const top = colTop.get(x);
    if (top === undefined || top > bodyTop + 2 || y >= top) continue;
    const prev = base.get(x);
    if (prev === undefined || y > prev) base.set(x, y);
  }
  const gaps: number[] = [];
  for (const [x, y] of base) {
    const top = colTop.get(x);
    if (top !== undefined) gaps.push(top - y - 1);
  }
  return gaps;
}
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/** How far the flame climbs above the figure. A wider tongue does not change this. */
function flameReach(html: string): number {
  const bodyTop = Math.min(...bodyOf(html).map(([, y]) => y));
  let minY = Infinity;
  for (const chunk of auraChunks(html)) for (const [, y] of flameOf(chunk)) if (y < minY) minY = y;
  return bodyTop - minY;
}
const layerLen = (html: string, layer: string) => {
  let n = 0;
  for (const m of html.matchAll(/<path\b[^>]*>/g)) {
    if (!m[0].includes(`data-aura-layer="${layer}"`)) continue;
    n += m[0].match(/\bd="([^"]*)"/)?.[1].length ?? 0;
  }
  return n;
};

describe('WarriorArt aura', () => {
  it('draws a blaze, with four layered frames, on the kid, who has none by default', () => {
    expect(markup('kid', 'ready')).not.toContain('data-aura=');
    const blaze = markup('kid', 'ready', 'blaze');
    expect(blaze).toContain('data-aura="blaze"');
    expect(framesOf(blaze)).toBe(4);
    expect(blaze).toContain('data-aura-layer="glow"');
    expect(blaze).toContain('data-aura-layer="tongue"');
    expect(blaze).toContain('data-aura-layer="tip"');
    expect(blaze).toContain('data-particle');
    const chunks = blaze.split('data-aura-frame="').slice(1).map(s => s.split('</g>')[0]);
    expect(new Set(chunks).size).toBe(4);
  });

  it('draws no aura on golden when aura is none', () => {
    expect(markup('golden', 'ready')).toContain('data-aura="flicker"');
    expect(markup('golden', 'ready', 'none')).not.toContain('data-aura=');
  });

  it('matches today when aura is omitted, and blaze works on every form', () => {
    for (const form of ['golden', 'mane', 'crimson'] as const) {
      const html = markup(form, 'ready');
      expect(html, form).toContain('data-aura="flicker"');
      expect(framesOf(html), form).toBe(4);
    }
    for (const form of ['kid', 'warrior', 'ape'] as const) {
      expect(markup(form, 'ready'), form).not.toContain('data-aura=');
    }
    for (const form of ['kid', 'warrior', 'golden', 'mane', 'crimson', 'ape'] as const) {
      const html = markup(form, 'ready', 'blaze');
      expect(html, form).toContain('data-aura="blaze"');
      expect(framesOf(html), form).toBe(4);
      expect(html, form).toContain('data-particle');
    }
  });

  it('a blaze is a taller fire than a flicker, and its particles rise across frames', () => {
    const flicker = markup('kid', 'ready', 'flicker');
    const blaze = markup('kid', 'ready', 'blaze');
    expect(layerLen(blaze, 'tongue') + layerLen(blaze, 'tip')).toBeGreaterThan(layerLen(flicker, 'tongue') + layerLen(flicker, 'tip'));
    expect(layerLen(blaze, 'tongue')).toBeGreaterThan(0);
    expect(framesOf(flicker)).toBe(4);
    const ys = blaze.split(/data-aura-frame="/).slice(1).map(part => [...part.split('</g>')[0].matchAll(/<path\b[^>]*>/g)]
      .filter(m => m[0].includes('data-particle'))
      .map(m => Number(m[0].match(/\bd="M-?\d+ (-?\d+)/)?.[1])));
    expect(ys[0].length).toBeGreaterThan(0);
    expect(ys[1][0]).toBeLessThan(ys[0][0]);
  });

  it('bare draws no aura even when blaze is asked for', () => {
    expect(markup('golden', 'ready', 'blaze', true)).not.toContain('data-aura=');
  });

  it('WarriorPortrait passes aura through', () => {
    const html = renderToStaticMarkup(createElement(WarriorPortrait, { form: 'warrior', aura: 'blaze' }));
    expect(html).toContain('data-aura="blaze"');
    expect(framesOf(html)).toBe(4);
    const omitted = renderToStaticMarkup(createElement(WarriorPortrait, { form: 'crimson' }));
    expect(omitted).toContain('data-aura="flicker"');
  });

  it('the first idle frame is the one drawn, and a worried pose uses its own list', () => {
    const html = markup('kid', 'ready');
    expect(html.match(/data-frame="/g)?.length).toBe(FORM_FRAMES.kid.idle.length);
    expect(markup('kid', 'worried')).not.toEqual(html);
    expect(markup('kid', 'defeated')).toContain('data-frame="0"');
  });

  it('tongue pixels move up between consecutive aura frames', () => {
    const html = markup('kid', 'ready', 'blaze');
    const body = bodyOf(html);
    const gaps = auraChunks(html).map(chunk => {
      const g = scalpGaps(body, flameOf(chunk));
      expect(g.length).toBeGreaterThan(0);
      return median(g);
    });
    expect(gaps).toHaveLength(4);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i], `frame ${i}`).toBeGreaterThan(gaps[i - 1]);
  });

  it('a blaze climbs higher above the figure than a flicker', () => {
    expect(flameReach(markup('kid', 'ready', 'blaze'))).toBeGreaterThan(flameReach(markup('kid', 'ready', 'flicker')));
  });

  it('the glow layer is a real path', () => {
    const html = markup('kid', 'ready', 'blaze');
    let n = 0;
    for (const tag of html.matchAll(/<path\b[^>]*>/g)) {
      if (!tag[0].includes('data-aura-layer="glow"')) continue;
      expect(tag[0].match(/\bd="([^"]*)"/)?.[1] ?? '').toMatch(/M-?\d+/);
      n++;
    }
    expect(n).toBe(4);
  });

  it('a worried pose draws no blink', () => {
    expect(markup('kid', 'ready')).toContain('data-blink=');
    for (const form of ['kid', 'warrior', 'golden', 'mane', 'crimson'] as const) {
      expect(markup(form, 'worried'), form).not.toContain('data-blink=');
    }
  });
});

describe('blinkPaths', () => {
  it('a space in a blink patch is not painted', () => {
    const paths = blinkPaths({ x: 3, y: 5, rows: ['A B'] });
    const html = paths.map(([, fill, d]) => `<path fill="${fill}" d="${d}" />`).join('');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('M4 5');
    expect(html).toContain('M3 5');
    expect(html).toContain('M5 5');
    expect(paths.every(([, fill]) => typeof fill === 'string' && fill.startsWith('#'))).toBe(true);
    expect(blinkPaths({ x: 0, y: 0, rows: [' '] })).toEqual([]);
  });

  it('WarriorArt paints its blink through blinkPaths, so a space stays transparent', () => {
    const art = FORM_FRAMES.kid as { blink?: { x: number; y: number; rows: readonly string[] } };
    const real = art.blink;
    art.blink = { x: 3, y: 5, rows: ['A B'] };
    try {
      const html = markup('kid', 'ready');
      const blink = html.split('data-blink=""')[1]?.split('</g>')[0] ?? '';
      expect(blink).toContain('M3 5');
      expect(blink).not.toContain('M4 5');
      expect(blink).not.toMatch(/<path(?![^>]*fill=)/);
    } finally {
      art.blink = real;
    }
  });
});

describe('composeFrame', () => {
  it('a space in a patch erases, and a dot leaves the pixel underneath', () => {
    expect(ERASE).toBe(' ');
    expect(composeFrame({
      sprite: { x: 0, y: 0, rows: ['KK', 'KK'] },
      patches: [{ x: 1, y: 0, rows: [' '] }],
    }).rows).toEqual(['K.', 'KK']);
    expect(composeFrame({
      sprite: { x: 4, y: 5, rows: ['ab'] },
      patches: [{ x: 4, y: 5, rows: ['.Z'] }],
    })).toEqual({ x: 4, y: 5, rows: ['aZ'] });
  });
});
