// Derive Rio's idle, defeated and worried loop patches from the original sprites.
//
// The rows in src/components/warrior-sprites.ts are the data (hand-editable). This script
// only reads the original SPRITES and the original worried/blink patches, prints the derived
// patch rows, and can paste them back with `--splice`. It never invents a colour or a shape:
// every extra frame is the original drawing with whole-pixel moves.
//
//   node tools/rio/derive-frames.mjs            print the patch object entries
//   node tools/rio/derive-frames.mjs --splice   paste them between the derived-frames markers
//   node tools/rio/derive-frames.mjs --preview out/   write a PNG contact sheet per pose
//
// What each extra frame is:
//   idle 1     head and upper torso lifted 1px. The row the lift vacates is painted back with
//              the colour that moved, so the neck and chest stay closed (a one-pixel stretch).
//   idle 2     the idle-1 patch plus a second patch that stretches a few hair or fur tips
//              1px further up. Stacking keeps the breath in the file once.
//   idle 3     the tip stretch only, on the resting body. Blink dy for the four frames is
//              0, -1, -1, 0 (IDLE_BLINK_DY): the blink patch is the resting eyes, shifted by
//              the same lift.
//   defeated 1 the kid's head droops 1px (band moves down; the collar row it covers keeps an
//              adjacent pixel of the same colour).
//   defeated 2 the defeated-1 patch plus a hair tip poked 1px to the side.
//   worried 1  the top of the hair or fur shivers 1px to the right. The face, and the sweat
//              drop that sits on it, stay put.
//   worried 2  the same tips shiver 1px to the left.
// Frame 0 of every list is the original sprite, or the sprite plus its original worried patch,
// and this script does not emit a patch for it.
//
// Gotcha: a lift that only deletes the vacated row opens a one-pixel crack wherever the body
// continued below the band. Restoring that row with the colour that moved closes it. The cut
// is the last relative row of the band, chosen so the eyes sit inside the band (the blink
// then lands on the same eye colours, one pixel higher) and the move introduces no new
// enclosed hole and no new orphan pixel.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPRITE_FILE = path.join(ROOT, 'src/components/warrior-sprites.ts');
const START = '  // --- derived frames: tools/rio/derive-frames.mjs (hand-editable) ---';
const END = '  // --- end derived frames ---';

/** Last relative row included in a breath or a droop. Eyes sit above this row. */
const CUT = { kid: 32, kidDown: 26, warrior: 32, golden: 32, mane: 32, crimson: 32, ape: 40 };
/** Hair and fur tips are taken from these top rows, above the sweat drop and the eyes. */
const TIPS = { kid: 10, kidDown: 10, warrior: 8, golden: 8, mane: 8, crimson: 8, ape: 8 };
const IDLE_DY = [0, -1, -1, 0];

const source = readFileSync(SPRITE_FILE, 'utf8');

function extractBlock(name) {
  const re = new RegExp(`^  (?:'${name}'|${name}): \\{ x: (\\d+), y: (\\d+), rows: \\[`, 'm');
  const m = re.exec(source);
  if (!m) throw new Error(`no sprite ${name}`);
  const rows = [];
  for (const line of source.slice(m.index + m[0].length).split('\n').slice(1)) {
    const rm = line.match(/^\s+'((?:[^'\\]|\\.)*)',?\s*$/);
    if (!rm) break;
    rows.push(rm[1]);
  }
  return { x: Number(m[1]), y: Number(m[2]), rows };
}

function toMap(sprite) {
  const map = new Map();
  sprite.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') map.set(`${sprite.x + i},${sprite.y + j}`, row[i]);
  });
  return map;
}

function paint(base, patches) {
  const map = toMap(base);
  for (const p of patches) {
    p.rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        const key = `${p.x + i},${p.y + j}`;
        if (ch === ' ') map.delete(key);
        else map.set(key, ch);
      }
    });
  }
  return map;
}

function cellsInRows(map, y0, y1) {
  const out = [];
  for (const [key, ch] of map) {
    const [x, y] = key.split(',').map(Number);
    if (y >= y0 && y <= y1) out.push({ x, y, ch });
  }
  return out;
}

