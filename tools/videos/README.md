# tools/videos: `npm run videos:check`

PLAN §4.5 and §9. `videos.json` (repo root) lists the YouTube segments the lessons embed; this folder verifies it.

```
npm run videos:check [-- --online] [--strict] [--videos file] [--transcripts dir]
```

- **Offline (the default, what CI runs).** Pure file checks, no network and never `yt-dlp` (YouTube rate-limits
  datacenter IPs).
- **`--online`.** Also asks YouTube's oEmbed endpoint (`https://www.youtube.com/oembed?url=…&format=json`) for each id:
  404 means removed, 401/403 means private or embedding disabled (errors); a changed title or channel is a warning.
  HTTP 429 and 5xx are retried twice after 60 s. Behind an HTTPS proxy Node needs `NODE_USE_ENV_PROXY=1`.
- **`--strict`.** Warnings fail too.

## `videos.json`

An array of `VideoEntry` (`src/content-model/types.ts`):

| Field | Meaning |
|---|---|
| `key` | What `<YouTube video="yt-1">` uses. |
| `id` | The 11-character YouTube id. |
| `title`, `channel` | From oEmbed (`title`, `author_name`). |
| `module`, `lesson` | Where it is used, e.g. `m02`, `2.6`. |
| `start`, `end` | Whole seconds into the video (YouTube's `start` / `end` embed parameters are integers). |
| `anchorStart`, `anchorEnd` | The transcript lines the segment begins and ends on, as spoken (case, punctuation and caption line breaks are ignored). |
| `why` | One or two sentences shown to the learner under the clip: why it beats the app here, and what follows it. |
| `verifiedAt` | `YYYY-MM-DD` of the last check against YouTube. |

## What the offline check enforces

Errors: the schema (exactly these fields, whole-second times, 11-character id, `mNN` module, valid date); unique keys;
**at most 2 segments per module**; `start < end` and a length of **30 to 480 s** (a warning above 360 s: PLAN says about
2 to 6 minutes); a transcript excerpt `tools/videos/transcripts/<id>.vtt` exists and covers the segment; **`anchorStart`
is found in the excerpt and its first caption begins within 3 s of `start`; `anchorEnd` is found and its last caption ends
within 3 s of `end`**; the end anchor comes after the start anchor.

Warnings: the segment is cut part-way through its anchor caption (`start` more than 0.5 s into the first one, `end` more
than 0.5 s before the last one finishes), with the value that would not cut it; the excerpt keeps less than about 60 s of
padding; two segments of one video overlap.

## Transcript excerpts

`transcripts/<id>.vtt` holds the WebVTT header, one `NOTE` block that attributes the captions (CS50, Harvard, CC BY-NC-SA 4.0),
and only the cues that begin between `start - 60 s` and `end + 60 s`. To refresh one by hand (the only time yt-dlp runs),
download the transcript, then cut it:

```
yt-dlp --js-runtimes node --extractor-args "youtube:player_client=web_embedded" --ignore-no-formats-error --skip-download --write-subs --write-auto-subs --sub-langs "en" --sub-format vtt -o "%(id)s" "https://www.youtube.com/watch?v=<ID>"
tsx tools/videos/excerpt.ts yt-1 /path/to/SlqjA04_dpk.en.vtt     # rewrites tools/videos/transcripts/SlqjA04_dpk.vtt
npm run videos:check
```

The `web_embedded` client matters: the default clients hit a bot check, and bursts get HTTP 429, so fetch slowly. Commit
only the excerpt; CI never calls yt-dlp. (Verified in the cloud container.)

`vtt.ts` has no Node imports, so the app can reuse `parseVtt()` and `cuesBetween()` to show a segment's transcript:
`import.meta.glob('/tools/videos/transcripts/*.vtt', { query: '?raw', import: 'default' })`.

## Embedding

`validate.ts` exports `embedUrl()`, the format the `<YouTube>` component should use (privacy-enhanced domain, click-to-load
facade adds `&autoplay=1` when pressed):

```
https://www.youtube-nocookie.com/embed/<id>?start=<start>&end=<end>&rel=0
```

Keep `referrerpolicy="strict-origin-when-cross-origin"` on the iframe (YouTube refuses embeds with no referrer).

## Adding a segment

1. Find the video and the exact second range; check it with oEmbed (`curl "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json"`).
2. Download the transcript with the yt-dlp command in "Transcript excerpts", add the entry to `videos.json` (anchors quoted from the transcript).
3. `tsx tools/videos/excerpt.ts <key> <transcript.vtt>`, then `npm run videos:check -- --online`.
4. No more than 2 segments per module, and only when the clip clearly beats the app's own visualizers.
