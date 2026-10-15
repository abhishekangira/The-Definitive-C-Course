import { readFileSync } from 'node:fs';
const b = readFileSync(process.argv[2]);
let p = 8; const names = ['custom','type','import','function','table','memory','global','export','start','element','code','data','datacount','tag'];
function leb() { let r = 0, s = 0, x; do { x = b[p++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return r; }
while (p < b.length) { const id = b[p++]; const size = leb(); const start = p; let nm = names[id] || id;
  if (id === 0) { const l = leb(); nm += ':' + b.subarray(p, p + l).toString(); }
  console.log(nm.padEnd(30), size.toLocaleString()); p = start + size; }
