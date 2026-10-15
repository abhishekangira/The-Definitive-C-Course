import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { VideoEntry } from '../../src/content-model/types';
import { checkVideoFiles, parseArgs, ROOT } from './check';
import { attributionNote } from './excerpt';
import {
  checkOnline, describeSegment, embedUrl, oembedUrl, validateVideos, type VideoMessage,
} from './validate';
import { cuesBetween, findAnchor, formatTimestamp, makeExcerpt, parseTimestamp, parseVtt, words } from './vtt';

// ---- helpers ---------------------------------------------------------------------------------

type CueSpec = [start: number, end: number, text: string];

function vtt(cues: CueSpec[], extra = ''): string {
  const body = cues.map(([s, e, t]) => `${formatTimestamp(s)} --> ${formatTimestamp(e)}\n${t}\n`).join('\n');
  return `WEBVTT\nKind: captions\nLanguage: en\n\n${extra}${body}`;
}

/** A transcript with one cue every 4 s from 940 s to 1260 s, plus the two anchor sentences. */
function transcript(): string {
  const cues: CueSpec[] = [];
  for (let t = 940; t < 1260; t += 4) cues.push([t, t + 3.5, `filler words number ${t}`]);
  const at = (t: number, text: string) => {
    const i = cues.findIndex(c => c[0] >= t);
    cues[i] = [cues[i][0], cues[i][1], text];
  };
  at(1000, 'So here is where, we begin.');
  at(1192, 'And that is the end of it.');
  return vtt(cues);
}

const entry = (over: Partial<VideoEntry> = {}): VideoEntry => ({
  key: 'yt-t',
  id: 'abcdefghijk',
  title: 'A Lecture',
  channel: 'Somebody',
  module: 'm02',
  lesson: '2.6',
  start: 1000,
  end: 1196,
  anchorStart: 'So here is where we begin',
  anchorEnd: 'And that is the end of it.',
  why: 'Because it is good.',
  verifiedAt: '2026-10-15',
  ...over,
});

const errors = (m: VideoMessage[]) => m.filter(x => x.severity === 'error').map(x => x.message);
const warnings = (m: VideoMessage[]) => m.filter(x => x.severity === 'warning').map(x => x.message);
/** `text: null` simulates a missing transcript file. */
const validate = (data: unknown, text: string | null = transcript()) => validateVideos(data, () => text ?? undefined);

// ---- vtt ---------------------------------------------------------------------------------------

