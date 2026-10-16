// Safe unpacker for the `regenerated` artifact that the CI `check` job (which runs PR-authored code) hands to the
// write-token `commit-generated` job. Treat the tarball as hostile: parse the ustar headers ourselves, accept only
// regular files whose path is strictly under src/generated/{samples,traces}/, and write them with fixed modes into a
// clean directory. Nothing is extracted until every member has passed. No dependency except node: builtins, because
// the job runs it before any `npm ci`.
//
//   node tools/ci/unpack-generated.mjs <files.tar> <empty-or-missing destination dir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FILES = 200;
export const MAX_BYTES = 64 * 1024 * 1024;
// Each segment: plain characters, never "." or ".." (checked separately). No backslash, no NUL, no leading "./", no absolute path.
const PATH_RE = /^src\/generated\/(?:samples|traces)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function str(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul < 0 ? len : nul).toString('latin1');
}

function octal(buf, off, len, what) {
  // A leading high bit means GNU base-256 encoding: refuse rather than interpret.
  if (buf[off] & 0x80) throw new Error(`unsupported ${what} encoding`);
  const s = str(buf, off, len).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error(`bad ${what} field`);
  return s === '' ? 0 : parseInt(s, 8);
}

/** Reject anything that is not an acceptable member path; returns the reason or null. */
export function pathProblem(name) {
  if (!PATH_RE.test(name)) return 'path is not strictly under src/generated/{samples,traces}/ or has forbidden characters';
  if (name.split('/').some(seg => seg === '.' || seg === '..')) return 'path has a "." or ".." segment';
  return null;
}

/**
 * Parse and validate a tar archive. Returns [{ name, data }] or throws with the reason.
 * Accepts only typeflag '0' (or NUL) regular files; symlinks, hardlinks, devices, FIFOs, directories, and
 * pax/GNU extension headers (which can rename members) are all refused.
 */
export function parseGeneratedTar(tar) {
  const members = [];
  const seen = new Set();
  let total = 0;
  let off = 0;
  for (;;) {
    if (off + 512 > tar.length) throw new Error('truncated archive (no end-of-archive marker)');
    const h = tar.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    // Header checksum: sum of all bytes with the checksum field read as spaces.
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (octal(h, 148, 8, 'checksum') !== sum) throw new Error('bad header checksum');
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h, 345, 155);
    const name = prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100);
    if (type !== '0') throw new Error(`member ${JSON.stringify(name)}: type ${JSON.stringify(type)} is not a regular file`);
    const bad = pathProblem(name);
    if (bad) throw new Error(`member ${JSON.stringify(name)}: ${bad}`);
    if (seen.has(name)) throw new Error(`member ${JSON.stringify(name)} appears twice`);
    seen.add(name);
    if (str(h, 157, 100) !== '') throw new Error(`member ${JSON.stringify(name)} has a link target`);
    const size = octal(h, 124, 12, 'size');
    total += size;
    if (members.length + 1 > MAX_FILES || total > MAX_BYTES) throw new Error('archive too large');
    const start = off + 512;
    if (start + size > tar.length) throw new Error('truncated member data');
    members.push({ name, data: tar.subarray(start, start + size) });
    off = start + Math.ceil(size / 512) * 512;
  }
  if (!members.length) throw new Error('archive has no members');
  return members;
}

/** Validate, then write every member into `dest` (must be empty or absent) as a regular 0644 file. */
export function unpackGenerated(tarPath, dest) {
  const members = parseGeneratedTar(readFileSync(tarPath));
  const root = path.resolve(dest);
  try {
    if (readdirSync(root).length) throw new Error(`destination ${dest} is not empty`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  for (const m of members) {
    const target = path.join(root, m.name);
    if (!target.startsWith(root + path.sep)) throw new Error(`member ${m.name} escapes the destination`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, m.data, { mode: 0o644, flag: 'wx' });
  }
  return members.map(m => m.name);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [tarPath, dest] = process.argv.slice(2);
  if (!tarPath || !dest) { console.error('usage: unpack-generated.mjs <files.tar> <dest>'); process.exit(2); }
  try {
    for (const n of unpackGenerated(tarPath, dest)) console.log(`ok ${n}`);
  } catch (e) {
    console.error(`Refusing the artifact: ${e.message}`);
    process.exit(1);
  }
}
