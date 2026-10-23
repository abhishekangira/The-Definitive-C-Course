// The transformation's crouch is a drawn pose derived from each form's standing frame (crouchSprite), not a
// translate of the whole figure: the head and torso drop, the knees bow out, and the feet stay planted.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FORMS } from '../progress/warrior';
import { WarriorArt } from './WarriorArt';
import { composeFrame, CROUCH, crouchSprite, FORM_FRAMES, PALETTE, type PixelSprite } from './warrior-sprites';

const ink = (s: PixelSprite) => {
  const m = new Map<string, string>();
  s.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') m.set(`${s.x + i},${s.y + j}`, ch); }));
  return m;
};
const rowsOf = (m: Map<string, string>, y: number) => [...m].filter(([k]) => Number(k.split(',')[1]) === y);
const bottom = (s: PixelSprite) => s.y + s.rows.length;

describe('crouchSprite', () => {
  for (const { id: form } of FORMS) {
    const standing = composeFrame(FORM_FRAMES[form].idle[0]);
    const crouched = crouchSprite(form, standing);
    const { hip, cuff, drop, splay } = CROUCH[form];
    const a = ink(standing);
    const b = ink(crouched);

    it(`${form}: the feet stay planted and nothing reaches lower than the standing pose`, () => {
      expect(bottom(crouched)).toBe(bottom(standing));
      for (let y = cuff; y < bottom(standing); y++) expect(rowsOf(b, y), `row ${y}`).toEqual(rowsOf(a, y));
    });

    it(`${form}: the head, torso and arms drop by ${drop} whole pixels`, () => {
      expect(drop).toBeGreaterThan(0);
      expect(crouched.y).toBe(standing.y + drop);
      for (let y = standing.y; y < hip; y++) {
        const moved = rowsOf(a, y).map(([k, ch]) => [`${k.split(',')[0]},${y + drop}`, ch]);
        expect(rowsOf(b, y + drop), `row ${y}`).toEqual(moved);
      }
    });

    it(`${form}: the knees bow outward (the trousers are wider than standing), with no new colours`, () => {
      // A tail can stick out on one side (kid, crimson, ape), so it is enough that one leg's outer edge moves out by `splay`.
      const xsIn = (m: Map<string, string>, from: number, to: number) => [...m].filter(([k]) => {
        const y = Number(k.split(',')[1]);
        return y >= from && y < to;
      }).map(([k]) => Number(k.split(',')[0]));
      const before = xsIn(a, hip, cuff);
      const after = xsIn(b, hip + drop, cuff);
      const out = Math.max(Math.min(...before) - Math.min(...after), Math.max(...after) - Math.max(...before));
      expect(out).toBeGreaterThanOrEqual(splay);
      for (const ch of b.values()) expect(PALETTE[ch], ch).toBeDefined();
      for (const ch of b.values()) expect([...a.values()]).toContain(ch);
    });

    it(`${form}: the rendered crouch keeps the shadow, and the blink follows the head`, () => {
      const markup = (crouch: boolean) => renderToStaticMarkup(createElement('svg', null, createElement(WarriorArt, { form, mood: 'ready', crouch })));
      const shadow = (m: string) => m.match(/class="[^"]*shadow[^"]*" d="([^"]*)"/)?.[1];
      if (form !== 'ape') expect(shadow(markup(true))).toBe(shadow(markup(false)));
      expect(markup(true)).not.toContain('translate(');
      const blink = FORM_FRAMES[form].blink;
      if (!blink) return;
      // Every blink pixel lands on the crouched face where the standing blink lands on the standing face.
      const blinkInk = ink(blink);
      for (const [k] of blinkInk) {
        const [x, y] = k.split(',').map(Number);
        expect(b.get(`${x},${y + drop}`), `blink ${k}`).toBe(a.get(k));
      }
      const ys = [...markup(true).matchAll(/data-blink="">([\s\S]*?)<\/g>/g)].map(m => m[1]);
      expect(ys).toHaveLength(1);
      const top = Math.min(...[...ys[0].matchAll(/M-?\d+ (-?\d+)/g)].map(m => Number(m[1])));
      const topStanding = Math.min(...[...[...markup(false).matchAll(/data-blink="">([\s\S]*?)<\/g>/g)][0][1].matchAll(/M-?\d+ (-?\d+)/g)].map(m => Number(m[1])));
      expect(top).toBe(topStanding + drop);
    });
  }
});

