import zlib from 'node:zlib'; import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const d = fs.readFileSync(f);
  const t0 = performance.now();
  const b = zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: d.length } });
  const t1 = performance.now();
  const b9 = zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  console.log(f.split('/').pop(), 'raw', d.length, 'br11', b.length, `(${((t1-t0)/1000).toFixed(1)}s)`, 'br5', b9.length);
}