function moved(map, cells, dx, dy) {
  const next = new Map(map);
  for (const c of cells) next.delete(`${c.x},${c.y}`);
  for (const c of cells) next.set(`${c.x + dx},${c.y + dy}`, c.ch);
  return next;
}

/** Lift rows [y0, y1] by one pixel and paint the vacated bottom row back where the body continues. */
function liftBand(map, y0, y1) {
  const cells = cellsInRows(map, y0, y1);
  const next = moved(map, cells, 0, -1);
  for (const c of cells) {
    if (c.y !== y1) continue;
    if (!map.get(`${c.x},${y1 + 1}`)) continue;
    next.set(`${c.x},${y1}`, c.ch);
  }
  return next;
}

/** Drop rows [y0, y1] by one pixel. The row below the band is covered by the band's bottom row. */
function droopBand(map, y0, y1) {
  return moved(map, cellsInRows(map, y0, y1), 0, 1);
}

/** Shift rows [y0, y1] sideways by dx. */
function shiverBand(map, y0, y1, dx) {
  return moved(map, cellsInRows(map, y0, y1), dx, 0);
}

/** Highest pixels of the hair or fur: empty above, ink below, spaced apart. */
function tipsOf(map, y0, y1) {
  const peaks = [];
  for (const [key, ch] of map) {
    const [x, y] = key.split(',').map(Number);
    if (y < y0 || y > y1) continue;
    if (map.get(`${x},${y - 1}`)) continue;
    if (!map.get(`${x},${y + 1}`)) continue;
    peaks.push({ x, y, ch });
  }
  peaks.sort((a, b) => a.y - b.y || a.x - b.x);
  const picked = [];
  for (const p of peaks) {
    if (picked.some(q => Math.abs(q.x - p.x) < 5)) continue;
    picked.push(p);
    if (picked.length === 5) break;
  }
  return picked;
}

/** Stretch those tips one pixel up into empty space. The tip pixel itself stays, so the spike does not detach. */
function stretchTips(map, sprite, relRows) {
  const next = new Map(map);
  for (const t of tipsOf(map, sprite.y, sprite.y + relRows - 1)) {
    const above = `${t.x},${t.y - 1}`;
    if (!next.has(above)) next.set(above, t.ch);
  }
  return next;
}

/** Poke the same tips one pixel to the right, into an empty cell only. */
function pokeTips(map, sprite, relRows) {
  const next = new Map(map);
  for (const t of tipsOf(map, sprite.y, sprite.y + relRows - 1)) {
    const side = `${t.x + 1},${t.y}`;
    if (!next.has(side)) next.set(side, t.ch);
  }
  return next;
}

function bounds(map) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const key of map.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function holeCount(map) {
  const { x0, y0, x1, y1 } = bounds(map);
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (map.has(`${x},${y}`)) continue;
    if (map.has(`${x - 1},${y}`) && map.has(`${x + 1},${y}`) && map.has(`${x},${y - 1}`) && map.has(`${x},${y + 1}`)) n++;
  }
  return n;
}

function orphanCount(map) {
  let n = 0;
  for (const key of map.keys()) {
    const [x, y] = key.split(',').map(Number);
    let friends = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (map.has(`${x + dx},${y + dy}`)) friends++;
    }
    if (friends === 0) n++;
  }
  return n;
}

const MOVE = 2;

function nearColour(map, x, y, ch) {
  for (let dy = -MOVE; dy <= MOVE; dy++) for (let dx = -MOVE; dx <= MOVE; dx++) {
    if (dx === 0 && dy === 0) continue;
    if (Math.abs(dx) + Math.abs(dy) > MOVE) continue;
    if (map.get(`${x + dx},${y + dy}`) === ch) return true;
  }
  return false;
}

/**
 * True when every changed pixel is a whole-pixel move of a colour the still frame already uses.
 * A breath stacks a 1px lift and a 1px tip, so a colour may travel up to MOVE pixels (Manhattan).
 */
