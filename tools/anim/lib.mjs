// Shared helpers for the animation pipeline (sync-shared.mjs, check.mjs, render.mjs).
// Plain ESM with no dependencies (Node >= 22), so `node tools/anim/*.mjs` works without tsx.
// See animations/README.md for the authoring rules and the data flow.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ANIM_DIR = path.join(ROOT, 'animations');
export const SHARED_DIR = path.join(ANIM_DIR, '_shared');
export const PUBLIC_DIR = path.join(ROOT, 'public', 'animations');
export const MANIFEST_PATH = path.join(ANIM_DIR, 'manifest.json');

/** Pinned exactly; not a package.json dependency (it is a 157 MB dev tool fetched through npx). */
export const HYPERFRAMES_VERSION = '0.8.162';
/** Bump when the post-processing in render.mjs changes in a way that alters output bytes. */
export const PIPELINE_VERSION = 1;
export const DEFAULT_BROWSER = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

/** Render flags that influence the encoded bytes. Part of the cache key and of manifest.json. */
export const RENDER_FLAGS = Object.freeze(['--crf', '30', '--fps', '30', '--quality', 'looks', '--format', 'mp4']);

/**
 * VP9 settings for the deploy-time MP4 -> WebM transcode (render.mjs --webm).
 * Measured on A1 (15 s clip, 4 cores): `-deadline good -cpu-used 4 -crf 35` takes 75 s and gives 776 KB; `-deadline realtime
 * -cpu-used 8 -crf 36` takes 5 s and gives 897 KB (SSIM 0.995 against the MP4). The WebM only serves browsers without H.264, so
 * transcode speed wins over size.
 */
export const WEBM_CRF = 36;
export const WEBM_ENCODER_ARGS = Object.freeze(['-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-tile-columns', '2', '-threads', '4']);

/** Environment for every hyperframes call (PLAN section 4.6). */
export function hfEnv(extra = {}) {
  return {
    ...process.env,
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH || DEFAULT_BROWSER,
    ...extra,
  };
}

export function browserPath() {
  return hfEnv().HYPERFRAMES_BROWSER_PATH;
}

/** "Chromium 141.0.7390.37" or null when the binary is missing. */
export function browserVersion() {
  const r = spawnSync(browserPath(), ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function ffmpegVersion() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout.split('\n')[0] ?? '').trim() : null;
}

/**
 * Runs `npx --yes hyperframes@<pinned> ...args`. Returns { status, stdout, stderr }.
 * `stdio: 'inherit'` streams output instead of capturing it.
 */
