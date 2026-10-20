import { describe, expect, it } from 'vitest';
import videos from '../../videos.json';
import type { VideoEntry } from '../content-model/types';
import { words } from '../../tools/videos/vtt';
import { loadSegmentTranscript, segmentTranscript } from './youtube-transcript';

const entries = videos as VideoEntry[];

describe('the transcript of a YouTube segment', () => {
  it.each(entries.map(v => [v.key, v] as const))('%s: runs from its start anchor to its end anchor, inside the padding of the excerpt', async (_key, video) => {
    const t = await loadSegmentTranscript(video);
    expect(t).not.toBeNull();
    const spoken = words(t!.text);
    const start = words(video.anchorStart.replace(/^[\s.…]+|[\s.…]+$/g, ''));
    const end = words(video.anchorEnd.replace(/^[\s.…]+|[\s.…]+$/g, ''));
    expect(spoken.slice(0, start.length), 'begins with the start anchor').toEqual(start);
    expect(spoken.slice(-end.length), 'ends with the end anchor').toEqual(end);
    // Three minutes of speech, not the 60 s of padding either side (the excerpt is about 5 minutes).
    expect(spoken.length).toBeGreaterThan(200);
    expect(t!.credit).toMatch(/^Captions \(c\)/);
  });

  it('leaves out the padding the excerpt keeps either side', async () => {
    const t = await loadSegmentTranscript(entries[0]);
    expect(t!.text).not.toContain('kick the can down the road');
  });

  it('cuts at the anchors of a small made-up file, and finds no credit when there is none', () => {
    const vtt = [
      'WEBVTT', '',
      '00:00:08.000 --> 00:00:09.000', 'before the clip', '',
      '00:00:10.000 --> 00:00:12.000', 'The clip begins', '',
      '00:00:12.000 --> 00:00:14.000', 'and goes on,', '',
      '00:00:14.000 --> 00:00:16.000', 'then it ends.', '',
      '00:00:20.000 --> 00:00:22.000', 'after the clip', '',
    ].join('\n');
    expect(segmentTranscript(vtt, { start: 10, end: 16, anchorStart: 'The clip begins', anchorEnd: 'then it ends' })).toEqual({ text: 'The clip begins and goes on, then it ends.', credit: '' });
  });
});
