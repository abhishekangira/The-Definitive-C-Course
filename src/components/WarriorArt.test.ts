// The aura prop (#107, for #106) and the patch erase character. Rendered with renderToStaticMarkup: Vitest does not collect .tsx tests.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FormId, WarriorMood } from '../progress/warrior';
import { blinkPaths, HEAD_VIEWBOX, WarriorArt, type AuraStage } from './WarriorArt';
import { WarriorPortrait } from './StreakWarrior';
import { blinkForIdle, composeFrame, ERASE, FORM_FRAMES, type PixelSprite } from './warrior-sprites';

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

  it('a worried or defeated pose draws no blink', () => {
    expect(markup('kid', 'ready')).toContain('data-blink=');
    for (const form of ['kid', 'warrior', 'golden', 'mane', 'crimson'] as const) {
      expect(markup(form, 'worried'), form).not.toContain('data-blink=');
    }
    expect(markup('kid', 'defeated')).not.toContain('data-blink=');
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

const FORMS: FormId[] = ['kid', 'warrior', 'golden', 'mane', 'crimson', 'ape'];

const bounds = (s: PixelSprite) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  s.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '.') continue;
      minX = Math.min(minX, s.x + i);
      maxX = Math.max(maxX, s.x + i);
      minY = Math.min(minY, s.y + j);
      maxY = Math.max(maxY, s.y + j);
    }
  });
  return { minX, minY, maxX, maxY };
};

describe('idle loops', () => {
  it('every form has a 3 or 4 frame idle loop, and worried and defeated have their own', () => {
    for (const form of FORMS) {
      const idle = FORM_FRAMES[form].idle.map(composeFrame);
      expect(idle.length).toBeGreaterThanOrEqual(3);
      expect(idle.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < idle.length; i++) {
        expect(idle[i].rows.join('\n')).not.toBe(idle[(i + 1) % idle.length].rows.join('\n'));
      }
      const worried = FORM_FRAMES[form].worried!.map(composeFrame);
      expect(worried.length).toBeGreaterThanOrEqual(3);
      expect(worried[0].rows.join('\n')).not.toBe(idle[0].rows.join('\n'));
      for (let i = 0; i < worried.length; i++) {
        expect(worried[i].rows.join('\n')).not.toBe(worried[(i + 1) % worried.length].rows.join('\n'));
      }
    }
    const down = FORM_FRAMES.kid.defeated!.map(composeFrame);
    expect(down.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < down.length; i++) {
      expect(down[i].rows.join('\n')).not.toBe(down[(i + 1) % down.length].rows.join('\n'));
    }
    expect(FORM_FRAMES.ape.blink).toBeUndefined();
    expect(FORM_FRAMES.warrior.blink?.rows.length).toBeGreaterThan(0);
    expect(markup('warrior', 'ready')).toContain('data-pose="4"');
    expect(markup('warrior', 'ready')).toContain('data-blink');
    expect(markup('ape', 'ready')).not.toContain('data-blink');
  });

  it('HEAD_VIEWBOX holds the hair, both eyes and the blink of idle and worried, and not the feet', () => {
    for (const form of FORMS) {
      const [x, y, w, h] = HEAD_VIEWBOX[form].split(' ').map(Number);
      const inside = (px: number, py: number) => px >= x && py >= y && px < x + w && py < y + h;
      for (const frame of [FORM_FRAMES[form].idle[0], FORM_FRAMES[form].worried![0]]) {
        const sprite = composeFrame(frame);
        const b = bounds(sprite);
        expect(b.minY, `${form} hair`).toBeGreaterThanOrEqual(y);
        expect(b.minY, `${form} hair`).toBeLessThan(y + h);
        expect(b.maxY, `${form} feet`).toBeGreaterThan(y + h);
        const band = eyeBand(sprite);
        expect(w, `${form} eye-row width`).toBeGreaterThanOrEqual(band.width);
        expect(band.minX, `${form} eye row`).toBeGreaterThanOrEqual(x);
        expect(band.maxX, `${form} eye row`).toBeLessThan(x + w);
        for (const [px, py] of eyeWhites(sprite)) expect(inside(px, py), `${form} eye ${px},${py}`).toBe(true);
      }
      const blink = FORM_FRAMES[form].blink;
      if (!blink) continue;
      const placed = blinkForIdle(blink, 0);
      placed.rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] !== '.') {
          expect(inside(placed.x + i, placed.y + j), `${form} blink ${placed.x + i},${placed.y + j}`).toBe(true);
        }
      });
    }
  });

  it('every worried form keeps its sweat drop inside the head crop', () => {
    for (const form of FORMS) {
      const sweat = markup(form, 'worried').split('data-sweat=""')[1]?.split('</g>')[0] ?? '';
      expect(sweat, form).not.toBe('');
      const [x, y, w, h] = HEAD_VIEWBOX[form].split(' ').map(Number);
      const pixels = cellsIn(sweat);
      expect(pixels.length, form).toBeGreaterThan(0);
      for (const [px, py] of pixels) {
        expect(px, `${form} ${px},${py}`).toBeGreaterThanOrEqual(x);
        expect(px, `${form} ${px},${py}`).toBeLessThan(x + w);
        expect(py, `${form} ${px},${py}`).toBeGreaterThanOrEqual(y);
        expect(py, `${form} ${px},${py}`).toBeLessThan(y + h);
      }
    }
  });
});

