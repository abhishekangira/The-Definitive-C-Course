// Tiny static server that mimics GitHub Pages (gzip, ETag, max-age=600, application/wasm) and can add COOP/COEP.
// usage: node serve.mjs <distDir> <port> <mountPath> [--coi] [--throttle=MBps]
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
const [dir0, port, mount] = process.argv.slice(2); const dir = path.resolve(dir0);
const coi = process.argv.includes('--coi');
const throttle = Number((process.argv.find(a => a.startsWith('--throttle=')) || '=0').split('=')[1]); // MB/s, 0 = off
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.tar': 'application/x-tar', '.c': 'text/plain', '.css': 'text/css' };
const gzCache = new Map();
const log = [];
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(log)); return; }
  if (url.pathname === '/__clearlog') { log.length = 0; res.end('ok'); return; }
  if (!url.pathname.startsWith(mount)) { res.writeHead(404); res.end(); return; }
  let rel = url.pathname.slice(mount.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(dir, rel);
  if (!file.startsWith(path.resolve(dir)) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); log.push([req.method, url.pathname, 404]); return; }
  const ext = path.extname(file);
  const st = statSync(file);
  const etag = `"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'max-age=600', etag };
  if (coi) Object.assign(headers, { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' });
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); log.push([req.method, url.pathname, 304, 0]); return; }
  let body = readFileSync(file);
  if (/gzip/.test(req.headers['accept-encoding'] || '') && ext !== '.png') {
    const key = file + st.mtimeMs; if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(body, { level: 6 }));
    body = gzCache.get(key); headers['content-encoding'] = 'gzip';
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  log.push([req.method, url.pathname, 200, body.length]);
  if (!throttle) { res.end(body); return; }
  const chunk = 64 * 1024, perTick = throttle * 1e6 / 20; let off = 0;
  const iv = setInterval(() => { const end = Math.min(off + perTick, body.length); res.write(body.subarray(off, end)); off = end; if (off >= body.length) { clearInterval(iv); res.end(); } }, 50);
}).listen(+port, () => console.log(`serving ${dir} at http://localhost:${port}${mount} coi=${coi}`));