export function runHf(args, { cwd = ROOT, stdio = 'pipe', env = {} } = {}) {
  const r = spawnSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], {
    cwd,
    env: hfEnv(env),
    encoding: 'utf8',
    stdio: stdio === 'inherit' ? 'inherit' : 'pipe',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

// ---- hashing -------------------------------------------------------------------------------

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(file) {
  return sha256(readFileSync(file));
}

const IGNORED_DIRS = new Set(['.hyperframes', 'renders', 'node_modules', '.git']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

/** Every file under `dir` (relative POSIX paths, sorted), skipping tool output directories. */
export function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_FILES.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...listFiles(abs, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

/**
 * Hash of everything that decides the rendered bytes: the project's files (after sync-shared, so the
 * vendored GSAP and fonts count), the pinned CLI version, the render flags and the pipeline version.
 * The browser is deliberately not part of it: see `renderCacheKey` and the notes in animations/README.md.
 */
export function sourceHash(projectDir, { hfVersion = HYPERFRAMES_VERSION, flags = RENDER_FLAGS, pipeline = PIPELINE_VERSION } = {}) {
  const h = createHash('sha256');
  h.update(`hyperframes@${hfVersion}\0pipeline@${pipeline}\0flags:${flags.join(' ')}\0`);
  for (const rel of listFiles(projectDir)) {
    h.update(`${rel}\0${sha256File(path.join(projectDir, rel))}\0`);
  }
  return h.digest('hex');
}

// ---- project discovery and sync ------------------------------------------------------------

export const PROJECT_ID_RE = /^a\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Animation project ids (directories `aNN-kebab-topic` with an index.html). `only` filters by exact id or prefix. */
export function listProjects(only = []) {
  if (!existsSync(ANIM_DIR)) return [];
  const ids = readdirSync(ANIM_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && PROJECT_ID_RE.test(d.name) && existsSync(path.join(ANIM_DIR, d.name, 'index.html')))
    .map(d => d.name)
    .sort();
  if (!only.length) return ids;
  const picked = ids.filter(id => only.some(o => id === o || id.startsWith(o)));
  const unknown = only.filter(o => !ids.some(id => id === o || id.startsWith(o)));
  if (unknown.length) throw new Error(`Unknown animation(s): ${unknown.join(', ')}. Known: ${ids.join(', ') || '(none)'}`);
  return picked;
}

export const projectDir = id => path.join(ANIM_DIR, id);

/** Where `_shared` content goes inside a project. */
export const SYNC_MAP = Object.freeze([
  { from: path.join(SHARED_DIR, 'vendor'), to: 'vendor' },
  { from: path.join(SHARED_DIR, 'fonts'), to: path.join('assets', 'fonts') },
]);

/**
 * Copies animations/_shared/{vendor,fonts} into a project (vendor/, assets/fonts/).
 * `dryRun` only reports. With `prune`, files in the destination folders that are not in _shared are removed.
 * Returns { copied, removed, upToDate } (project-relative POSIX paths).
 */
export function syncShared(id, { dryRun = false, prune = false } = {}) {
  const dir = projectDir(id);
  const copied = [];
  const removed = [];
  let upToDate = 0;
  for (const { from, to } of SYNC_MAP) {
    if (!existsSync(from)) continue;
    const destDir = path.join(dir, to);
    const names = readdirSync(from, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort();
    for (const name of names) {
      const src = path.join(from, name);
      const dst = path.join(destDir, name);
      const rel = path.join(to, name).split(path.sep).join('/');
      if (existsSync(dst) && statSync(dst).size === statSync(src).size && sha256File(dst) === sha256File(src)) {
        upToDate++;
        continue;
      }
      copied.push(rel);
      if (!dryRun) {
        mkdirSync(destDir, { recursive: true });
        copyFileSync(src, dst);
      }
    }
    if (prune && existsSync(destDir)) {
      for (const e of readdirSync(destDir, { withFileTypes: true })) {
        if (e.isFile() && !names.includes(e.name)) {
          removed.push(path.join(to, e.name).split(path.sep).join('/'));
          if (!dryRun) rmSync(path.join(destDir, e.name));
        }
      }
    }
  }
  return { copied, removed, upToDate };
}

// ---- steps, captions, VTT ------------------------------------------------------------------

/** Minimal attribute reader for the well-formed HTML we author (double-quoted or single-quoted values). */
export function readAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  const inner = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '').replace(/\/?>$/, '');
  for (const m of inner.matchAll(re)) attrs[m[1]] = m[2] ?? m[3] ?? '';
  return attrs;
}

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** All opening tags that carry `attr`, as attribute maps (tag name included as `_tag`). */
export function findTags(html, attr) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)) {
    if (!new RegExp(`\\s${attr}(?:\\s|=|>|/)`).test(m[0])) continue;
    out.push({ _tag: m[1], ...readAttrs(m[0]) });
  }
  return out;
}

/**
 * Collects the steps of a project from the HTML sources (no browser needed):
 * every sub-composition host in index.html gives `data-start`; the scene file's root `data-steps`
 * ({"key": {"label", "start", "end"}}, scene-local seconds) is shifted by it into global time.
 * Returns { id, duration, width, height, steps: [{key,label,time,end,scene}] } ordered by time.
 */
export function readProject(id, dir = projectDir(id)) {
  const indexHtml = readFileSync(path.join(dir, 'index.html'), 'utf8');
  const rootTag = findTags(indexHtml, 'data-composition-id').find(t => !t['data-composition-src']);
  if (!rootTag) throw new Error(`${id}/index.html: no root element with data-composition-id`);
  const hosts = findTags(indexHtml, 'data-composition-src');
  const steps = [];
  const scenes = [];
  for (const host of hosts) {
    const file = path.join(dir, host['data-composition-src']);
    if (!existsSync(file)) throw new Error(`${id}: host ${host['data-composition-id']} points at missing file ${host['data-composition-src']}`);
    const html = readFileSync(file, 'utf8');
    const start = Number(host['data-start'] ?? 0);
    const duration = Number(host['data-duration'] ?? 0);
    const sceneRoot = findTags(html, 'data-composition-id').find(t => t['data-composition-id'] === host['data-composition-id']);
    scenes.push({ id: host['data-composition-id'], file: host['data-composition-src'], start, duration, root: sceneRoot ?? null });
    const raw = sceneRoot?.['data-steps'];
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(decodeEntities(raw));
    } catch (e) {
      throw new Error(`${host['data-composition-src']}: data-steps is not valid JSON (${e.message})`);
    }
    for (const [key, v] of Object.entries(parsed)) {
      steps.push({ key, label: v.label ?? key, time: round3(start + v.start), end: round3(start + v.end), scene: host['data-composition-id'] });
    }
  }
  steps.sort((a, b) => a.time - b.time);
  return {
    id,
    compositionId: rootTag['data-composition-id'],
    duration: Number(rootTag['data-duration']),
    width: Number(rootTag['data-width']),
    height: Number(rootTag['data-height']),
    fps: Number(rootTag['data-fps'] ?? 30),
    scenes,
    steps,
  };
}

