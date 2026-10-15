// Builds a project/exercise download in the browser: starter files + Makefile + check.json + check.mjs
// + learnc.h + .learner (the learner's seed, so `make test` can print progress codes the app can
// verify). Solutions never ship. The layout is shared with CI: src/testing/project-zip.ts.
import { buildZipFromFolder } from '../testing/project-zip';
import learncH from '../runtime/c/learnc.h?raw';

export interface ZipInput {
  /** Ignored (kept so existing callers compile): the folder inside the zip is named from exerciseId. */
  name?: string;
  /** The exercise id ("project/mario-more", "lt-free-list"); recorded in .learner and in every code. */
  exerciseId: string;
  title?: string;
  /** The exercise's prompt (markdown), for the generated README. */
  prompt?: string;
  /** The files the app loaded for the exercise folder (course.ts folderFiles). */
  files: Record<string, string>;
  seed: string;
}

export async function buildZip(input: ZipInput): Promise<Blob> {
  const res = await fetch('downloads/check.mjs');
  if (!res.ok) throw new Error('Could not load check.mjs (are you offline?)');
  const bytes = buildZipFromFolder({
    exerciseId: input.exerciseId, title: input.title, prompt: input.prompt, folder: input.files, seed: input.seed, checkMjs: await res.text(), learncH,
  });
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
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
