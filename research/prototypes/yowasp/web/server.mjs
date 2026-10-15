// Minimal static server with request logging; optional COOP/COEP; serves precompressed .br if present and accepted.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.argv[2]; const port = +process.argv[3] || 8123; const isolate = process.env.ISOLATE === '1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.tar': 'application/x-tar' };
export const log = [];
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let p = path.join(root, decodeURIComponent(url.pathname));
  if (p.endsWith('/')) p += 'index.html';
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); console.log('404', url.pathname); return; }
  const headers = { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' };
  if (isolate) { headers['cross-origin-opener-policy'] = 'same-origin'; headers['cross-origin-embedder-policy'] = 'require-corp'; }
  let file = p;
  if ((req.headers['accept-encoding'] || '').includes('br') && fs.existsSync(p + '.br')) { file = p + '.br'; headers['content-encoding'] = 'br'; }
  headers['content-length'] = fs.statSync(file).size;
  console.log('GET', url.pathname, headers['content-encoding'] || 'identity', headers['content-length']);
  res.writeHead(200, headers); fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('listening', port));
