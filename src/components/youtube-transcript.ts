// The words spoken in one <YouTube> segment, from the caption excerpt committed under tools/videos/transcripts/ (PLAN.md §4.5).
// Shown under the clip, and read by the lesson chat. The segment runs from the caption that starts at `anchorStart` to the
// one that ends at `anchorEnd`, the same two anchors `npm run videos:check` verifies against these files.
import { cuesBetween, findAnchor, parseVtt } from '../../tools/videos/vtt';
import type { VideoEntry } from '../content-model/types';

const excerpts = import.meta.glob<string>('/tools/videos/transcripts/*.vtt', { query: '?raw', import: 'default' });

export interface SegmentTranscript {
  text: string;
  /** The attribution line of the excerpt ("Captions (c) …"), or "" when it has none. */
  credit: string;
}

/** Pure: the caption file's text in, the segment's words out. */
export function segmentTranscript(vtt: string, video: Pick<VideoEntry, 'start' | 'end' | 'anchorStart' | 'anchorEnd'>): SegmentTranscript {
  const cues = parseVtt(vtt);
  const first = findAnchor(cues, video.anchorStart, video.start)?.first.start ?? video.start;
  const last = findAnchor(cues, video.anchorEnd, video.end, 'end')?.last.start ?? video.end;
  const text = cuesBetween(cues, first, last).map(c => c.text).join(' ').replace(/\s+/g, ' ').trim();
  const credit = /^Captions \(c\)[^\n]*/m.exec(vtt)?.[0].trim() ?? '';
  return { text, credit };
}

export async function loadSegmentTranscript(video: VideoEntry): Promise<SegmentTranscript | null> {
  const load = excerpts[`/tools/videos/transcripts/${video.id}.vtt`];
  if (!load) return null;
  const transcript = segmentTranscript(await load(), video);
  return transcript.text ? transcript : null;
}