const BLINK_FORMS = ['kid', 'warrior', 'golden', 'mane', 'crimson'] as const;

function cellAt(s: PixelSprite, x: number, y: number): string {
  const row = s.rows[y - s.y];
  if (row === undefined || x < s.x) return '.';
  return row[x - s.x] ?? '.';
}

function eyeWhites(s: PixelSprite): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  s.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === 'W') out.push([s.x + i, s.y + j]);
  });
  return out;
}

/** Ink width of the rows that hold the eye whites. The head crop has to cover this, not just one eye. */
function eyeBand(s: PixelSprite): { minX: number; maxX: number; width: number } {
  const ys = new Set(eyeWhites(s).map(([, y]) => y));
  expect(ys.size).toBeGreaterThan(0);
  let minX = Infinity;
  let maxX = -Infinity;
  for (const ey of ys) {
    const row = s.rows[ey - s.y] ?? '';
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') {
      minX = Math.min(minX, s.x + i);
      maxX = Math.max(maxX, s.x + i);
    }
  }
  return { minX, maxX, width: maxX - minX + 1 };
}

describe('blink follows the head', () => {
  it('closes the eye on every idle frame at that frame\'s height', () => {
    for (const form of BLINK_FORMS) {
      const patch = FORM_FRAMES[form].blink!;
      const open0 = composeFrame(FORM_FRAMES[form].idle[0]);
      const restY = Math.min(...eyeWhites(open0).map(([, y]) => y));
      const closed0 = composeFrame({ sprite: open0, patches: [blinkForIdle(patch, 0)] });
      FORM_FRAMES[form].idle.forEach((frame, i) => {
        const open = composeFrame(frame);
        const whites = eyeWhites(open);
        expect(whites.length, `${form} ${i}`).toBeGreaterThan(0);
        const lift = Math.min(...whites.map(([, y]) => y)) - restY;
        const placed = blinkForIdle(patch, i);
        const closed = composeFrame({ sprite: open, patches: [placed] });
        for (const [x, y] of whites) expect(cellAt(closed, x, y), `${form} ${i} eye ${x},${y}`).not.toBe('W');
        const wide = placed.rows.reduce((m, r) => Math.max(m, r.length), 0);
        for (let y = placed.y; y < placed.y + placed.rows.length; y++) {
          for (let x = placed.x; x < placed.x + wide; x++) {
            expect(cellAt(closed, x, y), `${form} ${i} ${x},${y}`).toBe(cellAt(closed0, x, y - lift));
          }
        }
      });
    }
  });

  it('paints the shifted blink inside each idle frame', () => {
    for (const form of BLINK_FORMS) {
      const patch = FORM_FRAMES[form].blink!;
      const restY = Math.min(...eyeWhites(composeFrame(FORM_FRAMES[form].idle[0])).map(([, y]) => y));
      const parts = markup(form, 'ready').split(/data-frame="/).slice(1);
      expect(parts, form).toHaveLength(FORM_FRAMES[form].idle.length);
      parts.forEach((part, i) => {
        const lift = Math.min(...eyeWhites(composeFrame(FORM_FRAMES[form].idle[i])).map(([, y]) => y)) - restY;
        const blink = part.split('data-blink=""')[1]?.split('</g>')[0] ?? '';
        expect(blink, `${form} ${i}`).not.toBe('');
        const shifted = { x: patch.x, y: patch.y + lift, rows: patch.rows };
        for (const [, , d] of blinkPaths(shifted)) expect(blink, `${form} ${i}`).toContain(d);
      });
    }
  });

  it('stays hidden when animation is off', () => {
    const css = readFileSync(new URL('./StreakWarrior.module.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.blink \{ opacity: 0;/);
    expect(css).toContain('.still, .still * { animation: none !important; }');
    expect(css).toContain('.art, .art * { animation: none !important; }');
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
