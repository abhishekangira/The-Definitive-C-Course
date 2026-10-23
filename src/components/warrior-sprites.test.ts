// Idle, worried and defeated loops derived from the original sprites, and the blink that follows a lifted head.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FormId } from '../progress/warrior';
import {
  FORM_FRAMES, IDLE_BLINK_DY, PALETTE, PATCHES, SPRITES, blinkForIdle, composeFrame, crouchSprite, dabFrames, dabSprite, type PixelSprite, type SpriteFrame,
} from './warrior-sprites';

const FORMS = ['kid', 'warrior', 'golden', 'mane', 'crimson', 'ape'] as const satisfies readonly FormId[];
const BLINK = ['kid', 'warrior', 'golden', 'mane', 'crimson'] as const satisfies readonly FormId[];
const WORRIED = {
  kid: 'kid-worried', warrior: 'warrior-worried', golden: 'golden-worried',
  mane: 'mane-worried', crimson: 'crimson-worried', ape: 'ape-worried',
} as const;

/** Issue #107's stop line: double the gzip size of the original sprite file. */
const GZIP_BUDGET = 13814;
const MOVE = 2;

function cells(sprite: PixelSprite): Map<string, string> {
  const map = new Map<string, string>();
  sprite.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') map.set(`${sprite.x + i},${sprite.y + j}`, row[i]);
  });
  return map;
}

function bounds(map: Map<string, string>) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const key of map.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function holeCount(map: Map<string, string>): number {
  const { x0, y0, x1, y1 } = bounds(map);
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (map.has(`${x},${y}`)) continue;
    if (map.has(`${x - 1},${y}`) && map.has(`${x + 1},${y}`) && map.has(`${x},${y - 1}`) && map.has(`${x},${y + 1}`)) n++;
  }
  return n;
}

function orphanCount(map: Map<string, string>): number {
  let n = 0;
  for (const key of map.keys()) {
    const [x, y] = key.split(',').map(Number);
    let friends = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx !== 0 || dy !== 0) && map.has(`${x + dx},${y + dy}`)) friends++;
    }
    if (friends === 0) n++;
  }
  return n;
}

function near(map: Map<string, string>, x: number, y: number, ch: string): boolean {
  for (let dy = -MOVE; dy <= MOVE; dy++) for (let dx = -MOVE; dx <= MOVE; dx++) {
    if (dx === 0 && dy === 0) continue;
    if (Math.abs(dx) + Math.abs(dy) > MOVE) continue;
    if (map.get(`${x + dx},${y + dy}`) === ch) return true;
  }
  return false;
}

/** Every changed pixel is a whole-pixel move of a colour the still frame already uses. */
function moveProblem(before: Map<string, string>, after: Map<string, string>): string | undefined {
  const colours = new Set(before.values());
  for (const ch of after.values()) if (!colours.has(ch)) return `new colour ${ch}`;
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    const b = before.get(key);
    const a = after.get(key);
    if (a === b) continue;
    if (a !== undefined && !near(before, x, y, a)) return `added ${a} at ${x},${y}`;
    if (b !== undefined && !near(after, x, y, b)) return `removed ${b} at ${x},${y}`;
  }
  return undefined;
}

function lists(form: FormId): Array<[string, readonly SpriteFrame[]]> {
  const art = FORM_FRAMES[form];
  const out: Array<[string, readonly SpriteFrame[]]> = [['idle', art.idle]];
  if (art.worried) out.push(['worried', art.worried]);
  if (art.defeated) out.push(['defeated', art.defeated]);
  return out;
}

