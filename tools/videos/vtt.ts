// WebVTT helpers for the committed transcript excerpts (tools/videos/transcripts/<id>.vtt).
// No Node imports on purpose: the module is plain TypeScript, so the app could reuse parseVtt() /
// cuesBetween() to show a segment's transcript (PLAN §4.5) via
//   import.meta.glob('/tools/videos/transcripts/*.vtt', { query: '?raw', import: 'default' }).
//
// Assumes "clean" cues, as downloaded by the yt-dlp command in tools/videos/README.md (web_embedded client): one
// short caption per cue, no rolling duplicates. Inline timing tags (<00:00:01.000>, <c>) are stripped.

export interface Cue {
  /** Seconds. */
  start: number;
  end: number;
  /** Payload with tags removed and lines joined by a single space. */
  text: string;
}

const TIMING = /^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})(?:\s.*)?$/;

/** "01:02:03.500" or "02:03.500" to seconds. */
export function parseTimestamp(ts: string): number {
  const parts = ts.replace(',', '.').split(':').map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

/** Seconds to "HH:MM:SS.mmm" (rounded to the millisecond). */
export function formatTimestamp(seconds: number): string {
  const total = Math.round(seconds * 1000);
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Parses WebVTT text into cues. NOTE, STYLE and REGION blocks and the header are skipped. */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => TIMING.test(l.trim()));
    if (at < 0 || at > 1) continue; // header, NOTE/STYLE/REGION block, or junk
    const m = TIMING.exec(lines[at].trim())!;
    const payload = lines
      .slice(at + 1)
      .map(l => decodeEntities(l.replace(/<[^>]*>/g, '')).trim())
      .filter(Boolean)
      .join(' ');
    if (!payload) continue;
    cues.push({ start: parseTimestamp(m[1]), end: parseTimestamp(m[2]), text: payload });
  }
  return cues;
}

/** Cues that begin within [from, to] seconds. */
export function cuesBetween(cues: readonly Cue[], from: number, to: number): Cue[] {
  return cues.filter(c => c.start >= from && c.start <= to);
}

/** Lower-case words with punctuation removed ("Hey, Binky's!" to ["hey", "binkys"]). */
export function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export interface AnchorMatch {
  /** The cue the anchor's first word is in. */
  first: Cue;
  /** The cue the anchor's last word is in. */
  last: Cue;
}

/**
 * Finds `anchor` (punctuation, case and cue breaks are ignored; leading or trailing "…" are dropped)
 * in the cues. With several matches, the one whose first cue starts nearest to `near` seconds wins
 * (or, with `edge: 'end'`, whose last cue ends nearest). Returns null when the words are not there.
 */
export function findAnchor(cues: readonly Cue[], anchor: string, near?: number, edge: 'start' | 'end' = 'start'): AnchorMatch | null {
  const target = words(anchor.replace(/^[\s.…]+|[\s.…]+$/g, ''));
  if (target.length === 0) return null;
  const flat: Array<{ word: string; cue: number }> = [];
  cues.forEach((c, i) => { for (const w of words(c.text)) flat.push({ word: w, cue: i }); });
  let best: AnchorMatch | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i + target.length <= flat.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (flat[i + j].word !== target[j]) { ok = false; break; }
    }
    if (!ok) continue;
    const match = { first: cues[flat[i].cue], last: cues[flat[i + target.length - 1].cue] };
    const distance = near === undefined ? 0 : Math.abs((edge === 'start' ? match.first.start : match.last.end) - near);
    if (distance < bestDistance) { best = match; bestDistance = distance; }
    if (near === undefined) break;
  }
  return best;
}

export interface ExcerptOptions {
  /** Segment start and end, in seconds. */
  start: number;
  end: number;
  /** Extra seconds kept either side (default 60). */
  pad?: number;
  /** Text of the NOTE block written under the header. */
  note: string;
}

/**
 * Builds the committed excerpt from a full transcript: the header, one NOTE block (attribution) and
 * every cue that begins between start-pad and end+pad.
 */
export function makeExcerpt(fullVtt: string, o: ExcerptOptions): string {
  const pad = o.pad ?? 60;
  const kept = cuesBetween(parseVtt(fullVtt), o.start - pad, o.end + pad);
  if (kept.length === 0) throw new Error(`no cues between ${o.start - pad} s and ${o.end + pad} s`);
  const out = ['WEBVTT', 'Kind: captions', 'Language: en', '', 'NOTE', ...o.note.split('\n'), ''];
  for (const c of kept) out.push(`${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}`, c.text, '');
  return out.join('\n');
}
