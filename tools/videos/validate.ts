// Validation for videos.json (PLAN §4.5, §9). Pure functions: the CLI (check.ts) does the file and
// network I/O and passes the data in, so the rules are unit-testable without either.
//
// Offline rules (errors unless noted):
//   - the file is an array of VideoEntry with exactly the documented fields and sane values;
//   - keys and ids are unique; at most 2 segments per module (AGENTS.md "YouTube" rule);
//   - start < end and the segment is 30-480 s long (warning above 360 s: PLAN says about 2-6 min);
//   - a committed transcript excerpt exists for each video and covers the segment;
//   - anchorStart is found in the excerpt and its cue begins within 3 s of `start`;
//     anchorEnd is found and its cue ends within 3 s of `end`;
//   - warning: the segment starts or ends part-way through its anchor cue (a cut sentence).
// Online (--online): oEmbed still answers 200 for each id (title/author drift is a warning).
import { findAnchor, parseVtt, type Cue } from './vtt';
import type { VideoEntry } from '../../src/content-model/types';

export type Severity = 'error' | 'warning';
export interface VideoMessage {
  severity: Severity;
  /** The entry's key, or undefined for file-level problems. */
  key?: string;
  message: string;
}

export const MAX_PER_MODULE = 2;
export const MIN_SECONDS = 30;
export const MAX_SECONDS = 480;
export const SOFT_MAX_SECONDS = 360;
/** How far (seconds) an anchor cue may be from the segment boundary. */
export const ANCHOR_TOLERANCE = 3;
/** A segment cut more than this far into its first/last anchor cue is reported as cutting a sentence. */
export const CUT_TOLERANCE = 0.5;
/** Seconds of transcript kept either side of a segment, and how much shortfall is tolerated. */
export const EXCERPT_PAD = 60;
export const EXCERPT_SLACK = 10;
/** Silence at the very start or end of a segment is fine: the excerpt may begin/end this much inside it. */
export const COVER_SLACK = 2;

const FIELDS: Array<keyof VideoEntry> = ['key', 'id', 'title', 'channel', 'module', 'lesson', 'start', 'end', 'anchorStart', 'anchorEnd', 'why', 'verifiedAt'];
const STRING_FIELDS = ['key', 'id', 'title', 'channel', 'module', 'lesson', 'anchorStart', 'anchorEnd', 'why', 'verifiedAt'] as const;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** "8531-8699 (2:48)". */
export function describeSegment(v: Pick<VideoEntry, 'start' | 'end'>): string {
  const len = v.end - v.start;
  return `${v.start}-${v.end} s (${Math.floor(len / 60)}:${String(len % 60).padStart(2, '0')})`;
}

/** The embed URL the <YouTube> component loads (privacy-enhanced mode; the facade adds autoplay=1). */
export function embedUrl(v: Pick<VideoEntry, 'id' | 'start' | 'end'>, extra = ''): string {
  return `https://www.youtube-nocookie.com/embed/${v.id}?start=${v.start}&end=${v.end}&rel=0${extra}`;
}

/** Schema check of one entry. Returns the typed entry when no error was found. */
function validateShape(raw: unknown, index: number, out: VideoMessage[]): VideoEntry | null {
  const label = (typeof (raw as { key?: unknown })?.key === 'string' && (raw as { key: string }).key) || `#${index}`;
  const err = (message: string) => out.push({ severity: 'error', key: label, message });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { err('entry must be an object'); return null; }
  const o = raw as Record<string, unknown>;
  let ok = true;
  for (const k of Object.keys(o)) {
    if (!FIELDS.includes(k as keyof VideoEntry)) { err(`unknown field "${k}" (allowed: ${FIELDS.join(', ')})`); ok = false; }
  }
  for (const k of STRING_FIELDS) {
    if (typeof o[k] !== 'string' || !(o[k] as string).trim()) { err(`"${k}" must be a non-empty string`); ok = false; }
  }
  for (const k of ['start', 'end'] as const) {
    if (!Number.isInteger(o[k]) || (o[k] as number) < 0) { err(`"${k}" must be a whole number of seconds (YouTube's start/end parameters are integers)`); ok = false; }
  }
  if (!ok) return null;
  const v = o as unknown as VideoEntry;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(v.key)) { err(`key "${v.key}" must be lower-case kebab-case, e.g. "yt-1"`); ok = false; }
  if (!/^[A-Za-z0-9_-]{11}$/.test(v.id)) { err(`id "${v.id}" is not an 11-character YouTube video id`); ok = false; }
  if (!/^(m\d{2}|cap)$/.test(v.module)) { err(`module "${v.module}" must look like "m02" (or "cap")`); ok = false; }
  if (!/^\S+$/.test(v.lesson)) { err(`lesson "${v.lesson}" must be a lesson number such as "2.6"`); ok = false; }
  if (!isDate(v.verifiedAt)) { err(`verifiedAt "${v.verifiedAt}" must be a date, YYYY-MM-DD`); ok = false; }
  if (v.start >= v.end) { err(`start (${v.start}) must be before end (${v.end})`); ok = false; }
  return ok ? v : null;
}

