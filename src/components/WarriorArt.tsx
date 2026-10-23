// Rio's art as pixel sprites on a 96 x 96 grid (the pixels are in warrior-sprites.ts). Each colour becomes one SVG path
// of 1-pixel-high runs, drawn with crisp edges. The flame aura, the dark-page rim, the shadow and the Great Ape's night
// sky are computed here from the sprite, so the data holds only the drawings. Colours are fixed hex values so the art
// looks the same in light and dark; the words next to it carry the meaning. Motion is CSS (StreakWarrior.module.css),
// switched off by `still` and under prefers-reduced-motion.
import type { ReactNode } from 'react';
import type { FormId, WarriorMood } from '../progress/warrior';
import { blinkForIdle, composeFrame, FORM_FRAMES, PALETTE, type PixelSprite, type SpriteFrame } from './warrior-sprites';
import styles from './StreakWarrior.module.css';

/** The sprites' grid. */
const N = 96;
/** The grid masks are computed on: the sprite grid with room around it for the aura's flames. */
const OX = -8;
const OY = -14;
const W = 112;
const H = 112;
/** Every figure is shown in this viewBox, so a transformation never changes the scale. */
export const VIEWBOX = `${OX} ${OY} ${W} ${H}`;

type Paths = Array<[key: string, colour: string, d: string]>;

const pathCache = new Map<PixelSprite, Paths>();

/** One path per colour; every horizontal run of one colour is one rectangle. */
function toPaths(s: PixelSprite, palette: Readonly<Record<string, string>> = PALETTE): Paths {
  const hit = pathCache.get(s);
  if (hit) return hit;
  const runs = new Map<string, string[]>();
  s.rows.forEach((row, j) => {
    for (let i = 0; i < row.length;) {
      const ch = row[i];
      let n = 1;
      while (row[i + n] === ch) n++;
      if (ch !== '.') {
        const list = runs.get(ch) ?? [];
        list.push(`M${s.x + i} ${s.y + j}h${n}v1h-${n}z`);
        runs.set(ch, list);
      }
      i += n;
    }
  });
  const out: Paths = [...runs].map(([ch, d]) => [ch, palette[ch], d.join('')]);
  pathCache.set(s, out);
  return out;
}

function Pixels({ sprite, palette }: { sprite: PixelSprite; palette?: Readonly<Record<string, string>> }) {
  return <>{toPaths(sprite, palette).map(([key, fill, d]) => <path key={key} fill={fill} d={d} />)}</>;
}

const blinkPathCache = new WeakMap<PixelSprite, Paths>();

/**
 * Paths for a blink patch drawn on its own. The patch goes through `composeFrame` first, so a space
 * (`ERASE`) is transparent. `toPaths` would treat that space as a palette key and paint it black.
 */
export function blinkPaths(patch: PixelSprite): Paths {
  const hit = blinkPathCache.get(patch);
  if (hit) return hit;
  const out = toPaths(composeFrame({ sprite: patch }));
  blinkPathCache.set(patch, out);
  return out;
}

// ---------- masks: which grid cells a sprite covers, and shapes grown from them ----------
type Mask = Uint8Array;

const maskCache = new Map<PixelSprite, Mask>();
function maskOf(s: PixelSprite): Mask {
  const hit = maskCache.get(s);
  if (hit) return hit;
  const m = new Uint8Array(W * H);
  s.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') m[(s.y + j - OY) * W + s.x + i - OX] = 1;
  });
  maskCache.set(s, m);
  return m;
}

/** A mask as one path of 1-pixel-high runs. */
function maskPath(m: Mask): string {
  let d = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W;) {
      if (!m[y * W + x]) { x++; continue; }
      let n = 1;
      while (x + n < W && m[y * W + x + n]) n++;
      d += `M${x + OX} ${y + OY}h${n}v1h-${n}z`;
      x += n;
    }
  }
  return d;
}

/** Every cell within `r` of the mask. */
function grow(m: Mask, r: number): Mask {
  const out = new Uint8Array(W * H);
  const disc: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) disc.push([dx, dy]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      for (const [dx, dy] of disc) {
        const X = x + dx;
        const Y = y + dy;
        if (X >= 0 && X < W && Y >= 0 && Y < H) out[Y * W + X] = 1;
      }
    }
  }
  return out;
}

