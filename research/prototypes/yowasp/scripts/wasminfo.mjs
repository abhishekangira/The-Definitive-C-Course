import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]);
let p = 8; const leb = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
const secs = {}; const names = ['custom','type','import','function','table','memory','global','export','start','element','code','data','datacount','tag'];
while (p < buf.length) {
  const id = buf[p++]; const size = leb(); const start = p;
  let name = names[id] || ('id' + id);
  if (id === 0) { const n = leb(); name = 'custom:' + buf.subarray(p, p + n).toString(); p += n;
    if (name === 'custom:target_features') { const cnt = leb(); const f = []; for (let i = 0; i < cnt; i++) { const pre = String.fromCharCode(buf[p++]); const l = leb(); f.push(pre + buf.subarray(p, p + l)); p += l; } console.log('target_features:', f.join(' ')); } }
  if (id === 5) { leb(); const flags = buf[p++]; const min = leb(); const max = (flags & 1) ? leb() : undefined; console.log('memory: flags', flags, 'min pages', min, 'max pages', max, flags & 2 ? '(shared)' : ''); }
  secs[name] = (secs[name] || 0) + size; p = start + size;
}
console.log(Object.entries(secs).map(([k, v]) => `${k}=${v}`).join(' '));