describe('vtt', () => {
  it('parses and formats timestamps', () => {
    expect(parseTimestamp('01:02:03.500')).toBe(3723.5);
    expect(parseTimestamp('02:03.250')).toBe(123.25);
    expect(parseTimestamp('00:00:01,5'.replace(',5', ',500'))).toBe(1.5);
    expect(formatTimestamp(8531.69)).toBe('02:22:11.690');
    expect(formatTimestamp(59.9996)).toBe('00:01:00.000');
  });

  it('parses cues, strips inline tags and entities, and skips NOTE/STYLE blocks', () => {
    const text = [
      'WEBVTT', 'Kind: captions', '', 'NOTE', 'attribution --> not a cue? no, this has an arrow: 00:00:01.000 --> 00:00:02.000', '',
      'STYLE', '::cue { color: red }', '',
      '1', '00:00:01.000 --> 00:00:02.500 align:start position:0%', '<c.colorE5E5E5>Tom &amp; Jerry</c><00:00:02.000><c> it&#39;s</c>', 'second line', '',
      '00:01:00.000 --> 00:01:01.000', '   ', '',
      '01:00:00.000 --> 01:00:01.000', 'late', '',
    ].join('\n');
    const cues = parseVtt(text);
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: "Tom & Jerry it's second line" },
      { start: 3600, end: 3601, text: 'late' },
    ]);
  });

  it('handles CRLF line endings and a BOM', () => {
    expect(parseVtt('﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nhello\r\n')).toHaveLength(1);
  });

  it('keeps cues that begin inside a window', () => {
    const cues = parseVtt(vtt([[10, 12, 'a'], [20, 22, 'b'], [30, 32, 'c']]));
    expect(cuesBetween(cues, 15, 30).map(c => c.text)).toEqual(['b', 'c']);
  });

  it('normalises words', () => {
    expect(words("Hey, Binky's “pointer” fun! 787")).toEqual(['hey', 'binkys', 'pointer', 'fun', '787']);
    expect(words('Café')).toEqual(['cafe']);
  });

  describe('findAnchor', () => {
    const cues = parseVtt(vtt([
      [0, 2, 'So that too was a problem,'],
      [2, 4, 'and this happens truly in the real world.'],
      [4, 6, 'So picture here is a Boeing 787'],
      [100, 102, 'So that too was a problem,'],
      [102, 104, 'and this happens again.'],
    ]));

    it('matches across cue breaks, ignoring case and punctuation', () => {
      const m = findAnchor(cues, 'so that too was a problem and this happens truly in the real world');
      expect(m?.first.start).toBe(0);
      expect(m?.last.end).toBe(4);
    });

    it('drops leading and trailing ellipses', () => {
      expect(findAnchor(cues, '… this happens truly in the real world…')?.first.start).toBe(2);
      expect(findAnchor(cues, '... Boeing 787 ...')?.last.end).toBe(6);
    });

    it('prefers the match nearest to the requested time', () => {
      expect(findAnchor(cues, 'So that too was a problem', 99, 'start')?.first.start).toBe(100);
      expect(findAnchor(cues, 'So that too was a problem', 1, 'start')?.first.start).toBe(0);
      expect(findAnchor(cues, 'So that too was a problem', 5, 'end')?.last.end).toBe(2);
    });

    it('returns null for text that is not there, or empty', () => {
      expect(findAnchor(cues, 'a Boeing 747')).toBeNull();
      expect(findAnchor(cues, '...')).toBeNull();
    });
  });

  it('makeExcerpt keeps the header, a NOTE and only the cues in the window', () => {
    const full = vtt([[10, 12, 'too early'], [45, 47, 'in'], [100, 102, 'segment'], [165, 167, 'out'], [200, 202, 'too late']]);
    const out = makeExcerpt(full, { start: 100, end: 110, pad: 60, note: 'Attribution line one\nline two' });
    expect(out.startsWith('WEBVTT\nKind: captions\nLanguage: en\n\nNOTE\nAttribution line one\nline two\n\n')).toBe(true);
    expect(parseVtt(out).map(c => c.text)).toEqual(['in', 'segment', 'out']);
    expect(() => makeExcerpt(full, { start: 5000, end: 5100, note: 'x' })).toThrow(/no cues/);
  });

  it('attributionNote names the video and the licence', () => {
    const note = attributionNote(entry({ start: 1000, end: 1196 }));
    expect(note).toContain('CS50');
    expect(note).toContain('CC BY-NC-SA 4.0');
    expect(note).toContain('abcdefghijk');
    // the NOTE must not contain a blank line (it would end the block)
    expect(note).not.toMatch(/\n\n/);
  });
});

// ---- validateVideos ------------------------------------------------------------------------