describe('Rio loops from the original sprites', () => {
  it('gives every form an idle of 3 or 4 frames, and worried and defeated their own loops', () => {
    for (const form of FORMS) {
      expect(FORM_FRAMES[form].idle.length, form).toBeGreaterThanOrEqual(3);
      expect(FORM_FRAMES[form].idle.length, form).toBeLessThanOrEqual(4);
      const worried = FORM_FRAMES[form].worried;
      expect(worried, form).toBeDefined();
      expect(worried!.length, form).toBeGreaterThanOrEqual(2);
      expect(worried!.length, form).toBeLessThanOrEqual(4);
    }
    const defeated = FORM_FRAMES.kid.defeated;
    expect(defeated).toBeDefined();
    expect(defeated!.length).toBeGreaterThanOrEqual(2);
    expect(defeated!.length).toBeLessThanOrEqual(4);
    expect(FORM_FRAMES.warrior.defeated).toBeUndefined();
    expect(FORM_FRAMES.ape.blink).toBeUndefined();
  });

  it('frame 0 is today\'s still drawing', () => {
    for (const form of FORMS) {
      expect(FORM_FRAMES[form].idle[0], form).toEqual({ sprite: SPRITES[form] });
      expect(FORM_FRAMES[form].worried![0], form).toEqual({ sprite: SPRITES[form], patches: [PATCHES[WORRIED[form]]] });
      expect(cells(composeFrame(FORM_FRAMES[form].idle[0])), form).toEqual(cells(SPRITES[form]));
    }
    expect(FORM_FRAMES.kid.defeated![0]).toEqual({ sprite: SPRITES.kidDown });
    expect(cells(composeFrame(FORM_FRAMES.kid.defeated![0]))).toEqual(cells(SPRITES.kidDown));
  });

  it('a derived frame only moves colours the still frame already has', () => {
    for (const form of FORMS) {
      for (const [name, list] of lists(form)) {
        const still = cells(composeFrame(list[0]));
        for (let i = 1; i < list.length; i++) {
          const got = cells(composeFrame(list[i]));
          expect(got, `${form} ${name} ${i}`).not.toEqual(still);
          expect(moveProblem(still, got), `${form} ${name} ${i}`).toBeUndefined();
          expect(holeCount(got), `${form} ${name} ${i} holes`).toBeLessThanOrEqual(holeCount(still));
          expect(orphanCount(got), `${form} ${name} ${i} orphans`).toBeLessThanOrEqual(orphanCount(still));
        }
      }
    }
  });

  it('keeps warrior-sprites.ts under the gzip budget', () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'warrior-sprites.ts');
    const gz = execFileSync('gzip', ['-9c', file]);
    expect(gz.length).toBeLessThan(GZIP_BUDGET);
    expect(readFileSync(file).length).toBeGreaterThan(0);
  });
});

/** Ink hash of every composed frame, taken before the breath became a `shift`. */
const FRAME_HASH = `
kid idle 0 6dadbb41030cac50
kid idle 1 d2fb0e798b37b0df
kid idle 2 d12ada41b9d214e6
kid idle 3 a2dc5cc6b31a2fdc
kid worried 0 e1e6747eb9da8436
kid worried 1 e711b1d0b7fd01fb
kid worried 2 df375fb59bbbc5f5
kid defeated 0 5e11c4ab4318eb68
kid defeated 1 79952729056bef83
kid defeated 2 a5e42285188f8c67
warrior idle 0 9519a3c15daed03b
warrior idle 1 63669d81262bc2ae
warrior idle 2 bfeafddc95fa13f1
warrior idle 3 ff25a79d35086cb6
warrior worried 0 a119fe37d17ddc53
warrior worried 1 b74a1a9e89cf1041
warrior worried 2 4c4d2aa33774e5b8
golden idle 0 cc48773653d89e89
golden idle 1 1bf9081b59da74c3
golden idle 2 9b804514cd046464
golden idle 3 77702df70dbe13fd
golden worried 0 416f6bf9d9ee5410
golden worried 1 e39014f4e3782ed6
golden worried 2 c6441a4ffef50207
mane idle 0 1d71764289641094
mane idle 1 8972a7a503fe54b9
mane idle 2 90ea05b152776da9
mane idle 3 00f4e9685d234990
mane worried 0 8b6cb7e3e724f067
mane worried 1 109466feb8906f98
mane worried 2 81455c617386f861
crimson idle 0 2db4a8673771ace1
crimson idle 1 77c51084878a2155
crimson idle 2 82c0fb0a4a305e20
crimson idle 3 10970ad4bfc77f4f
crimson worried 0 89aaf62e5cbf8634
crimson worried 1 5cbb05f545d90225
crimson worried 2 4f8c8e63881c0fde
ape idle 0 40abe892eadb9328
ape idle 1 e3940087694bda66
ape idle 2 5e71dcd4f2c78e78
ape idle 3 3fc3114e4ccea04d
ape worried 0 5cc584b7e65e07e9
ape worried 1 2616521bb0a75b41
ape worried 2 c26eca7561360297
`.trim().split('\n').map(line => {
  const [form, pose, index, hash] = line.split(' ');
  return { form, pose, index: Number(index), hash };
});

