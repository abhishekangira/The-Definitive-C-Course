// Copies @yowasp/clang's runtime files into public/toolchain/clang-<version>/ (served as static, immutable, versioned URLs).
// STRIP_CXX=1 rewrites llvm-resources.tar keeping only what C17 programs need.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pkgDir = path.resolve(path.dirname(require.resolve('@yowasp/clang')), '..'); // package has no ./package.json export
const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const src = path.join(pkgDir, 'gen');
const dst = path.resolve('public/toolchain', `clang-${version}`);
rmSync(path.resolve('public/toolchain'), { recursive: true, force: true });
mkdirSync(dst, { recursive: true });

const DROP = [
  /^include\/c\+\+\//, /^share\/libc\+\+/, /^lib\/wasm32-wasip1\/libc\+\+/, /^include\/cuda_wrappers/, /^include\/__clang_(cuda|hip)/,
  /^include\/(opencl|hlsl|ppc_wrappers|openmp_wrappers|llvm_libc_wrappers|sanitizer|profile|xray|orc|fuzzer)/,
  /^include\/[^/]*(intrin|_neon|_sve|_sme|_mve|_cde|_fp16|_bf16|altivec|vecintrin|hexagon|hvx|htm|msa|lasx|lsx|riscv|arm_|amx|avx|sse|mmintrin)[^/]*\.h$/i,
  /^lib\/wasm32-unknown-wasip1\/libclang_rt\.profile/,
];
const KEEP_ANYWAY = [/^include\/wasm_simd128\.h$/];

function stripTar(buf) {
  const out = []; let p = 0, kept = 0, dropped = 0;
  while (p + 512 <= buf.length) {
    const hdr = buf.subarray(p, p + 512);
    if (hdr.every(b => b === 0)) break;
    const name = hdr.subarray(0, 100).toString('latin1').replace(/\0.*$/s, '');
    const prefix = hdr.subarray(345, 500).toString('latin1').replace(/\0.*$/s, '');
    const full = prefix ? prefix + '/' + name : name;
    const size = parseInt(hdr.subarray(124, 136).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
    const total = 512 + Math.ceil(size / 512) * 512;
    const drop = DROP.some(r => r.test(full)) && !KEEP_ANYWAY.some(r => r.test(full));
    if (drop) dropped++; else { kept++; out.push(buf.subarray(p, p + total)); }
    p += total;
  }
  out.push(Buffer.alloc(1024));
  return { tar: Buffer.concat(out), kept, dropped };
}

let total = 0;
for (const f of readdirSync(src)) {
  if (f === 'bundle.js') continue;
  if (f === 'llvm-resources.tar' && process.env.STRIP_CXX === '1') {
    const { tar, kept, dropped } = stripTar(readFileSync(path.join(src, f)));
    writeFileSync(path.join(dst, f), tar);
    console.log(`stripped tar: kept ${kept}, dropped ${dropped}, ${statSync(path.join(src, f)).size} -> ${tar.length} bytes`);
  } else copyFileSync(path.join(src, f), path.join(dst, f));
  total += statSync(path.join(dst, f)).size;
}
// Fix the progress denominator baked into the bundle.
const bundle = readFileSync(path.join(src, 'bundle.js'), 'utf8').replace(/var totalSize = \d+;/, `var totalSize = ${total};`);
writeFileSync(path.join(dst, 'bundle.js'), bundle);
const manifest = { version, totalSize: total, files: Object.fromEntries(readdirSync(dst).map(f => [f, statSync(path.join(dst, f)).size])) };
writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(path.resolve('src/runtime/toolchain-version.json'), JSON.stringify({ version, totalSize: total }));
console.log(manifest);
