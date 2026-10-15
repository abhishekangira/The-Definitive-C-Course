// Re-pack a directory into the tar layout @yowasp/runtime expects (same logic as yowasp-pack-resources).
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createTar } from 'nanotar';
const [dir, out] = process.argv.slice(2);
const entries = [];
async function walk(p) {
  const s = await stat(p); const name = p.replace(dir + '/', '');
  if (s.isDirectory()) { if (p !== dir) entries.push({ name }); for (const n of (await readdir(p)).sort()) await walk(`${p}/${n}`); }
  else entries.push({ name, data: await readFile(p) });
}
await walk(dir);
await writeFile(out, createTar(entries));
console.log(entries.length, 'entries');