const minus = (a: Mask, b: Mask): Mask => a.map((v, i) => (v && !b[i] ? 1 : 0));

/** `none` draws nothing. `flicker` is a short flame. `blaze` is the full rising fire. #106 passes this through. */
export type AuraStage = 'none' | 'flicker' | 'blaze';

type AuraKind = 'gold' | 'crimson' | 'amber' | 'blue' | 'violet';
const AURA_COLOURS: Record<AuraKind, { tip: string; tongue: string; glow: string; particle: string }> = {
  // Tips stay near-white so a gold flame still reads on yellow hair, and on a dark page.
  gold: { tip: '#fffde8', tongue: '#ff9a00', glow: '#ffe56a', particle: '#fff3a8' },
  crimson: { tip: '#fff0c8', tongue: '#ff3b2f', glow: '#ff7a3c', particle: '#ffd0a0' },
  amber: { tip: '#fff6d0', tongue: '#ff7a18', glow: '#ffc04a', particle: '#ffe090' },
  blue: { tip: '#f4fbff', tongue: '#1a7ad4', glow: '#8ec8ff', particle: '#d6f0ff' },
  violet: { tip: '#f8f2ff', tongue: '#7a3fd0', glow: '#c9a6ff', particle: '#e4d2ff' },
};

/** The colour of a form's aura. Golden and mane stay gold, crimson stays crimson, as today. */
function auraKind(form: FormId): AuraKind {
  if (form === 'crimson') return 'crimson';
  if (form === 'warrior') return 'blue';
  if (form === 'ape') return 'violet';
  if (form === 'kid') return 'amber';
  return 'gold';
}

const AURA_FRAMES = 4;

interface AuraFrame { glow: string; tongue: string; tip: string; particles: Array<{ x: number; y: number; s: number }> }

/** Cells on the body's top edge, and only in its upper half, so flames leave the feet alone. */
function upperEdge(body: Mask): Array<[number, number]> {
  let minY = H;
  let maxY = 0;
  for (let i = 0; i < body.length; i++) if (body[i]) {
    const y = (i / W) | 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const limit = minY + Math.round((maxY - minY) * 0.62);
  const pts: Array<[number, number]> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!body[y * W + x]) continue;
      if (y > 0 && body[(y - 1) * W + x]) continue;
      if (y <= limit) pts.push([x, y]);
    }
  }
  return pts;
}

const setCell = (m: Mask, x: number, y: number) => {
  if (x >= 0 && x < W && y >= 0 && y < H) m[y * W + x] = 1;
};

/** One tongue of `len` pixels. `shift` moves it up in whole pixels; past `len` it leaves a gap and then regrows. */
function stampTongue(tongue: Mask, tip: Mask, body: Mask, x: number, top: number, len: number, shift: number, wide: boolean) {
  const gap = 3;
  for (let k = 0; k < len; k++) {
    const y = top - 1 - k - shift;
    if (y < top - (len + gap)) continue;
    if (y < 0 || y >= H) continue;
    const hot = k >= len - 2;
    const dest = hot ? tip : tongue;
    if (!body[y * W + x]) setCell(dest, x, y);
    if (wide && x + 1 < W && !body[y * W + x + 1]) setCell(dest, x + 1, y);
  }
}

/** Left and right edges of the upper body, so flames are not only a crown on the hair. */
function sideEdges(body: Mask): Array<[number, number, number]> {
  let minY = H;
  let maxY = 0;
  for (let i = 0; i < body.length; i++) if (body[i]) {
    const y = (i / W) | 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const limit = minY + Math.round((maxY - minY) * 0.7);
  const pts: Array<[number, number, number]> = [];
  for (let y = minY + 2; y <= limit; y += 4) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < W; x++) if (body[y * W + x]) {
      if (left < 0) left = x;
      right = x;
    }
    if (left > 0) pts.push([left, y, -1]);
    if (right >= 0 && right < W - 1) pts.push([right, y, 1]);
  }
  return pts;
}

/**
 * Four frames of flame tongues. Upward tongues scroll up from the scalp. Side tongues scroll outward and up.
 * Both move in whole pixels, leave a gap, and start again, so the fire rises instead of blinking in place.
 */
