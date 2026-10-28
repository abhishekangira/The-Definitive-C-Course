#!/usr/bin/env node
// Hash-cached render of the animation projects into public/animations/<id>/.
//
//   node tools/anim/render.mjs                   render every project whose sources changed
//   node tools/anim/render.mjs a01               only projects whose id starts with "a01"
//   node tools/anim/render.mjs --force           ignore the cache
//   node tools/anim/render.mjs --dry-run         say what would be rendered
//   node tools/anim/render.mjs --webm dist/animations
//                                                no render: transcode the committed MP4s to VP9 WebM into
//                                                <dir>/<id>/<id>.webm (deploy step; never committed)
//
// Pipeline per project (sidecars, poster and stills are byte-identical across renders; the MP4 is not, see animations/README.md):
//   sync-shared -> static validation -> hyperframes lint -> hyperframes render --crf 30 -> ffprobe checks
//   -> strip metadata (ffmpeg -c copy) -> poster + step stills (hyperframes snapshot -> WebP)
//   -> steps.json, <id>.vtt, transcript.txt -> animations/manifest.json
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HYPERFRAMES_VERSION, PIPELINE_VERSION, PUBLIC_DIR, RENDER_FLAGS, WEBM_CRF, WEBM_ENCODER_ARGS,
  browserPath, browserVersion, checkFreshness, fmtBytes, listProjects, outputHashes, projectDir, readAnimationMeta,
  readCaptions, readManifest, readProject, run, runHf, sourceHash, syncShared, toTranscript, toVtt, writeManifest,
} from './lib.mjs';
import { validateProject } from './validate.mjs';

const log = (id, msg) => console.log(`[${id}] ${msg}`);

/** ffprobe summary of a video file. */
export function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file]);
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const s = j.streams?.[0] ?? {};
  return { codec: s.codec_name, pixFmt: s.pix_fmt, width: s.width, height: s.height, rate: s.r_frame_rate, frames: Number(s.nb_read_frames), duration: Number(j.format?.duration) };
}