function inkHash(sprite: PixelSprite): string {
  const ink: string[] = [];
  sprite.rows.forEach((row, j) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') ink.push(`${sprite.x + x},${sprite.y + j},${row[x]}`);
  });
  ink.sort();
  return createHash('sha256').update(ink.join(';')).digest('hex').slice(0, 16);
}

describe('blink follows the head lift', () => {
  it('lands every blink pixel on the eye ink of that idle frame', () => {
    for (const form of BLINK) {
      const patch = FORM_FRAMES[form].blink!;
      const base = cells(composeFrame(FORM_FRAMES[form].idle[0]));
      FORM_FRAMES[form].idle.forEach((entry, i) => {
        const dy = entry.shift?.dy ?? 0;
        const placed = blinkForIdle(patch, entry);
        expect(placed.y, `${form} ${i}`).toBe(patch.y + dy);
        expect(IDLE_BLINK_DY[i], `${form} ${i}`).toBe(dy);
        expect(placed.x).toBe(patch.x);
        expect(placed.rows).toBe(patch.rows);
        const ink = cells(composeFrame(entry));
        let covered = 0;
        patch.rows.forEach((row, j) => {
          for (let x = 0; x < row.length; x++) {
            if (row[x] === '.') continue;
            const ax = patch.x + x;
            const ay = patch.y + j;
            const eye = base.get(`${ax},${ay}`);
            expect(eye, `${form} blink ${ax},${ay} covers face ink`).toBeTruthy();
            expect(ink.get(`${ax},${ay + dy}`), `${form} frame ${i} ${ax},${ay}`).toBe(eye);
            covered++;
          }
        });
        expect(covered, form).toBeGreaterThan(0);
      });
    }
  });

  it('an unshifted blink misses the eyes once the head has lifted', () => {
    const lifted = IDLE_BLINK_DY.findIndex(dy => dy !== 0);
    expect(lifted).toBeGreaterThan(0);
    for (const form of BLINK) {
      const patch = FORM_FRAMES[form].blink!;
      const entry = FORM_FRAMES[form].idle[lifted];
      const dy = entry.shift?.dy ?? 0;
      const base = cells(composeFrame(FORM_FRAMES[form].idle[0]));
      const ink = cells(composeFrame(entry));
      let misses = 0;
      patch.rows.forEach((row, j) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '.') continue;
          const ax = patch.x + x;
          const ay = patch.y + j;
          const eye = base.get(`${ax},${ay}`);
          if (eye && ink.get(`${ax},${ay + dy}`) === eye && ink.get(`${ax},${ay}`) !== eye) misses++;
        }
      });
      expect(misses, form).toBeGreaterThan(0);
      expect(blinkForIdle(patch, entry).y).toBe(patch.y + dy);
    }
  });

  it('reads the blink dy from the frame shift, so a different lift cannot drift', () => {
    const patch = FORM_FRAMES.warrior.blink!;
    const lifted = { sprite: SPRITES.warrior, shift: { top: 0, bottom: 4, dy: -3 } };
    expect(blinkForIdle(patch, lifted).y).toBe(patch.y - 3);
    expect(blinkForIdle(patch, { sprite: SPRITES.warrior }).y).toBe(patch.y);
    for (const form of FORMS) {
      FORM_FRAMES[form].idle.forEach((entry, i) => {
        expect(entry.shift?.dy ?? 0, `${form} ${i}`).toBe(IDLE_BLINK_DY[i]);
      });
    }
  });
});