function onlyMoves(before, after) {
  const colours = new Set(before.values());
  for (const ch of after.values()) if (!colours.has(ch)) return `new colour ${ch}`;
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    const b = before.get(key);
    const a = after.get(key);
    if (a === b) continue;
    if (a !== undefined && !nearColour(before, x, y, a)) return `added ${a} at ${x},${y} with no source within ${MOVE}px`;
    if (b !== undefined && !nearColour(after, x, y, b)) return `removed ${b} at ${x},${y} with no landing within ${MOVE}px`;
  }
  return true;
}

function problems(before, after) {
  const why = [];
  if (sameMap(before, after)) why.push('unchanged');
  const movedOk = onlyMoves(before, after);
  if (movedOk !== true) why.push(movedOk);
  if (holeCount(after) > holeCount(before)) why.push(`holes ${holeCount(before)} -> ${holeCount(after)}`);
  if (orphanCount(after) > orphanCount(before)) why.push(`orphans ${orphanCount(before)} -> ${orphanCount(after)}`);
  return why;
}

function sameMap(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Patch rows: the diff of `after` over `before`. A space erases, a dot leaves the pixel. */
function diffPatch(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const changed = new Map();
  for (const key of keys) {
    const b = before.get(key) ?? '.';
    const a = after.get(key) ?? '.';
    if (a === b) continue;
    const [x, y] = key.split(',').map(Number);
    changed.set(key, a === '.' ? ' ' : a);
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  if (changed.size === 0) return { x: 0, y: 0, rows: [] };
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    let row = '';
    for (let x = x0; x <= x1; x++) row += changed.get(`${x},${y}`) ?? '.';
    rows.push(row);
  }
  return { x: x0, y: y0, rows };
}

function emit(name, patch) {
  const body = patch.rows.map(r => `    '${r}',`).join('\n');
  return `  '${name}': { x: ${patch.x}, y: ${patch.y}, rows: [\n${body}\n  ] },`;
}

const FORMS = [
  { id: 'kid', sprite: 'kid', worried: 'kid-worried', blink: 'kid-blink' },
  { id: 'warrior', sprite: 'warrior', worried: 'warrior-worried', blink: 'warrior-blink' },
  { id: 'golden', sprite: 'golden', worried: 'golden-worried', blink: 'golden-blink' },
  { id: 'mane', sprite: 'mane', worried: 'mane-worried', blink: 'mane-blink' },
  { id: 'crimson', sprite: 'crimson', worried: 'crimson-worried', blink: 'crimson-blink' },
  { id: 'ape', sprite: 'ape', worried: 'ape-worried', blink: null },
];

const sprites = {};
for (const name of ['kid', 'kidDown', 'warrior', 'golden', 'mane', 'crimson', 'ape']) sprites[name] = extractBlock(name);
const patches = {};
for (const name of ['kid-worried', 'ape-worried', 'warrior-worried', 'golden-worried', 'mane-worried', 'crimson-worried', 'kid-blink', 'warrior-blink', 'golden-blink', 'mane-blink', 'crimson-blink']) {
  patches[name] = extractBlock(name);
}

const derived = [];
const report = [];
const frames = {};

for (const form of FORMS) {
  const sprite = sprites[form.sprite];
  const base = toMap(sprite);
  const y0 = sprite.y;
  const cut = CUT[form.id];
  const y1 = y0 + cut;
  const tips = TIPS[form.id];
  const lifted = liftBand(base, y0, y1);
  const idle = [
    base,
    lifted,
    stretchTips(lifted, sprite, tips),
    stretchTips(base, sprite, tips),
  ];
  const worriedBase = paint(sprite, [patches[form.worried]]);
  const hairEnd = y0 + tips - 1;
  const worried = [
    worriedBase,
    shiverBand(worriedBase, y0, hairEnd, 1),
    shiverBand(worriedBase, y0, hairEnd, -1),
  ];
  frames[form.id] = { idle, worried, blink: form.blink ? patches[form.blink] : null, sprite };
  // Frame 2 stacks the lift patch and a tip patch, so the breath is stored once.
  const idlePatch = [
    [1, base, idle[1]],
    [2, idle[1], idle[2]],
    [3, base, idle[3]],
  ];
  for (const [i, from, to] of idlePatch) {
    const why = problems(base, idle[i]);
    report.push(`${form.id} idle ${i}: ${why.length ? why.join('; ') : 'ok'} patch ${diffPatch(from, to).rows.join('').length}`);
    if (why.length) continue;
    derived.push(emit(`${form.id}-idle-${i}`, diffPatch(from, to)));
  }
  for (let i = 1; i < worried.length; i++) {
    const why = problems(worriedBase, worried[i]);
    report.push(`${form.id} worried ${i}: ${why.length ? why.join('; ') : 'ok'}`);
    if (why.length) continue;
    derived.push(emit(`${form.id}-worried-${i}`, diffPatch(worriedBase, worried[i])));
  }
  if (form.blink) {
    const blink = patches[form.blink];
    for (let i = 0; i < idle.length; i++) {
      const dy = IDLE_DY[i];
      blink.rows.forEach((row, j) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '.') continue;
          const ax = blink.x + x;
          const ay = blink.y + j;
          const eye = base.get(`${ax},${ay}`);
          const got = idle[i].get(`${ax},${ay + dy}`);
          if (!eye || got !== eye) report.push(`${form.id} blink frame ${i} misses ${ax},${ay} eye=${eye ?? '-'} got=${got ?? '-'} dy=${dy}`);
        }
      });
    }
  }
}