function checkTranscript(v: VideoEntry, vtt: string, out: VideoMessage[]) {
  const { key } = v;
  const error = (message: string) => out.push({ severity: 'error', key, message });
  const warn = (message: string) => out.push({ severity: 'warning', key, message });
  const cues: Cue[] = parseVtt(vtt);
  if (cues.length === 0) { error('transcript excerpt has no cues'); return; }

  // Coverage: the excerpt is the segment plus EXCERPT_PAD seconds either side (PLAN §4.5).
  const firstStart = cues[0].start;
  const lastEnd = Math.max(...cues.map(c => c.end));
  if (firstStart > v.start + COVER_SLACK || lastEnd < v.end - COVER_SLACK) {
    error(`transcript excerpt (${firstStart}-${lastEnd} s) does not cover the segment (${v.start}-${v.end} s)`);
  } else {
    if (firstStart > v.start - EXCERPT_PAD + EXCERPT_SLACK) warn(`transcript excerpt starts ${Math.round(v.start - firstStart)} s before the segment; keep ${EXCERPT_PAD} s`);
    if (lastEnd < v.end + EXCERPT_PAD - EXCERPT_SLACK) warn(`transcript excerpt ends ${Math.round(lastEnd - v.end)} s after the segment; keep ${EXCERPT_PAD} s`);
  }

  const first = findAnchor(cues, v.anchorStart, v.start, 'start');
  const last = findAnchor(cues, v.anchorEnd, v.end, 'end');
  if (!first) error(`anchorStart not found in the transcript excerpt: "${v.anchorStart}"`);
  if (!last) error(`anchorEnd not found in the transcript excerpt: "${v.anchorEnd}"`);
  if (first) {
    const d = first.first.start - v.start;
    if (Math.abs(d) > ANCHOR_TOLERANCE) {
      error(`anchorStart is at ${first.first.start.toFixed(1)} s, ${Math.abs(d).toFixed(1)} s ${d < 0 ? 'before' : 'after'} start (${v.start}); allowed ±${ANCHOR_TOLERANCE} s`);
    } else if (d < -CUT_TOLERANCE) {
      warn(`start (${v.start}) is ${(-d).toFixed(1)} s into the first anchor cue (${first.first.start.toFixed(1)} s): the segment opens part-way through a sentence; suggest start=${Math.floor(first.first.start)}`);
    }
  }
  if (last) {
    const d = last.last.end - v.end;
    if (Math.abs(d) > ANCHOR_TOLERANCE) {
      error(`anchorEnd ends at ${last.last.end.toFixed(1)} s, ${Math.abs(d).toFixed(1)} s ${d < 0 ? 'before' : 'after'} end (${v.end}); allowed ±${ANCHOR_TOLERANCE} s`);
    } else if (d > CUT_TOLERANCE) {
      warn(`end (${v.end}) is ${d.toFixed(1)} s before the last anchor cue finishes (${last.last.end.toFixed(1)} s): the segment is cut mid-sentence; suggest end=${Math.ceil(last.last.end)}`);
    }
  }
  if (first && last && last.last.end <= first.first.start) error('anchorEnd comes before anchorStart in the transcript');
}

/**
 * Validates the parsed videos.json. `transcript(id)` returns the committed excerpt's text, or
 * undefined when there is no file.
 */