function tongueFrames(body: Mask, stage: 'flicker' | 'blaze'): Array<{ tongue: Mask; tip: Mask }> {
  // Blaze tongues are two pixels wide, so a step of 3 leaves a one-pixel gap and they stay tongues.
  const step = 3;
  const maxLen = stage === 'blaze' ? 16 : 9;
  const minLen = stage === 'blaze' ? 8 : 4;
  const rise = stage === 'blaze' ? 2 : 1;
  const edgePts = upperEdge(body);
  const sides = sideEdges(body);
  return Array.from({ length: AURA_FRAMES }, (_, frame) => {
    const tongue = new Uint8Array(W * H);
    const tip = new Uint8Array(W * H);
    for (let i = 0; i < edgePts.length; i += step) {
      const [x, top] = edgePts[i];
      const seed = (x * 3 + top) % 5;
      const len = minLen + ((seed + frame) % (maxLen - minLen + 1));
      const shift = (frame * rise + seed) % (len + 3);
      stampTongue(tongue, tip, body, x, top, len, shift, stage === 'blaze');
    }
    for (const [x, y, dir] of sides) {
      const seed = (x + y) % 4;
      const len = (stage === 'blaze' ? 5 : 3) + ((seed + frame) % 3);
      const shift = (frame * rise + seed) % (len + 2);
      for (let k = 0; k < len; k++) {
        const along = k + shift;
        const xx = x + dir * (1 + along);
        const yy = y - Math.floor(along / 2);
        if (xx < 0 || xx >= W || yy < 0 || yy >= H || body[yy * W + xx]) continue;
        setCell(k >= len - 2 ? tip : tongue, xx, yy);
      }
    }
    return { tongue, tip };
  });
}

/** Sparks beside the upper body. Frame 0 sits lowest; each later frame is a few whole pixels higher, then they wrap. */
function particleFrames(body: Mask, stage: 'flicker' | 'blaze'): Array<Array<{ x: number; y: number; s: number }>> {
  let minX = W;
  let maxX = 0;
  let minY = H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (body[y * W + x]) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
  }
  const n = stage === 'blaze' ? 8 : 4;
  const travel = stage === 'blaze' ? 16 : 10;
  const stepY = stage === 'blaze' ? 4 : 2;
  const size = stage === 'blaze' ? 2 : 1;
  return Array.from({ length: AURA_FRAMES }, (_, frame) => {
    const out: Array<{ x: number; y: number; s: number }> = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = (side < 0 ? minX - 3 - (i % 3) : maxX + 2 + (i % 3));
      const y = minY + 4 + ((i * 5) % 14) - ((frame * stepY + i * 3) % travel);
      if (x < 1 || x >= W - size || y < 1 || y >= H - size) continue;
      if (body[y * W + x]) continue;
      out.push({ x: x + OX, y: y + OY, s: size });
    }
    return out;
  });
}

const auraCache = new WeakMap<PixelSprite, Partial<Record<'flicker' | 'blaze', AuraFrame[]>>>();
/** Four layered frames: an inner glow, rising outer tongues, and rising particles. */
function auraFrames(stage: 'flicker' | 'blaze', s: PixelSprite): AuraFrame[] {
  const bag = auraCache.get(s);
  const cached = bag?.[stage];
  if (cached) return cached;
  const body = maskOf(s);
  const glowR = stage === 'blaze' ? 4 : 2;
  const tongues = tongueFrames(body, stage);
  const particles = particleFrames(body, stage);
  const frames = tongues.map((t, frame) => {
    const r = stage === 'blaze' && frame % 2 === 1 ? glowR + 1 : glowR;
    return {
      glow: maskPath(minus(grow(body, r), body)),
      tongue: maskPath(t.tongue),
      tip: maskPath(t.tip),
      particles: particles[frame],
    };
  });
  const next = bag ?? {};
  next[stage] = frames;
  if (!bag) auraCache.set(s, next);
  return frames;
}

function Aura({ stage, sprite, kind }: { stage: 'flicker' | 'blaze'; sprite: PixelSprite; kind: AuraKind }) {
  const c = AURA_COLOURS[kind];
  return (
    <g className={styles.aura} data-aura={stage} aria-hidden="true">
      {auraFrames(stage, sprite).map((f, i) => (
        <g key={i} className={styles[`aura${i}`]} data-aura-frame={i}>
          <path data-aura-layer="glow" fill={c.glow} d={f.glow} />
          <path data-aura-layer="tongue" fill={c.tongue} d={f.tongue} />
          <path data-aura-layer="tip" fill={c.tip} d={f.tip} />
          {f.particles.map((p, j) => <path key={j} data-particle="" fill={c.particle} d={`M${p.x} ${p.y}h${p.s}v${p.s}h-${p.s}z`} />)}
        </g>
      ))}
    </g>
  );
}

