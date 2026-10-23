// Idle, worried and defeated loops derived from the original sprites, and the blink that follows a lifted head.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FormId } from '../progress/warrior';
import {
  FORM_FRAMES, IDLE_BLINK_DY, PATCHES, SPRITES, blinkForIdle, composeFrame, type PixelSprite, type SpriteFrame,
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

describe('blink follows the head lift', () => {
  it('lands every blink pixel on the eye ink of that idle frame', () => {
    for (const form of BLINK) {
      const patch = FORM_FRAMES[form].blink!;
      const base = cells(composeFrame(FORM_FRAMES[form].idle[0]));
      FORM_FRAMES[form].idle.forEach((entry, i) => {
        const dy = IDLE_BLINK_DY[i] ?? 0;
        const placed = blinkForIdle(patch, i);
        expect(placed.y, `${form} ${i}`).toBe(patch.y + dy);
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
      const dy = IDLE_BLINK_DY[lifted] ?? 0;
      const base = cells(composeFrame(FORM_FRAMES[form].idle[0]));
      const ink = cells(composeFrame(FORM_FRAMES[form].idle[lifted]));
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
      expect(blinkForIdle(patch, lifted).y).toBe(patch.y + dy);
    }
  });
});