export function validateVideos(data: unknown, transcript: (id: string) => string | undefined): VideoMessage[] {
  const out: VideoMessage[] = [];
  if (!Array.isArray(data)) return [{ severity: 'error', message: 'videos.json must be an array of entries' }];
  const entries: VideoEntry[] = [];
  data.forEach((raw, i) => {
    const v = validateShape(raw, i, out);
    if (v) entries.push(v);
  });

  const keys = new Map<string, number>();
  const perModule = new Map<string, string[]>();
  for (const v of entries) {
    keys.set(v.key, (keys.get(v.key) ?? 0) + 1);
    perModule.set(v.module, [...(perModule.get(v.module) ?? []), v.key]);
  }
  for (const [key, n] of keys) if (n > 1) out.push({ severity: 'error', key, message: `duplicate key "${key}" (${n} entries)` });
  for (const [module, list] of perModule) {
    if (list.length > MAX_PER_MODULE) {
      out.push({ severity: 'error', message: `module ${module} has ${list.length} segments (${list.join(', ')}); the limit is ${MAX_PER_MODULE}` });
    }
  }

  for (const v of entries) {
    const len = v.end - v.start;
    if (len < MIN_SECONDS || len > MAX_SECONDS) {
      out.push({ severity: 'error', key: v.key, message: `segment is ${len} s long; it must be ${MIN_SECONDS}-${MAX_SECONDS} s` });
    } else if (len > SOFT_MAX_SECONDS) {
      out.push({ severity: 'warning', key: v.key, message: `segment is ${len} s long; PLAN §4.5 keeps segments to about 2-6 minutes` });
    }
    for (const other of entries) {
      if (other !== v && other.id === v.id && other.key > v.key && other.start < v.end && v.start < other.end) {
        out.push({ severity: 'warning', key: v.key, message: `overlaps ${other.key}, which uses the same video` });
      }
    }
    const vtt = transcript(v.id);
    if (vtt === undefined) out.push({ severity: 'error', key: v.key, message: `no transcript excerpt: tools/videos/transcripts/${v.id}.vtt` });
    else checkTranscript(v, vtt, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Online: oEmbed.

export interface OnlineOptions {
  fetchImpl?: typeof fetch;
  /** Milliseconds to wait after HTTP 429 before retrying (default 60 000, as tools/videos/README.md advises). */
  retryDelayMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called before waiting for a retry. */
  onRetry?: (key: string, status: number, delayMs: number) => void;
  timeoutMs?: number;
}

export function oembedUrl(id: string): string {
  const u = new URL('https://www.youtube.com/oembed');
  u.searchParams.set('url', `https://www.youtube.com/watch?v=${id}`);
  u.searchParams.set('format', 'json');
  return u.toString();
}

/** Re-checks every entry against YouTube's oEmbed endpoint. Never calls yt-dlp. */
export async function checkOnline(entries: readonly VideoEntry[], o: OnlineOptions = {}): Promise<VideoMessage[]> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const retries = o.retries ?? 2;
  const delay = o.retryDelayMs ?? 60_000;
  const out: VideoMessage[] = [];
  for (const v of entries) {
    const err = (message: string) => out.push({ severity: 'error', key: v.key, message });
    const warn = (message: string) => out.push({ severity: 'warning', key: v.key, message });
    let res: Response | undefined;
    let failure: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        res = await fetchImpl(oembedUrl(v.id), { signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
        failure = undefined;
      } catch (e) {
        failure = e;
        res = undefined;
      }
      const retryable = res ? res.status === 429 || res.status >= 500 : false;
      if (!retryable || attempt === retries) break;
      o.onRetry?.(v.key, res!.status, delay);
      await sleep(delay);
    }
    if (!res) {
      const cause = failure instanceof Error ? ((failure.cause as { code?: string } | undefined)?.code ?? failure.message) : String(failure);
      const hint = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(cause) && (process.env.HTTPS_PROXY || process.env.https_proxy)
        ? ' (behind a proxy? Node needs NODE_USE_ENV_PROXY=1 to use HTTPS_PROXY)' : '';
      err(`oEmbed request failed: ${cause}${hint}`);
      continue;
    }
    if (res.status === 404) { err('oEmbed says the video does not exist (404): it was removed or the id is wrong'); continue; }
    if (res.status === 401 || res.status === 403) { err(`oEmbed refuses the video (${res.status}): it is private or embedding is disabled`); continue; }
    if (!res.ok) { err(`oEmbed answered HTTP ${res.status}`); continue; }
    let body: { title?: unknown; author_name?: unknown; type?: unknown };
    try { body = (await res.json()) as typeof body; } catch { err('oEmbed answered with invalid JSON'); continue; }
    if (body.type !== 'video') err(`oEmbed type is "${String(body.type)}", expected "video"`);
    if (body.title !== v.title) warn(`title on YouTube is now "${String(body.title)}" (videos.json has "${v.title}")`);
    if (body.author_name !== v.channel) warn(`channel on YouTube is now "${String(body.author_name)}" (videos.json has "${v.channel}")`);
  }
  return out;
}
