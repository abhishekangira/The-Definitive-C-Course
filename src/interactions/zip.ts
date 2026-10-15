// Builds a project/exercise download in the browser: starter files + check.mjs + learnc.h + .learner
// (the learner's seed, so `make test` can print progress codes the app can verify). Solutions never ship.
import { zipSync, strToU8 } from 'fflate';
import learncH from '../runtime/c/learnc.h?raw';

export interface ZipInput {
  /** Folder name inside the zip, e.g. "mario-more". */
  name: string;
  /** Files from the content folder (relative paths). "starter/x.c" is placed at the root as "x.c". */
  files: Record<string, string>;
  exerciseId: string;
  seed: string;
}

const EXCLUDE = /^(solution\/|solution\.c$|variants\/|exercise\.yaml$|project\.mdx$)/;

export async function buildZip(input: ZipInput): Promise<Blob> {
  const out: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(input.files)) {
    if (EXCLUDE.test(path)) continue;
    const dest = path.startsWith('starter/') ? path.slice('starter/'.length) : path === 'starter.c' ? 'main.c' : path;
    out[`${input.name}/${dest}`] = strToU8(text);
  }
  if (input.files['tests.json'] && !input.files['check.json']) out[`${input.name}/check.json`] = strToU8(input.files['tests.json']);
  out[`${input.name}/learnc.h`] = strToU8(learncH);
  out[`${input.name}/.learner`] = strToU8(JSON.stringify({ seed: input.seed, exercise: input.exerciseId }, null, 2) + '\n');
  const check = await fetch('downloads/check.mjs').then(r => (r.ok ? r.text() : null)).catch(() => null);
  if (check) out[`${input.name}/check.mjs`] = strToU8(check);
  const zipped = zipSync(out, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