const kidDown = sprites.kidDown;
const downBase = toMap(kidDown);
const downCut = kidDown.y + CUT.kidDown;
const drooped = droopBand(downBase, kidDown.y, downCut);
const defeated = [downBase, drooped, pokeTips(drooped, kidDown, TIPS.kidDown)];
frames.kidDown = defeated;
const downPatch = [
  [1, downBase, defeated[1]],
  [2, defeated[1], defeated[2]],
];
for (const [i, from, to] of downPatch) {
  const why = problems(downBase, defeated[i]);
  report.push(`kidDown defeated ${i}: ${why.length ? why.join('; ') : 'ok'} patch ${diffPatch(from, to).rows.join('').length}`);
  if (why.length) continue;
  derived.push(emit(`kidDown-${i}`, diffPatch(from, to)));
}

const bad = report.filter(line => !line.endsWith('ok') && !line.includes(': ok'));
if (process.argv.includes('--preview')) {
  const dir = process.argv[process.argv.indexOf('--preview') + 1];
  if (!dir) throw new Error('--preview needs a directory');
  mkdirSync(dir, { recursive: true });
  writeSheets(dir);
}

if (process.argv.includes('--splice')) {
  if (bad.length) {
    console.error(report.join('\n'));
    throw new Error('refusing to splice: a derived frame failed its checks');
  }
  splice(derived.join('\n'));
  console.log(`spliced ${derived.length} patches into ${path.relative(ROOT, SPRITE_FILE)}`);
} else {
  console.log(derived.join('\n'));
}
console.error(report.join('\n'));
if (bad.length) process.exitCode = 1;

function splice(block) {
  const wrapped = `${START}\n${block}\n${END}`;
  let text = source;
  if (text.includes(START)) {
    const i = text.indexOf(START);
    const j = text.indexOf(END);
    if (j < i) throw new Error('derived-frames markers out of order');
    text = text.slice(0, i) + wrapped + text.slice(j + END.length);
  } else {
    const anchor = "} as const satisfies Record<string, PixelSprite>;";
    const at = text.lastIndexOf(anchor);
    if (at < 0) throw new Error('PATCHES closing anchor not found');
    text = text.slice(0, at) + wrapped + '\n' + text.slice(at);
  }
  writeFileSync(SPRITE_FILE, text);
}