const rimCache = new Map<PixelSprite, string>();
/** The cells around a sprite's outline: a light rim on a dark page (see .rim). */
function rimPath(s: PixelSprite): string {
  let d = rimCache.get(s);
  if (d === undefined) {
    d = maskPath(minus(grow(maskOf(s), 1), maskOf(s)));
    rimCache.set(s, d);
  }
  return d;
}

function shadowPath(form: FormId): string {
  const half = form === 'kid' ? 15 : form === 'ape' ? 34 : 20;
  return `M${48 - half} 94h${half * 2}v1h-${half * 2}z M${48 - half + 4} 95h${(half - 4) * 2}v1h-${(half - 4) * 2}z`;
}

// ---------- extras: the night sky, sparks, lightning and a drop of sweat ----------
const SKY_PALETTE = { '1': '#1c1448', '2': '#2e2270', '3': '#fff6c8', '4': '#fff4c0', '5': '#e6cf80' } as const;
const CRATERS = new Set(['71,17', '72,17', '76,22', '77,22', '77,23', '73,24', '78,16']);

/** The night sky behind the Great Ape (`stars` alone, so they can twinkle). */
function skySprite(stars: boolean): PixelSprite {
  const inside = (x: number, y: number, cx: number, cy: number, r: number) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
  const rows = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x): string => {
    if (stars) return '.';
    if (inside(x, y, 74, 20, 8.5)) return CRATERS.has(`${x},${y}`) ? '5' : '4';
    if (inside(x, y, 48, 52, 38)) return '2';
    return inside(x, y, 48, 48, 47.5) ? '1' : '.';
  }));
  if (stars) {
    for (const [x, y] of [[14, 18], [26, 8], [60, 6], [86, 40], [10, 62], [88, 70]]) {
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) rows[y + dy][x + dx] = '3';
    }
  }
  return { x: 0, y: 0, rows: rows.map(r => r.join('')) };
}
const SKY = skySprite(false);
const STARS = skySprite(true);

const SWEAT_AT: Record<FormId, [number, number]> = { kid: [32, 50], warrior: [29, 30], golden: [29, 30], mane: [30, 32], crimson: [30, 32], ape: [25, 26] };
const SWEAT_PALETTE = { '6': '#8fd4ff', '7': '#2f7fb8' } as const;
const sweatAt = (form: FormId): PixelSprite => ({ x: SWEAT_AT[form][0], y: SWEAT_AT[form][1], rows: SWEAT_ROWS });
const SWEAT_ROWS = ['.6.', '666', '667', '.7.'];
const SWEAT: Record<FormId, PixelSprite> = { kid: sweatAt('kid'), warrior: sweatAt('warrior'), golden: sweatAt('golden'), mane: sweatAt('mane'), crimson: sweatAt('crimson'), ape: sweatAt('ape') };

const BOLT = ['...#', '..##', '.##.', '###.', '.##.', '##..', '#...'];
const BOLT_SPOTS: Array<[number, number]> = [[16, 40], [76, 30], [20, 66], [74, 58]];
/** A lightning bolt (`w`) inside a one-pixel blue glow (`b`). */
const BOLT_ROWS = (() => {
  const pad = ['.....', ...BOLT.map(r => `.${r}.`), '.....'];
  return pad.map((r, j) => [...r].map((ch, i) => {
    if (ch === '#') return 'w';
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => pad[j + dy]?.[i + dx] === '#') ? 'b' : '.';
  }).join(''));
})();
const BOLTS: PixelSprite[] = BOLT_SPOTS.map(([x, y]) => ({ x: x - 1, y: y - 1, rows: BOLT_ROWS }));
const BOLT_PALETTE = { w: '#effcff', b: '#2aa8f0' } as const;

