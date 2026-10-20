// Maintenance helper (run by hand, never in CI): cut the committed transcript excerpt for one entry of
// videos.json out of a full transcript downloaded with yt-dlp (command in tools/videos/README.md).
//
//   tsx tools/videos/excerpt.ts <key> <full-transcript.vtt>      e.g.  tsx tools/videos/excerpt.ts yt-1 /tmp/SlqjA04_dpk.en.vtt
//
// Writes tools/videos/transcripts/<id>.vtt: the WebVTT header, an attribution NOTE, and only the cues
// that begin between start-60 s and end+60 s. Then run `npm run videos:check`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VideoEntry } from '../../src/content-model/types';
import { makeExcerpt, formatTimestamp } from './vtt';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function attributionNote(v: VideoEntry): string {
  return [
    `Excerpt of "${v.title}" (${v.channel}, https://www.youtube.com/watch?v=${v.id}),`,
    `cues from ${formatTimestamp(v.start - 60)} to ${formatTimestamp(v.end + 60)} (segment ${formatTimestamp(v.start)} to ${formatTimestamp(v.end)} plus 60 s either side).`,
    `Captions (c) CS50, Harvard University, CC BY-NC-SA 4.0 (https://cs50.harvard.edu/x/license/).`,
    `Kept only so that tools/videos/check.ts can verify the anchor quotes offline.`,
  ].join('\n');
}

function main() {
  const [key, full] = process.argv.slice(2);
  if (!key || !full) throw new Error('usage: tsx tools/videos/excerpt.ts <key> <full-transcript.vtt>');
  const entries = JSON.parse(readFileSync(path.join(root, 'videos.json'), 'utf8')) as VideoEntry[];
  const v = entries.find(e => e.key === key);
  if (!v) throw new Error(`no entry "${key}" in videos.json (have: ${entries.map(e => e.key).join(', ')})`);
  const text = makeExcerpt(readFileSync(path.resolve(full), 'utf8'), { start: v.start, end: v.end, note: attributionNote(v) });
  const dir = path.join(root, 'tools', 'videos', 'transcripts');
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${v.id}.vtt`);
  writeFileSync(out, text);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${text.split('\n').filter(l => l.includes('-->')).length} cues)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(2); }
}