function ffmpeg(args, what) {
  const r = run('ffmpeg', ['-y', '-v', 'error', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed (${what}): ${r.stderr.trim()}`);
}

/** Snapshot PNGs by time: parses `frame-NN-at-<t>s.png` names written by `hyperframes snapshot`. */
export function indexSnapshots(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const m = /^frame-\d+-at-([0-9.]+)s\.png$/.exec(f);
    if (m) out.push({ t: Number(m[1]), file: path.join(dir, f) });
  }
  return out;
}

function stepsJson(id, project, meta, stills, hasPoster) {
  return {
    id,
    title: meta.title,
    lesson: meta.lesson,
    platform: meta.platform,
    description: meta.description,
    duration: project.duration,
    fps: project.fps,
    width: project.width,
    height: project.height,
    video: `${id}.mp4`,
    poster: hasPoster ? 'poster.webp' : null,
    captions: `${id}.vtt`,
    transcript: 'transcript.txt',
    steps: project.steps.map(s => ({ key: s.key, label: s.label, time: s.time, end: s.end })),
    stills,
  };
}

/** Renders one project. Returns { status: 'rendered' | 'cached', bytes }. */
export function renderProject(id, { force = false, dryRun = false } = {}) {
  const dir = projectDir(id);
  const sync = syncShared(id);
  if (sync.copied.length) log(id, `synced ${sync.copied.length} shared file(s)`);

  const v = validateProject(id);
  for (const w of v.warnings) log(id, `warning: ${w}`);
  if (v.errors.length) throw new Error(`${id}: static validation failed:\n  - ${v.errors.join('\n  - ')}`);

  const browser = browserVersion();
  if (!browser) throw new Error(`Chromium not found at ${browserPath()}. Set HYPERFRAMES_BROWSER_PATH (see animations/README.md).`);
  const hash = sourceHash(dir);
  const manifest = readManifest();
  const entry = manifest.animations[id];
  if (!force && entry && entry.sourceHash === hash && entry.browser === browser && checkFreshness(id, { manifest }).ok) {
    log(id, `up to date (${fmtBytes(statSync(path.join(PUBLIC_DIR, id, `${id}.mp4`)).size)} MP4, sources ${hash.slice(0, 12)})`);
    return { status: 'cached', bytes: statSync(path.join(PUBLIC_DIR, id, `${id}.mp4`)).size };
  }
  if (dryRun) {
    log(id, `would render (${entry ? (entry.sourceHash !== hash ? 'sources changed' : entry.browser !== browser ? 'browser changed' : 'outputs differ') : 'never rendered'})`);
    return { status: 'dry-run', bytes: 0 };
  }

  const lint = runHf(['lint', dir, '--json']);
  let lintJson = null;
  try {
    lintJson = JSON.parse(lint.stdout.slice(lint.stdout.indexOf('{')));
  } catch {
    /* handled below */
  }
  if (!lintJson || lintJson.errorCount || lintJson.warningCount) {
    throw new Error(`${id}: hyperframes lint must report 0 errors and 0 warnings:\n${lintJson ? JSON.stringify(lintJson.findings, null, 2) : lint.stdout + lint.stderr}`);
  }

  const project = readProject(id);
  const meta = readAnimationMeta(id);
  const cues = readCaptions(id);
  const work = path.join(dir, 'renders', 'work');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const raw = path.join(work, `${id}.raw.mp4`);

  // 1. Render.
  const t0 = Date.now();
  log(id, `rendering ${project.duration} s at ${project.fps} fps (${RENDER_FLAGS.join(' ')}); this takes a few minutes`);
  const vars = path.join(dir, 'variables.json');
  const extra = existsSync(vars) ? ['--variables-file', vars, '--strict-variables'] : [];
  const r = runHf(['render', dir, ...RENDER_FLAGS, '--quiet', '--strict-all', ...extra, '-o', raw]);
  if (r.status !== 0 || !existsSync(raw)) throw new Error(`${id}: hyperframes render failed:\n${(r.stdout + r.stderr).split('\n').slice(-30).join('\n')}`);
  log(id, `rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // 2. Verify the encode against the composition.
  const p = probe(raw);
  const expectFrames = Math.round(project.duration * project.fps);
  const problems = [];
  if (p.codec !== 'h264' || p.pixFmt !== 'yuv420p') problems.push(`codec ${p.codec}/${p.pixFmt}, expected h264/yuv420p`);
  if (p.width !== project.width || p.height !== project.height) problems.push(`size ${p.width}x${p.height}, expected ${project.width}x${project.height}`);
  if (p.rate !== `${project.fps}/1`) problems.push(`frame rate ${p.rate}, expected ${project.fps}/1`);
  if (p.frames !== expectFrames) problems.push(`${p.frames} frames, expected ${expectFrames}`);
  if (Math.abs(p.duration - project.duration) > 1 / project.fps) problems.push(`duration ${p.duration} s, expected data-duration ${project.duration} s`);
  if (problems.length) throw new Error(`${id}: render does not match the composition: ${problems.join('; ')}`);

  // 3. Stage the outputs in a work directory, then swap it in.
  const out = path.join(work, 'out');
  mkdirSync(path.join(out, 'stills'), { recursive: true });
  // The renderer stamps tool tags into the MP4; strip them (and put the index first for streaming).
  ffmpeg(['-i', raw, '-map', '0:v:0', '-map_metadata', '-1', '-c', 'copy', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-movflags', '+faststart', path.join(out, `${id}.mp4`)], 'strip metadata');

  // Poster and step stills come from pixel-exact snapshots (not from the CRF 30 video).
  const posterAt = meta.posterAt ?? project.duration / 2;
  const stillTimes = project.steps.map(s => s.end);
  const times = [...new Set([posterAt, ...stillTimes])].sort((a, b) => a - b);
  const snapDir = path.join(work, 'snapshots');
  const snap = runHf(['snapshot', dir, '--at', times.join(','), '--no-end', '-o', snapDir]);
  if (snap.status !== 0) throw new Error(`${id}: hyperframes snapshot failed:\n${snap.stdout}${snap.stderr}`);
  const frames = indexSnapshots(snapDir);
  const frameAt = t => {
    const f = frames.find(x => Math.abs(x.t - t) < 0.0006);
    if (!f) throw new Error(`${id}: no snapshot for t=${t} (got ${frames.map(x => x.t).join(', ')})`);
    return f.file;
  };
  ffmpeg(['-i', frameAt(posterAt), '-vf', 'scale=1280:-2:flags=lanczos', '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', '-map_metadata', '-1', path.join(out, 'poster.webp')], 'poster');
  const stills = {};
  for (const s of project.steps) {
    ffmpeg(['-i', frameAt(s.end), '-c:v', 'libwebp', '-quality', '84', '-compression_level', '6', '-map_metadata', '-1', path.join(out, 'stills', `${s.key}.webp`)], `still ${s.key}`);
    stills[s.key] = `stills/${s.key}.webp`;
  }

  // Sidecars: never burned into the picture.
  writeFileSync(path.join(out, `${id}.vtt`), toVtt(cues));
  writeFileSync(path.join(out, 'transcript.txt'), toTranscript(cues, project.steps));
  writeFileSync(path.join(out, 'steps.json'), JSON.stringify(stepsJson(id, project, meta, stills, true), null, 2) + '\n');

  const dest = path.join(PUBLIC_DIR, id);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(PUBLIC_DIR, { recursive: true });
  cpSync(out, dest, { recursive: true });
  rmSync(work, { recursive: true, force: true });

  // 4. Manifest.
  const fresh = readManifest();
  fresh.version = 1;
  fresh.renderer = { hyperframes: HYPERFRAMES_VERSION, pipeline: PIPELINE_VERSION, flags: [...RENDER_FLAGS] };
  fresh.animations[id] = { sourceHash: hash, browser, outputs: outputHashes(id) };
  writeManifest(fresh);

  const bytes = statSync(path.join(dest, `${id}.mp4`)).size;
  log(id, `done: ${fmtBytes(bytes)} MP4, ${project.steps.length} steps, ${cues.length} cues`);
  return { status: 'rendered', bytes };
}

/** MP4 -> WebM (VP9) for browsers without H.264. Deploy-only: the result is never committed. */
export function transcodeWebm(id, outRoot) {
  const mp4 = path.join(PUBLIC_DIR, id, `${id}.mp4`);
  if (!existsSync(mp4)) throw new Error(`${id}: ${mp4} does not exist (render it first)`);
  const dest = path.join(path.resolve(outRoot), id);
  mkdirSync(dest, { recursive: true });
  const file = path.join(dest, `${id}.webm`);
  const t0 = Date.now();
  ffmpeg(['-i', mp4, '-map', '0:v:0', '-c:v', 'libvpx-vp9', '-crf', String(WEBM_CRF), '-b:v', '0', '-pix_fmt', 'yuv420p', ...WEBM_ENCODER_ARGS, '-an', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', file], 'webm');
  log(id, `webm ${fmtBytes(statSync(file).size)} in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(process.cwd(), file)}`);
  return file;
}

/**
 * Splits the CLI arguments into animation ids, `--` flags and the `--webm` output directory.
 * Ids may come before or after the flags. `webmDir` is null without `--webm`, and undefined
 * (or a flag) when `--webm` has no directory after it; `main` rejects that.
 */
export function parseArgs(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const webmIdx = argv.indexOf('--webm');
  const webmDir = webmIdx >= 0 ? argv[webmIdx + 1] : null;
  // Only the argument right after --webm is its directory. Without --webm, webmIdx is -1, so an
  // unguarded `i !== webmIdx + 1` dropped argv[0], the first id (#111).
  const ids = argv.filter((a, i) => !a.startsWith('--') && !(webmIdx >= 0 && i === webmIdx + 1));
  return { ids, flags, webmDir };
}

function main(argv) {
  const { ids, flags, webmDir } = parseArgs(argv);
  if (flags.has('--webm') && (!webmDir || webmDir.startsWith('--'))) {
    console.error('--webm needs an output directory, e.g. --webm dist/animations');
    process.exit(2);
  }
  const projects = listProjects(ids);
  if (!projects.length) {
    console.log('No animation projects found.');
    return;
  }
  let failed = 0;
  for (const id of projects) {
    try {
      if (webmDir) transcodeWebm(id, webmDir);
      else renderProject(id, { force: flags.has('--force'), dryRun: flags.has('--dry-run') });
    } catch (e) {
      failed++;
      console.error(`\n[${id}] FAILED: ${e.message}\n`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