function parsePalette() {
  const m = source.match(/export const PALETTE[^{]*\{([\s\S]*?)\n\};/);
  const pal = new Map();
  for (const line of m[1].split('\n')) {
    const rm = line.match(/'([^'])': '(#[0-9a-fA-F]{6})'/);
    if (rm) pal.set(rm[1], rm[2]);
  }
  return pal;
}

function writeSheets(dir) {
  const pal = parsePalette();
  const poses = [];
  for (const form of FORMS) {
    poses.push([`${form.id}-idle`, frames[form.id].idle, frames[form.id].blink]);
    poses.push([`${form.id}-worried`, frames[form.id].worried, null]);
  }
  poses.push(['kid-defeated', frames.kidDown, null]);
  for (const [name, list, blink] of poses) {
    const scale = 4;
    const gap = 4;
    const sample = bounds(list[0]);
    const w = sample.x1 - sample.x0 + 1;
    const h = sample.y1 - sample.y0 + 1;
    const sheetW = list.length * (w + gap) * scale;
    const sheetH = (h + 8) * scale;
    const rgba = Buffer.alloc(sheetW * sheetH * 4, 0);
    const put = (px, py, hex, alpha = 255) => {
      if (px < 0 || py < 0 || px >= sheetW || py >= sheetH) return;
      const o = (py * sheetW + px) * 4;
      rgba[o] = parseInt(hex.slice(1, 3), 16);
      rgba[o + 1] = parseInt(hex.slice(3, 5), 16);
      rgba[o + 2] = parseInt(hex.slice(5, 7), 16);
      rgba[o + 3] = alpha;
    };
    for (let py = 0; py < sheetH; py++) for (let px = 0; px < sheetW; px++) {
      const checker = ((px >> 3) + (py >> 3)) % 2 === 0;
      put(px, py, checker ? '#ff40ff' : '#202028');
    }
    list.forEach((map, i) => {
      const ox = i * (w + gap) * scale;
      for (const [key, ch] of map) {
        const [x, y] = key.split(',').map(Number);
        const hex = pal.get(ch) ?? '#ff00ff';
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(ox + (x - sample.x0) * scale + dx, (y - sample.y0) * scale + dy, hex);
      }
      if (!blink) return;
      const dyBlink = IDLE_DY[i] ?? 0;
      blink.rows.forEach((row, j) => {
        for (let k = 0; k < row.length; k++) {
          if (row[k] === '.') continue;
          const hex = pal.get(row[k]) ?? '#ff00ff';
          const x = blink.x + k;
          const y = blink.y + j + dyBlink;
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(ox + (x - sample.x0) * scale + dx, (y - sample.y0) * scale + dy, hex);
        }
      });
    });
    writeFileSync(path.join(dir, `${name}.png`), png(sheetW, sheetH, rgba));
    writeFileSync(path.join(dir, `${name}-diff.png`), diffPng(list, pal, scale));
  }
}

function diffPng(list, pal, scale) {
  const base = list[0];
  const all = bounds(base);
  for (const map of list) {
    const b = bounds(map);
    all.x0 = Math.min(all.x0, b.x0); all.y0 = Math.min(all.y0, b.y0);
    all.x1 = Math.max(all.x1, b.x1); all.y1 = Math.max(all.y1, b.y1);
  }
  const w = all.x1 - all.x0 + 1;
  const h = all.y1 - all.y0 + 1;
  const gap = 2;
  const sheetW = list.length * (w + gap) * scale;
  const sheetH = h * scale;
  const rgba = Buffer.alloc(sheetW * sheetH * 4, 0);
  const put = (px, py, hex) => {
    if (px < 0 || py < 0 || px >= sheetW || py >= sheetH) return;
    const o = (py * sheetW + px) * 4;
    rgba[o] = parseInt(hex.slice(1, 3), 16);
    rgba[o + 1] = parseInt(hex.slice(3, 5), 16);
    rgba[o + 2] = parseInt(hex.slice(5, 7), 16);
    rgba[o + 3] = 255;
  };
  list.forEach((map, i) => {
    const ox = i * (w + gap) * scale;
    for (let y = all.y0; y <= all.y1; y++) for (let x = all.x0; x <= all.x1; x++) {
      const ch = map.get(`${x},${y}`);
      const was = base.get(`${x},${y}`);
      const changed = ch !== was;
      const hex = !ch ? '#ff40ff' : changed ? (pal.get(ch) ?? '#ffffff') : '#2a2a32';
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(ox + (x - all.x0) * scale + dx, (y - all.y0) * scale + dy, hex);
    }
  });
  return png(sheetW, sheetH, rgba);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf) {
  if (!crc32.table) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  const crcTable = crc32.table;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