function Bolts() {
  return (
    <g aria-hidden="true">
      {BOLTS.map((b, i) => (
        <g key={i} className={styles.bolt} style={{ animationDelay: `${i * 0.45}s` }}><Pixels sprite={b} palette={BOLT_PALETTE} /></g>
      ))}
    </g>
  );
}

// ---------- the whole figure ----------
/** The viewBox that frames just the head, for the header chip. */
export const HEAD_VIEWBOX: Record<FormId, string> = {
  kid: '32 34 31 31', warrior: '29 16 36 36', golden: '29 16 36 36', mane: '30 14 39 39', crimson: '30 14 39 39', ape: '24 7 46 46',
};

/** The stage a form uses when the caller leaves `aura` out: flicker for the three powered-up forms, none otherwise. */
export function defaultAura(form: FormId): AuraStage {
  return form === 'golden' || form === 'mane' || form === 'crimson' ? 'flicker' : 'none';
}

function poseFrames(form: FormId, mood: WarriorMood): readonly SpriteFrame[] {
  const art = FORM_FRAMES[form];
  if (mood === 'defeated' && art.defeated?.length) return art.defeated;
  if (mood === 'worried' && art.worried?.length) return art.worried;
  return art.idle;
}

export function WarriorArt({ form, mood, bare = false, aura }: {
  form: FormId;
  mood: WarriorMood;
  /** No aura and no night sky (silhouettes, the header head). An explicit `aura` does not override this. */
  bare?: boolean;
  /** Power-up stage. Omit it for the form's default (`defaultAura`). */
  aura?: AuraStage;
}): ReactNode {
  const frames = poseFrames(form, mood);
  const drawn = frames.map(composeFrame);
  const stage: AuraStage = bare ? 'none' : aura ?? defaultAura(form);
  const blink = mood === 'ready' ? FORM_FRAMES[form].blink : undefined;
  const sky = form === 'ape' && !bare;
  return (
    <>
      {sky && (
        <g aria-hidden="true">
          <Pixels sprite={SKY} palette={SKY_PALETTE} />
          <g className={styles.stars}><Pixels sprite={STARS} palette={SKY_PALETTE} /></g>
        </g>
      )}
      {stage !== 'none' && <Aura stage={stage} sprite={drawn[0]} kind={auraKind(form)} />}
      {!sky && <path className={styles.shadow} d={shadowPath(form)} />}
      <g className={drawn.length > 1 ? `${styles.figure} ${styles.multi}` : styles.figure} data-pose={drawn.length > 1 ? drawn.length : undefined}>
        <path className={styles.rim} d={rimPath(drawn[0])} />
        {drawn.map((sprite, i) => (
          <g key={i} data-frame={i} className={drawn.length > 1 ? styles[`pose${i}`] : undefined}>
            <Pixels sprite={sprite} />
            {blink && <g className={styles.blink} data-blink="">{blinkPaths(blinkForIdle(blink, i)).map(([key, fill, d]) => <path key={key} fill={fill} d={d} />)}</g>}
          </g>
        ))}
        {mood === 'worried' && <g className={styles.sweat} data-sweat=""><Pixels sprite={SWEAT[form]} palette={SWEAT_PALETTE} /></g>}
      </g>
      {stage !== 'none' && form === 'mane' && <Bolts />}
    </>
  );
}

const BEAN_ROWS = ['...kkkk...', '.kkGGggkk.', 'kgGggggggk', 'kgggggggdk', 'kggdkkggdk', '.kkk..kkk.'];
const BEAN_PALETTE = { k: '#173d1f', G: '#a8f394', g: '#4cc25e', d: '#2f8a3e' } as const;
const BEAN_OUTLINE: PixelSprite = { x: 0, y: 2, rows: BEAN_ROWS.map(r => r.replace(/[^k.]/g, '.')) };
const BEAN_FILL: PixelSprite = { x: 0, y: 2, rows: BEAN_ROWS.map(r => r.replace(/k/g, '.')) };

/** A pixel spirit bean: green when the learner has it; `.beanEmpty` (CSS) leaves only a grey outline. */
export function BeanArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 10 10" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <g data-bean-outline=""><Pixels sprite={BEAN_OUTLINE} palette={BEAN_PALETTE} /></g>
      <g data-bean-fill=""><Pixels sprite={BEAN_FILL} palette={BEAN_PALETTE} /></g>
    </svg>
  );
}