describe('validateVideos', () => {
  it('accepts a good entry and a good transcript', () => {
    expect(validate([entry()])).toEqual([]);
  });

  it('describes and embeds a segment', () => {
    expect(describeSegment({ start: 8531, end: 8699 })).toBe('8531-8699 s (2:48)');
    expect(embedUrl({ id: 'SlqjA04_dpk', start: 8531, end: 8699 })).toBe('https://www.youtube-nocookie.com/embed/SlqjA04_dpk?start=8531&end=8699&rel=0');
    expect(embedUrl({ id: 'x', start: 1, end: 2 }, '&autoplay=1')).toMatch(/&rel=0&autoplay=1$/);
  });

  it('requires an array', () => {
    expect(errors(validate({}))).toEqual(['videos.json must be an array of entries']);
    expect(errors(validate('x'))).toHaveLength(1);
  });

  it('checks the shape of each entry', () => {
    const bad = errors(validate([
      { ...entry(), extra: 1 },
      { ...entry({ key: 'yt-b' }), title: '' },
      { ...entry({ key: 'yt-c' }), start: 1000.5 },
      { ...entry({ key: 'yt-d' }), end: '1196' },
      { ...entry({ key: 'Yt D' }) },
      { ...entry({ key: 'yt-e', id: 'short' }) },
      { ...entry({ key: 'yt-f', module: 'module2' }) },
      { ...entry({ key: 'yt-g', verifiedAt: '2026-13-40' }) },
      { ...entry({ key: 'yt-h', start: 1196, end: 1000 }) },
      42,
    ]));
    expect(bad).toEqual(expect.arrayContaining([
      expect.stringContaining('unknown field "extra"'),
      expect.stringContaining('"title" must be a non-empty string'),
      expect.stringContaining('"start" must be a whole number of seconds'),
      expect.stringContaining('"end" must be a whole number of seconds'),
      expect.stringContaining('must be lower-case kebab-case'),
      expect.stringContaining('not an 11-character YouTube video id'),
      expect.stringContaining('module "module2" must look like'),
      expect.stringContaining('verifiedAt "2026-13-40" must be a date'),
      expect.stringContaining('start (1196) must be before end (1000)'),
      'entry must be an object',
    ]));
  });

  it('rejects duplicate keys', () => {
    const bad = errors(validate([entry(), entry({ module: 'm03' })]));
    expect(bad).toEqual([expect.stringContaining('duplicate key "yt-t"')]);
  });

  it('allows at most 2 segments per module', () => {
    const three = [entry({ key: 'a' }), entry({ key: 'b' }), entry({ key: 'c' })];
    expect(errors(validate(three))).toEqual([expect.stringContaining('module m02 has 3 segments (a, b, c); the limit is 2')]);
    expect(errors(validate(three.slice(0, 2)))).toEqual([]);
    // different modules do not add up
    expect(errors(validate([entry({ key: 'a' }), entry({ key: 'b', module: 'm03' }), entry({ key: 'c', module: 'm04' })]))).toEqual([]);
  });

  it('keeps segments 30-480 s long', () => {
    const short = validate([entry({ start: 1000, end: 1020, anchorEnd: 'filler words number 1016' })]);
    expect(errors(short)).toEqual(expect.arrayContaining([expect.stringContaining('20 s long; it must be 30-480 s')]));
    const long = validate([entry({ start: 1000, end: 1500 })]);
    expect(errors(long)).toEqual(expect.arrayContaining([expect.stringContaining('500 s long')]));
    // exactly at the bounds is fine: only the segment-length rule is under test here
    const ok = validateVideos([entry({ start: 1000, end: 1030 })], () => transcript());
    expect(errors(ok).filter(m => /s long/.test(m))).toEqual([]);
    expect(warnings(validate([entry({ start: 1000, end: 1400 })])).some(w => /about 2-6 minutes/.test(w))).toBe(true);
  });

  it('needs a transcript excerpt', () => {
    expect(errors(validate([entry()], null))).toEqual([expect.stringContaining('no transcript excerpt: tools/videos/transcripts/abcdefghijk.vtt')]);
    expect(errors(validate([entry()], 'WEBVTT\n\n'))).toEqual(['transcript excerpt has no cues']);
  });

  it('finds the anchors in the excerpt, within 3 s of the boundaries', () => {
    expect(errors(validate([entry({ anchorStart: 'this sentence is not spoken' })]))).toEqual([
      'anchorStart not found in the transcript excerpt: "this sentence is not spoken"',
    ]);
    expect(errors(validate([entry({ anchorEnd: 'neither is this one' })]))).toEqual([
      'anchorEnd not found in the transcript excerpt: "neither is this one"',
    ]);
    // the quote exists, but 40 s away from `start`
    const far = entry({ anchorStart: 'filler words number 1040' });
    expect(errors(validate([far]))).toEqual([expect.stringMatching(/anchorStart is at 1040\.0 s, 40\.0 s after start \(1000\); allowed ±3 s/)]);
    const farEnd = entry({ anchorEnd: 'filler words number 1100' });
    expect(errors(validate([farEnd]))).toEqual([expect.stringMatching(/anchorEnd ends at 1103\.5 s, 92\.5 s before end \(1196\)/)]);
  });

  it('accepts anchors exactly 3 s from the boundaries and rejects anything further', () => {
    const t = (startCue: number, endCueEnd: number) => vtt([
      [940, 945, 'lead in'], [startCue, startCue + 3, 'start here please'], [1100, 1110, 'the middle'],
      [endCueEnd - 8, endCueEnd, 'the very end'], [1250, 1255, 'after']]);
    const e = entry({ start: 1000, end: 1196, anchorStart: 'start here please', anchorEnd: 'the very end' });
    // 3.0 s after start and 3.0 s after end: still fine
    expect(errors(validateVideos([e], () => t(1003, 1199)))).toEqual([]);
    // 3.5 s after start
    expect(errors(validateVideos([e], () => t(1003.5, 1199)))).toEqual([expect.stringContaining('anchorStart is at 1003.5 s, 3.5 s after start (1000)')]);
    // 3.5 s after end
    expect(errors(validateVideos([e], () => t(1003, 1199.5)))).toEqual([expect.stringContaining('anchorEnd ends at 1199.5 s, 3.5 s after end (1196)')]);
    // 3.5 s before start (the cue begins early) and 3.5 s before end
    expect(errors(validateVideos([e], () => t(996.5, 1199)))).toEqual([expect.stringContaining('3.5 s before start (1000)')]);
    expect(errors(validateVideos([e], () => t(1003, 1192.5)))).toEqual([expect.stringContaining('3.5 s before end (1196)')]);
  });

  it('warns when a boundary cuts through its anchor cue', () => {
    // anchorEnd's cue ends at 1195.5 + ... -> make end earlier than the cue's end by > 0.5 s
    const cut = validate([entry({ end: 1194 })]);
    expect(errors(cut)).toEqual([]);
    expect(warnings(cut)).toEqual([expect.stringMatching(/end \(1194\) is 1\.\d s before the last anchor cue finishes .* suggest end=\d+/)]);
    const late = validate([entry({ start: 1002 })]);
    expect(warnings(late)).toEqual([expect.stringMatching(/start \(1002\) is 2\.0 s into the first anchor cue .* suggest start=1000/)]);
    // within half a second is fine
    expect(warnings(validate([entry({ end: 1196 })]))).toEqual([]);
  });

  it('requires the excerpt to cover the segment, and warns when the padding is short', () => {
    const uncovered = vtt([[1010, 1014, 'So here is where, we begin.'], [1192, 1195.5, 'And that is the end of it.']]);
    expect(errors(validate([entry()], uncovered))).toEqual(expect.arrayContaining([expect.stringContaining('does not cover the segment (1000-1196 s)')]));
    const shortEnd = vtt([[1000, 1004, 'So here is where, we begin.'], [1190, 1192, 'And that is the end of it.']]);
    expect(errors(validate([entry()], shortEnd))).toEqual(expect.arrayContaining([expect.stringContaining('does not cover the segment')]));
    const tight = vtt([[1000, 1004, 'So here is where, we begin.'], [1192, 1195.5, 'And that is the end of it.']]);
    expect(errors(validate([entry()], tight))).toEqual([]);
    expect(warnings(validate([entry()], tight))).toEqual([
      expect.stringContaining('transcript excerpt starts 0 s before the segment; keep 60 s'),
      expect.stringContaining('transcript excerpt ends 0 s after the segment; keep 60 s'),
    ]);
  });

  it('errors when the end anchor comes before the start anchor', () => {
    const swapped = entry({ anchorStart: 'And that is the end of it', anchorEnd: 'So here is where we begin', start: 1190, end: 1196 });
    // anchorStart at 1192 (within 3 s of 1190); anchorEnd cue ends 1003.5, far from 1196: tolerance error plus order error
    const m = errors(validate([swapped]));
    expect(m.some(x => x.includes('comes before anchorStart'))).toBe(true);
  });

  it('warns about overlapping segments of the same video', () => {
    const a = entry({ key: 'a' });
    const b = entry({ key: 'b', module: 'm03', start: 1100, end: 1196, anchorStart: 'filler words number 1100' });
    expect(warnings(validate([a, b]))).toEqual(expect.arrayContaining([expect.stringContaining('overlaps b')]));
  });
});