describe('a shift stands in for copied rows', () => {
  it('keeps every composed frame pixel-identical to the rows it replaced', () => {
    for (const { form, pose, index, hash } of FRAME_HASH) {
      const art = FORM_FRAMES[form as FormId];
      const list = pose === 'idle' ? art.idle : pose === 'worried' ? art.worried : art.defeated;
      expect(inkHash(composeFrame(list![index])), `${form} ${pose} ${index}`).toBe(hash);
    }
  });

  it('stores the breath, droop and shiver as a shift, and the tips as patches', () => {
    for (const form of FORMS) {
      const idle = FORM_FRAMES[form].idle;
      expect(idle[1].shift, form).toMatchObject({ dy: -1, fill: true });
      expect(idle[1].patches, form).toBeUndefined();
      expect(idle[2].shift, form).toEqual(idle[1].shift);
      expect(idle[2].patches?.length, form).toBe(1);
      expect(idle[3].shift, form).toBeUndefined();
      const worried = FORM_FRAMES[form].worried!;
      expect(worried[1].shift).toMatchObject({ dx: 1 });
      expect(worried[1].shift?.dy, form).toBeUndefined();
      expect(worried[2].shift).toMatchObject({ dx: -1 });
      expect(worried[1].patches).toEqual(worried[0].patches);
    }
    const defeated = FORM_FRAMES.kid.defeated!;
    expect(defeated[1].shift).toMatchObject({ dy: 1 });
    expect(defeated[1].shift?.fill).toBeUndefined();
    expect(defeated[1].patches).toBeUndefined();
    expect(defeated[2].patches?.length).toBe(1);
  });

  it('a filled lift restores the vacated row only where the body continues', () => {
    const open = composeFrame({
      sprite: { x: 0, y: 0, rows: ['A.', '.B'] },
      shift: { top: 0, bottom: 1, dy: -1, fill: true },
    });
    expect(cells(open).get('0,-1')).toBe('A');
    expect(cells(open).has('0,0')).toBe(false);
    const closed = composeFrame({
      sprite: { x: 0, y: 0, rows: ['A', 'B'] },
      shift: { top: 0, bottom: 1, dy: -1, fill: true },
    });
    expect(cells(closed).get('0,-1')).toBe('A');
    expect(cells(closed).get('0,0')).toBe('A');
    expect(cells(closed).get('0,1')).toBe('B');
  });
});

describe('the perfect-lesson dab re-poses the original pixels', () => {
  const cells = (s: PixelSprite) => {
    const out = new Map<string, string>();
    s.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') out.set(`${s.x + i},${s.y + j}`, ch); }));
    return out;
  };
  const histogram = (m: Map<string, string>) => {
    const h = new Map<string, number>();
    for (const ch of m.values()) h.set(ch, (h.get(ch) ?? 0) + 1);
    return h;
  };
  it.each(FORMS)('%s: every dab cell is a colour that frame already had, in no greater number, inside the mask grid', form => {
    const standing = composeFrame(FORM_FRAMES[form].idle[0]);
    const dab = dabSprite(form, standing);
    const before = histogram(cells(standing)); const after = histogram(cells(dab));
    for (const [ch, n] of after) {
      expect(PALETTE[ch as keyof typeof PALETTE], ch).toBeDefined();
      expect(n, `${form} ${ch}`).toBeLessThanOrEqual(before.get(ch) ?? 0);
    }
    // Moving parts cover each other, and hair that only hung beside an arm is pruned (mane, crimson), never most of the figure.
    const total = (h: Map<string, number>) => [...h.values()].reduce((a, b) => a + b, 0);
    expect(total(after)).toBeGreaterThan(total(before) * 0.75);
    for (const k of cells(dab).keys()) {
      const [x, y] = k.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(-8); expect(x).toBeLessThan(104);
      expect(y).toBeGreaterThanOrEqual(-14); expect(y).toBeLessThan(98);
    }
    expect(dab.rows).not.toEqual(standing.rows);
    expect(dabSprite(form, standing)).toBe(dab);
  });
  it.each(FORMS)('%s: the loop is stand, wind-up (the crouch), the dab hold, back (the dab crouched)', form => {
    const [stand, windUp, hold, back] = dabFrames(form);
    const standing = composeFrame(FORM_FRAMES[form].idle[0]);
    expect(stand.rows).toEqual(standing.rows);
    expect(windUp).toBe(crouchSprite(form, standing));
    expect(hold).toBe(dabSprite(form, standing));
    expect(back).toBe(crouchSprite(form, hold));
  });
});
