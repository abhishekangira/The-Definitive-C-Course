// Copies @yowasp/clang's runtime files into public/toolchain/clang-<version>/ (served as static,
// immutable, versioned URLs) with a C-only sysroot, and writes src/generated/toolchain-version.json.
// tools/verify loads the *same* copy in Node, so CI tests exactly what ships.
// Skips work when the target already matches the installed package version.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const pkgDir = path.resolve(path.dirname(require.resolve('@yowasp/clang')), '..'); // package has no ./package.json export
const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const src = path.join(pkgDir, 'gen');
const outRoot = path.join(root, 'public/toolchain');
const dst = path.join(outRoot, `clang-${version}`);
const versionFile = path.join(root, 'src/generated/toolchain-version.json');

if (existsSync(path.join(dst, 'manifest.json')) && existsSync(versionFile) && !process.argv.includes('--force')) {
  const m = JSON.parse(readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
  if (m.version === version) process.exit(0);
}

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });

// Everything a C17 program does not need: C++ headers/libs, GPU/HLSL/OpenCL, other architectures' intrinsics.
const DROP = [
  /^include\/c\+\+\//, /^share\/libc\+\+/, /^lib\/wasm32-wasip1\/libc\+\+/, /^include\/cuda_wrappers/, /^include\/__clang_(cuda|hip)/,
  /^include\/(opencl|hlsl|ppc_wrappers|openmp_wrappers|llvm_libc_wrappers|sanitizer|profile|xray|orc|fuzzer)/,
  /^include\/[^/]*(intrin|_neon|_sve|_sme|_mve|_cde|_fp16|_bf16|altivec|vecintrin|hexagon|hvx|htm|msa|lasx|lsx|riscv|arm_|amx|avx|sse|mmintrin)[^/]*\.h$/i,
  /^lib\/wasm32-unknown-wasip1\/libclang_rt\.profile/,
];
const KEEP_ANYWAY = [/^include\/wasm_simd128\.h$/];

function stripTar(buf) {
  const out = [];
  let p = 0, kept = 0, dropped = 0;
  while (p + 512 <= buf.length) {
    const hdr = buf.subarray(p, p + 512);
    if (hdr.every(b => b === 0)) break;
    const name = hdr.subarray(0, 100).toString('latin1').replace(/\0.*$/s, '');
    const prefix = hdr.subarray(345, 500).toString('latin1').replace(/\0.*$/s, '');
    const full = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(hdr.subarray(124, 136).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
    const total = 512 + Math.ceil(size / 512) * 512;
    const drop = DROP.some(r => r.test(full)) && !KEEP_ANYWAY.some(r => r.test(full));
    if (drop) dropped++;
    else { kept++; out.push(buf.subarray(p, p + total)); }
    p += total;
  }
  out.push(Buffer.alloc(1024));
  return { tar: Buffer.concat(out), kept, dropped };
}

let total = 0;
for (const f of readdirSync(src)) {
  if (f === 'bundle.js') continue;
  if (f === 'llvm-resources.tar') {
    const { tar, kept, dropped } = stripTar(readFileSync(path.join(src, f)));
    writeFileSync(path.join(dst, f), tar);
    console.log(`toolchain: C-only sysroot kept ${kept} entries, dropped ${dropped}`);
  } else copyFileSync(path.join(src, f), path.join(dst, f));
  total += statSync(path.join(dst, f)).size;
}
// The bundle hard-codes the download size for progress reporting; fix it for the slimmed files.
const bundle = readFileSync(path.join(src, 'bundle.js'), 'utf8');
const patched = bundle.replace(/var totalSize = \d+;/, `var totalSize = ${total};`);
if (patched === bundle) throw new Error('toolchain: could not patch totalSize in bundle.js (package changed?)');
writeFileSync(path.join(dst, 'bundle.js'), patched);
const files = Object.fromEntries(readdirSync(dst).map(f => [f, statSync(path.join(dst, f)).size]));
writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify({ version, totalSize: total, files }, null, 2));
mkdirSync(path.dirname(versionFile), { recursive: true });
writeFileSync(versionFile, JSON.stringify({ version, totalSize: total }) + '\n');
console.log(`toolchain: clang-${version} → public/toolchain (${(total / 1e6).toFixed(1)} MB uncompressed)`);