export const round3 = n => Math.round(n * 1000) / 1000;

/** Reads <project>/animation.json (title, lesson, platform note, description, optional posterAt). */
export function readAnimationMeta(id, dir = projectDir(id)) {
  const file = path.join(dir, 'animation.json');
  if (!existsSync(file)) throw new Error(`${id}: animation.json is missing`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** captions.json: [{ text, start, end, step? }] in global seconds. */
export function readCaptions(id, dir = projectDir(id)) {
  const file = path.join(dir, 'captions.json');
  if (!existsSync(file)) throw new Error(`${id}: captions.json is missing`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function vttTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

/** WebVTT text. Cue text is plain; `&`, `<` and `>` are escaped as the format requires. */
export function toVtt(cues) {
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = cues.map(c => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${esc(c.text)}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** Plain-text transcript: one paragraph per cue, with the step label as a heading when the cue names a step. */
export function toTranscript(cues, steps = []) {
  const label = new Map(steps.map(s => [s.key, s.label]));
  return cues.map(c => (c.step && label.has(c.step) ? `${label.get(c.step)}\n${c.text}` : c.text)).join('\n\n') + '\n';
}

// ---- manifest -------------------------------------------------------------------------------

export function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return { version: 1, renderer: {}, animations: {} };
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

/** Stable key order and a trailing newline so the file diffs cleanly. */
export function writeManifest(manifest) {
  const sortObj = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  const out = { ...manifest, animations: sortObj(manifest.animations) };
  for (const k of Object.keys(out.animations)) {
    out.animations[k] = { ...out.animations[k], outputs: sortObj(out.animations[k].outputs) };
  }
  writeFileSync(MANIFEST_PATH, JSON.stringify(out, null, 2) + '\n');
}

/** Hashes of every file under public/animations/<id>/ (relative POSIX path -> sha256). The deploy-time webm is never written here. */
export function outputHashes(id, outDir = path.join(PUBLIC_DIR, id)) {
  if (!existsSync(outDir)) return {};
  const out = {};
  for (const rel of listFiles(outDir)) out[rel] = sha256File(path.join(outDir, rel));
  return out;
}

/**
 * Is the committed render of `id` consistent with its sources?
 * Stale when the sources, the pinned CLI version, the render flags or the pipeline version changed since the render
 * (all folded into sourceHash), or when an output file is missing, altered or unexpected.
 * Returns { ok, problems: string[] }.
 */
export function checkFreshness(id, { manifest = readManifest(), dir = projectDir(id), outDir = path.join(PUBLIC_DIR, id) } = {}) {
  const entry = manifest.animations?.[id];
  if (!entry) return { ok: false, problems: [`${id}: no entry in animations/manifest.json (never rendered). Run: npm run anim:render`] };
  const problems = [];
  const now = sourceHash(dir);
  if (entry.sourceHash !== now) {
    problems.push(`${id}: STALE. The project sources, CLI version, render flags or pipeline changed since the render (manifest ${entry.sourceHash.slice(0, 12)}, now ${now.slice(0, 12)}). Run: npm run anim:render`);
  }
  const actual = outputHashes(id, outDir);
  for (const [rel, hash] of Object.entries(entry.outputs ?? {})) {
    if (!(rel in actual)) problems.push(`${id}: output ${rel} is missing from public/animations/${id}/`);
    else if (actual[rel] !== hash) problems.push(`${id}: output ${rel} differs from the manifest (edited by hand or re-encoded elsewhere)`);
  }
  for (const rel of Object.keys(actual)) if (!(rel in (entry.outputs ?? {}))) problems.push(`${id}: unexpected file public/animations/${id}/${rel} (not in the manifest)`);
  return { ok: problems.length === 0, problems };
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