// ---- checkOnline ---------------------------------------------------------------------------

describe('checkOnline', () => {
  const ok = (body: object) => new Response(JSON.stringify({ type: 'video', title: 'A Lecture', author_name: 'Somebody', ...body }), { status: 200 });

  it('builds the oEmbed URL for a watch URL', () => {
    const u = new URL(oembedUrl('SlqjA04_dpk'));
    expect(u.origin + u.pathname).toBe('https://www.youtube.com/oembed');
    expect(u.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=SlqjA04_dpk');
    expect(u.searchParams.get('format')).toBe('json');
  });

  it('passes when oEmbed answers with the same title and channel', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => { seen.push(url); return ok({}); }) as unknown as typeof fetch;
    expect(await checkOnline([entry()], { fetchImpl })).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it('warns about title or channel drift', async () => {
    const m = await checkOnline([entry()], { fetchImpl: (async () => ok({ title: 'Renamed', author_name: 'Else' })) as unknown as typeof fetch });
    expect(errors(m)).toEqual([]);
    expect(warnings(m)).toEqual([expect.stringContaining('title on YouTube is now "Renamed"'), expect.stringContaining('channel on YouTube is now "Else"')]);
  });

  it('reports missing, private and failing videos as errors', async () => {
    for (const [status, text] of [[404, 'does not exist'], [401, 'private or embedding is disabled'], [403, 'private or embedding'], [418, 'HTTP 418']] as const) {
      const m = await checkOnline([entry()], { fetchImpl: (async () => new Response('', { status })) as unknown as typeof fetch });
      expect(errors(m)).toEqual([expect.stringContaining(text)]);
    }
  });

  it('retries after HTTP 429 and then succeeds', async () => {
    const statuses = [429, 429, 200];
    const slept: number[] = [];
    const retried: number[] = [];
    const fetchImpl = (async () => {
      const s = statuses.shift()!;
      return s === 200 ? ok({}) : new Response('', { status: s });
    }) as unknown as typeof fetch;
    const m = await checkOnline([entry()], { fetchImpl, retryDelayMs: 60_000, sleep: async ms => { slept.push(ms); }, onRetry: (_k, status) => retried.push(status) });
    expect(m).toEqual([]);
    expect(slept).toEqual([60_000, 60_000]);
    expect(retried).toEqual([429, 429]);
  });

  it('gives up after the retries and reports the status', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response('', { status: 429 }); }) as unknown as typeof fetch;
    const m = await checkOnline([entry()], { fetchImpl, retries: 1, sleep: async () => {} });
    expect(calls).toBe(2);
    expect(errors(m)).toEqual([expect.stringContaining('HTTP 429')]);
  });

  it('reports network failures, with a proxy hint for DNS errors behind a proxy', async () => {
    const fail = (code: string) => (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code } }); }) as unknown as typeof fetch;
    const m = await checkOnline([entry()], { fetchImpl: fail('ECONNRESET') });
    expect(errors(m)).toEqual(['oEmbed request failed: ECONNRESET']);
    const saved = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.invalid:3128';
    try {
      const m2 = await checkOnline([entry()], { fetchImpl: fail('ENOTFOUND') });
      expect(errors(m2)[0]).toContain('NODE_USE_ENV_PROXY=1');
    } finally {
      if (saved === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = saved;
    }
  });

  it('flags invalid JSON and non-video types', async () => {
    const m = await checkOnline([entry()], { fetchImpl: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch });
    expect(errors(m)).toEqual(['oEmbed answered with invalid JSON']);
    const m2 = await checkOnline([entry()], { fetchImpl: (async () => ok({ type: 'rich' })) as unknown as typeof fetch });
    expect(errors(m2)).toEqual([expect.stringContaining('expected "video"')]);
  });
});

