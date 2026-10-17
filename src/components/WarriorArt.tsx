// Rio's art as pixel sprites on a 96 x 96 grid (the pixels are in warrior-sprites.ts). Each colour becomes one SVG path
// of 1-pixel-high runs, drawn with crisp edges. The flame aura, the dark-page rim, the shadow and the Great Ape's night
// sky are computed here from the sprite, so the data holds only the drawings. Colours are fixed hex values so the art
// looks the same in light and dark; the words next to it carry the meaning. Motion is CSS (StreakWarrior.module.css),
// switched off by `still` and under prefers-reduced-motion.
import type { ReactNode } from 'react';
import type { FormId, WarriorMood } from '../progress/warrior';
import { PALETTE, PATCHES, SPRITES, type PixelSprite } from './warrior-sprites';
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

/** Flame tongues: every column of the mask rises by a saw-tooth that is tallest in the middle. */
function flames(m: Mask, height: number, phase: number): Mask {
  const out = m.slice();
  for (let x = 0; x < W; x++) {
    let top = -1;
    for (let y = 0; y < H; y++) if (m[y * W + x]) { top = y; break; }
    if (top < 0) continue;
    const t = ((x + phase) % 7) / 7;
    const tooth = (1 - Math.abs(2 * t - 1)) ** 1.6;
    const centre = 1 - Math.min(1, Math.abs(x + OX - 48) / 44) * 0.6;
    const rise = Math.round(height * tooth * centre);
    for (let y = Math.max(0, top - rise); y < top; y++) out[y * W + x] = 1;
  }
  return out;
}

const minus = (a: Mask, b: Mask): Mask => a.map((v, i) => (v && !b[i] ? 1 : 0));

/** Cells of `m` next to a cell outside it. */
function edge(m: Mask): Mask {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const X = x + dx;
        const Y = y + dy;
        return X < 0 || X >= W || Y < 0 || Y >= H || !m[Y * W + X];
      });
      if (open) out[y * W + x] = 1;
    }
  }
  return out;
}

type AuraKind = 'gold' | 'crimson';
const AURA_COLOURS: Record<AuraKind, { ring: string; outer: string; inner: string }> = {
  gold: { ring: '#f2b400', outer: '#ffe766', inner: '#fffad6' },
  crimson: { ring: '#d8262e', outer: '#ff8a4a', inner: '#ffd98a' },
};

const auraCache = new Map<FormId, Array<{ ring: string; outer: string; inner: string }>>();
/** Two flickering frames of a flame aura around a sprite. */
function auraFrames(form: FormId, s: PixelSprite) {
  const hit = auraCache.get(form);
  if (hit) return hit;
  const m = maskOf(s);
  const frames = [0, 3].map(phase => {
    const outer = flames(grow(m, 6), 13, phase);
    const inner = flames(grow(m, 3), 6, phase + 2);
    const ring = edge(outer);
    return { ring: maskPath(ring), outer: maskPath(minus(outer, ring)), inner: maskPath(inner) };
  });
  auraCache.set(form, frames);
  return frames;
}

function Aura({ form, sprite, kind }: { form: FormId; sprite: PixelSprite; kind: AuraKind }) {
  const c = AURA_COLOURS[kind];
  return (
    <g className={styles.aura} aria-hidden="true">
      {auraFrames(form, sprite).map((f, i) => (
        <g key={i} className={i === 0 ? styles.auraA : styles.auraB}>
          <path fill={c.ring} d={f.ring} />
          <path fill={c.outer} d={f.outer} />
          <path fill={c.inner} d={f.inner} />
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

const SWEAT_AT: Record<FormId, [number, number]> = { kid: [57, 40], warrior: [57, 12], golden: [58, 13], mane: [58, 12], crimson: [60, 13], ape: [61, 9] };
const SWEAT_PALETTE = { '6': '#8fd4ff', '7': '#2f7fb8' } as const;
const sweatAt = (form: FormId): PixelSprite => ({ x: SWEAT_AT[form][0], y: SWEAT_AT[form][1], rows: SWEAT_ROWS });
const SWEAT_ROWS = ['.6.', '666', '667', '.7.'];
const SWEAT: Record<FormId, PixelSprite> = { kid: sweatAt('kid'), warrior: sweatAt('warrior'), golden: sweatAt('golden'), mane: sweatAt('mane'), crimson: sweatAt('crimson'), ape: sweatAt('ape') };

const SPARKS: Array<[number, number, string]> = [[22, 84, '0s'], [72, 78, '0.5s'], [26, 56, '0.9s'], [70, 50, '0.3s'], [18, 70, '1.3s'], [76, 64, '0.7s']];

function Sparks({ colour }: { colour: string }) {
  return (
    <g aria-hidden="true">
      {SPARKS.map(([x, y, delay]) => <path key={`${x}-${y}`} className={styles.spark} style={{ animationDelay: delay }} fill={colour} d={`M${x} ${y}h2v2h-2z`} />)}
    </g>
  );
}

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
  kid: '32 29 32 32', warrior: '31 3 34 34', golden: '30 2 36 36', mane: '30 2 36 36', crimson: '29 3 38 38', ape: '32 4 32 32',
};

function baseSprite(form: FormId, mood: WarriorMood): PixelSprite {
  if (form === 'kid') return mood === 'defeated' ? SPRITES.kidDown : SPRITES.kid;
  return SPRITES[form];
}

export function WarriorArt({ form, mood, bare = false }: { form: FormId; mood: WarriorMood; bare?: boolean }): ReactNode {
  const base = baseSprite(form, mood);
  const worried = mood === 'worried' ? PATCHES[`${form}-worried`] : null;
  const blink = mood === 'ready' && form !== 'ape' ? PATCHES[`${form}-blink`] : null;
  const aura: AuraKind | null = bare ? null : form === 'golden' || form === 'mane' ? 'gold' : form === 'crimson' ? 'crimson' : null;
  const sky = form === 'ape' && !bare;
  return (
    <>
      {sky && (
        <g aria-hidden="true">
          <Pixels sprite={SKY} palette={SKY_PALETTE} />
          <g className={styles.stars}><Pixels sprite={STARS} palette={SKY_PALETTE} /></g>
        </g>
      )}
      {aura && <Aura form={form} sprite={base} kind={aura} />}
      {!sky && <path className={styles.shadow} d={shadowPath(form)} />}
      <g className={styles.figure}>
        <path className={styles.rim} d={rimPath(base)} />
        <Pixels sprite={base} />
        {worried && <Pixels sprite={worried} />}
        {blink && <g className={styles.blink}><Pixels sprite={blink} /></g>}
        {mood === 'worried' && <g className={styles.sweat}><Pixels sprite={SWEAT[form]} palette={SWEAT_PALETTE} /></g>}
      </g>
      {aura && <Sparks colour={aura === 'gold' ? '#fff3a0' : '#ffd08a'} />}
      {aura && form === 'mane' && <Bolts />}
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