// The transformation crouches the `from` form, which is never the Great Ape (the top form). These pins are the
// crouches a learner can see; a shallower crouch, or one without the fill between the legs, changes the hash.
const REACHABLE = ['kid', 'warrior', 'golden', 'mane', 'crimson'] as const;
const MIN_DROP: Record<(typeof REACHABLE)[number], number> = { kid: 3, warrior: 5, golden: 5, mane: 5, crimson: 5 };

/** FNV-1a over the rows, so a pin is short and any changed pixel changes it. */
const hash = (s: PixelSprite) => {
  let h = 0x811c9dc5;
  for (const ch of `${s.x},${s.y};${s.rows.join('/')}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};
const CROUCH_HASH: Record<(typeof REACHABLE)[number], string> = { kid: '0e6eae75', warrior: '92f16cd9', golden: '2c1219c0', mane: 'b7674822', crimson: '0ef8a756' };

const render = (form: (typeof REACHABLE)[number], mood: 'ready' | 'worried', crouch: boolean, aura?: 'blaze') =>
  renderToStaticMarkup(createElement('svg', null, createElement(WarriorArt, { form, mood, crouch, aura })));
/** Smallest y of every `M x y` in the markup inside the first group that matches `open`. */
const topOf = (markup: string, open: RegExp) => {
  const at = markup.search(open);
  if (at < 0) return NaN;
  const end = markup.indexOf('</g>', at);
  return Math.min(...[...markup.slice(at, end).matchAll(/M-?\d+ (-?\d+)/g)].map(m => Number(m[1])));
};

describe('the crouch a learner sees (every form a transformation starts from)', () => {
  for (const form of REACHABLE) {
    const drop = CROUCH[form].drop;

    it(`${form}: drops at least ${MIN_DROP[form]} px, and its pixels are pinned`, () => {
      expect(drop).toBeGreaterThanOrEqual(MIN_DROP[form]);
      expect(CROUCH[form].splay).toBeGreaterThanOrEqual(2);
      expect(hash(crouchSprite(form, composeFrame(FORM_FRAMES[form].idle[0])))).toBe(CROUCH_HASH[form]);
    });

    it(`${form}: the aura is computed from the crouch, so its tongues are lower by the drop`, () => {
      const stand = topOf(render(form, 'ready', false, 'blaze'), /data-aura-frame="0"/);
      const crouched = topOf(render(form, 'ready', true, 'blaze'), /data-aura-frame="0"/);
      // A tongue's height depends on the outline under it, so the
      // top moves by the drop give or take one pixel. Computed from the standing frame, it does not move at all.
      expect(crouched - stand).toBeGreaterThanOrEqual(drop - 1);
      expect(crouched - stand).toBeLessThanOrEqual(drop);
    });

    it(`${form}: the sweat drop follows the head down`, () => {
      const sweat = /<g class="[^"]*sweat[^"]*">/;
      expect(topOf(render(form, 'worried', true), sweat) - topOf(render(form, 'worried', false), sweat)).toBe(drop);
    });

    it(`${form}: the crouched figure has no idle loop (no figure class, one frame)`, () => {
      const g = render(form, 'ready', true).match(/<g[^>]*data-crouch=""[^>]*>/)?.[0] ?? '';
      expect(g).not.toBe('');
      expect(g).not.toMatch(/class=/);
      expect(render(form, 'ready', true).match(/data-frame="/g)).toHaveLength(1);
    });
  }
});
