// The first-time transformation is a frame sequence (crouch, aura ramp, flash, new form), not a CSS scale or glow.
// Rendered with renderToStaticMarkup: Vitest does not collect .tsx tests.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TRANSFORM_BEATS, TransformationSequence } from './StreakWarrior';

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

  it('draws the ramp on the kid and the blaze on the new form, and the flash is empty', () => {
    const markup = html('kid', 'warrior');
    expect(markup.match(/data-transform-step="/g)).toHaveLength(6);
    expect(stepTag(markup, 0)).toContain('data-form="kid"');
    expect(stepTag(markup, 0)).toContain('data-aura="none"');
    expect(stepTag(markup, 0)).not.toContain('data-crouch');
    expect(stepTag(markup, 1)).toContain('data-crouch=""');
    expect(stepTag(markup, 2)).toContain('data-aura="flicker"');
    expect(stepTag(markup, 3)).toContain('data-aura="blaze"');
    expect(stepTag(markup, 4)).toContain('data-flash=""');
    expect(stepTag(markup, 4)).not.toContain('data-form');
    expect(stepTag(markup, 5)).toContain('data-form="warrior"');
    expect(stepTag(markup, 5)).toContain('data-aura="blaze"');
    expect(stepSlice(markup, 0)).not.toContain('data-aura-layer');
    expect(stepSlice(markup, 2)).toContain('data-aura="flicker"');
    expect(stepSlice(markup, 2)).toContain('data-aura-layer="tongue"');
    expect(stepSlice(markup, 3)).toContain('data-aura-layer="glow"');
    expect(stepSlice(markup, 4)).not.toContain('<svg');
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

  it('crouches by whole pixels and the flash is a flat white frame, not a glow', () => {
    expect(css).toContain('translateY(8px)');
    expect(css).toContain('[data-flash] { background: #fff; border: 4px solid #16141e; }');
    expect(css).toContain('--beat: 0.4s');
    expect(css).not.toContain('radial-gradient');
    expect(css).toContain('.art, .art * { animation: none !important; }');
  });
});
