// The aura prop (#107, for #106) and the patch erase character. Rendered with renderToStaticMarkup: Vitest does not collect .tsx tests.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FormId, WarriorMood } from '../progress/warrior';
import { WarriorArt, type AuraStage } from './WarriorArt';
import { WarriorPortrait } from './StreakWarrior';
import { composeFrame, ERASE, FORM_FRAMES } from './warrior-sprites';

const markup = (form: FormId, mood: WarriorMood, aura?: AuraStage, bare?: boolean) =>
  renderToStaticMarkup(createElement(WarriorArt, { form, mood, ...(aura === undefined ? {} : { aura }), ...(bare ? { bare } : {}) }));

const framesOf = (html: string) => html.match(/data-aura-frame="/g)?.length ?? 0;
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