// ---- files + the real data -------------------------------------------------------------------

describe('checkVideoFiles', () => {
  const dirs: string[] = [];
  const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'videos-check-')); dirs.push(d); return d; };
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('reports a missing or malformed videos.json', async () => {
    const d = tmp();
    const missing = await checkVideoFiles({ videosFile: path.join(d, 'videos.json'), transcriptsDir: d });
    expect(errors(missing.messages)).toEqual([expect.stringContaining('does not exist')]);
    writeFileSync(path.join(d, 'videos.json'), '[{');
    const bad = await checkVideoFiles({ videosFile: path.join(d, 'videos.json'), transcriptsDir: d });
    expect(errors(bad.messages)).toEqual([expect.stringContaining('is not valid JSON')]);
  });

  it('reads the transcript named after the video id', async () => {
    const d = tmp();
    mkdirSync(path.join(d, 't'));
    writeFileSync(path.join(d, 'videos.json'), JSON.stringify([entry()]));
    const none = await checkVideoFiles({ videosFile: path.join(d, 'videos.json'), transcriptsDir: path.join(d, 't') });
    expect(errors(none.messages)).toEqual([expect.stringContaining('no transcript excerpt')]);
    writeFileSync(path.join(d, 't', 'abcdefghijk.vtt'), transcript());
    const ok = await checkVideoFiles({ videosFile: path.join(d, 'videos.json'), transcriptsDir: path.join(d, 't') });
    expect(ok.messages).toEqual([]);
    expect(ok.entries).toHaveLength(1);
  });

  it('only goes online when asked, and skips entries with a malformed id', async () => {
    const d = tmp();
    mkdirSync(path.join(d, 't'));
    writeFileSync(path.join(d, 'videos.json'), JSON.stringify([entry(), entry({ key: 'bad', id: '../x', module: 'm03' })]));
    writeFileSync(path.join(d, 't', 'abcdefghijk.vtt'), transcript());
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ type: 'video', title: 'A Lecture', author_name: 'Somebody' })); }) as unknown as typeof fetch;
    const base = { videosFile: path.join(d, 'videos.json'), transcriptsDir: path.join(d, 't'), fetchImpl };
    await checkVideoFiles(base);
    expect(urls).toEqual([]);
    const online = await checkVideoFiles({ ...base, online: true });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('abcdefghijk');
    expect(errors(online.messages).some(m => m.includes('11-character'))).toBe(true);
  });

  it('parses the CLI arguments', () => {
    expect(parseArgs([]).online).toBe(false);
    expect(parseArgs(['--online', '--strict']).online).toBe(true);
    expect(path.basename(parseArgs(['--videos', 'x/y.json']).videosFile)).toBe('y.json');
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--videos'])).toThrow(/needs a value/);
  });

  // The committed data: exactly the two PLAN §9 segments, every rule satisfied. Both segments end just after the last
  // anchor sentence finishes, so there are no "cut mid-sentence" warnings either.
  it('accepts the committed videos.json and transcript excerpts', async () => {
    const { entries, messages } = await checkVideoFiles({
      videosFile: path.join(ROOT, 'videos.json'),
      transcriptsDir: path.join(ROOT, 'tools', 'videos', 'transcripts'),
    });
    expect(errors(messages)).toEqual([]);
    expect(messages.filter(m => m.severity === 'warning')).toEqual([]);
    expect(entries.map(e => [e.key, e.id, e.module, e.lesson, e.start, e.end])).toEqual([
      ['yt-1', 'SlqjA04_dpk', 'm02', '2.6', 8531, 8701],
      ['yt-2', 'db0H0U13YsA', 'm06', '6.2', 5260, 5427],
    ]);
    for (const e of entries) {
      expect(e.verifiedAt).toBe('2026-10-15');
      expect(e.channel).toBe('CS50');
    }
  });
});
