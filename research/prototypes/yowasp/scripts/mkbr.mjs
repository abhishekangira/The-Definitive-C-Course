import zlib from 'node:zlib'; import fs from 'node:fs';
for (const f of process.argv.slice(2)) { const d = fs.readFileSync(f); const t = performance.now();
  const b = zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: +(process.env.Q || 5), [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: d.length } });
  fs.writeFileSync(f + '.br', b); console.log(f, d.length, '->', b.length, ((performance.now()-t)/1000).toFixed(1) + 's'); }
