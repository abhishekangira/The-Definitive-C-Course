// Static validation of an animation project: the PLAN section 4.6 authoring rules that `hyperframes lint`
// and `hyperframes check` do not enforce, plus cross-file consistency (steps, rail, motion sidecar, captions).
// No browser needed: this runs in milliseconds and is the first gate of tools/anim/check.mjs.
//
// Rules that are checked here (see animations/README.md for the rationale):
//   structure   one standalone root, 1920x1080 at 30 fps, every scene a sub-composition that exists
//   timelines   exactly one paused timeline per file, guarded registry, registered after the last tween
//   tweens      fromTo only; animatable properties limited to transforms, opacity, colours and stroke offsets;
//               no delay / callbacks / infinite repeats; no play()
//   determinism no clocks, Math.random, timers, rAF, network, CDN URLs, CSS transitions or keyframes
//   type        text >= 24 px (px sizes only), every character covered by the shipped font subsets
//   steps       data-steps on scenes, mirrored in the rail, labels present, motion appearsBy per step, captions per step
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findTags, projectDir, readAnimationMeta, readCaptions, readProject, round3 } from './lib.mjs';

// ---- text helpers ----------------------------------------------------------------------------

/** Removes HTML comments, <script> and <style> blocks. */
export function stripBlocks(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', times: '×', middot: '·', hellip: '…', mdash: '—', ndash: '–' };

/** Visible text of the markup: tags removed, entities decoded. */
export function visibleText(html) {
  return stripBlocks(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/**
 * Code points covered by the shipped Latin subsets (@fontsource latin unicode-range, Inter and JetBrains Mono).
 * A character outside it silently falls back to a system font, which differs per machine and breaks determinism.
 */
export function inFontSubset(cp) {
  return (
    (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || cp === 0x131 || cp === 0x152 || cp === 0x153 ||
    cp === 0x2bb || cp === 0x2bc || cp === 0x2c6 || cp === 0x2da || cp === 0x2dc || cp === 0x304 || cp === 0x308 || cp === 0x329 ||
    (cp >= 0x2000 && cp <= 0x206f) || cp === 0x20ac || cp === 0x2122 || cp === 0x2191 || cp === 0x2193 || cp === 0x2212 ||
    cp === 0x2215 || cp === 0xfeff || cp === 0xfffd || cp === 0x0a || cp === 0x09 || cp === 0x0d
  );
}

/** Characters in the visible text that no shipped font covers, as [char, "U+XXXX"] pairs without duplicates. */
export function uncoveredGlyphs(html) {
  const seen = new Map();
  for (const ch of visibleText(html)) {
    const cp = ch.codePointAt(0);
    if (!inFontSubset(cp)) seen.set(ch, `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  return [...seen.entries()];
}

export function extractStyles(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
}

export function extractScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[2]);
}

/** Drops // and block comments from JS (string-aware enough for authored scripts). */
export function stripJsComments(js) {
  let out = '';
  for (let i = 0; i < js.length; i++) {
    const c = js[i];
    const n = js[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      for (i++; i < js.length && js[i] !== q; i++) {
        out += js[i];
        if (js[i] === '\\') out += js[++i] ?? '';
      }
      out += q;
    } else if (c === '/' && n === '/') {
      while (i < js.length && js[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < js.length && !(js[i] === '*' && js[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return out;
}

// ---- CSS checks ------------------------------------------------------------------------------

/** Pixel font sizes declared in CSS (`font-size: 20px`, `font: 700 20px/1.2 ...`, `--*-size: 20px`). Relative sizes are not resolved. */
export function cssFontSizes(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(?:^|[;{\s])font-size\s*:\s*([^;}]+)/g)) {
    const px = /(\d+(?:\.\d+)?)px/.exec(m[1]);
    if (px) out.push({ px: Number(px[1]), decl: `font-size: ${m[1].trim()}` });
  }
  for (const m of clean.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]+)/g)) {
    // `font: <style> <weight> <size>[/<line-height>] <family>`; the size is the first token that has a unit and is followed by a family.
    const size = /(?:^|\s)(\d+(?:\.\d+)?)px(?:\s*\/\s*[^\s]+)?\s+(?:var\(|["'a-zA-Z])/.exec(m[1]);
    if (size) out.push({ px: Number(size[1]), decl: `font: ${m[1].trim()}` });
  }
  // Sizes held in custom properties (`--code-size: 28px`) feed `font: ... var(--code-size, 38px)/...`.
  for (const m of clean.matchAll(/(--[\w-]*size[\w-]*)\s*:\s*(\d+(?:\.\d+)?)px/g)) out.push({ px: Number(m[2]), decl: `${m[1]}: ${m[2]}px` });
  return out;
}

// ---- tween scan ------------------------------------------------------------------------------

/** Index of the matching close paren for the open paren at `open` (string-aware). */
function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++;
    } else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits `a, {b: 1, c: 2}, f(x, y)` into top-level arguments. */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++;
      cur += s.slice(start, i + 1);
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    if (c === ')' || c === '}' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Top-level keys of an object literal `{ a: 1, "b-c": 2, ...}`. */
export function objectKeys(obj) {
  const inner = obj.trim().replace(/^\{/, '').replace(/\}$/, '');
  return splitArgs(inner)
    .map(part => {
      const m = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/.exec(part);
      return m ? m[1] ?? m[2] ?? m[3] : null;
    })
    .filter(Boolean);
}

export const ANIMATABLE = new Set([
  // transforms and opacity
  'opacity', 'x', 'y', 'xPercent', 'yPercent', 'scale', 'scaleX', 'scaleY', 'rotation', 'rotationX', 'rotationY', 'skewX', 'skewY', 'transformOrigin',
  // colours
  'color', 'backgroundColor', 'borderColor', 'stroke', 'fill',
  // SVG stroke offsets
  'strokeDashoffset',
]);
export const TWEEN_CONTROLS = new Set(['duration', 'ease', 'stagger', 'repeat', 'yoyo', 'immediateRender', 'overwrite', 'repeatDelay']);

/**
 * Finds every `tl.<method>(` / `gsap.<method>(` tween call in a script and returns { method, keys, vars, index }.
 * `keys` is the union of property keys across the vars objects.
 */
export function tweenCalls(script) {
  const js = stripJsComments(script);
  const out = [];
  for (const m of js.matchAll(/\b(tl|gsap|master)\.(fromTo|from|to|set|add|call|delayedCall|timeline)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(js, open);
    if (close < 0) continue;
    const args = splitArgs(js.slice(open + 1, close));
    const vars = args.filter(a => a.startsWith('{'));
    out.push({ method: m[2], owner: m[1], args, vars, keys: vars.flatMap(objectKeys), index: m.index, end: close });
  }
  return out;
}

// ---- project validation ----------------------------------------------------------------------

const FILE_RE = /^[a-z]{2,4}-\d{2}-[a-z0-9-]+\.html$/;

/** Project files that make up the composition: index.html plus everything in compositions/. */
function sourceFiles(dir, scenes) {
  return ['index.html', ...scenes.map(s => s.file)].filter((f, i, a) => a.indexOf(f) === i && existsSync(path.join(dir, f)));
}

const EPS = 0.0005;

/**
 * Validates one animation project. Returns { errors: string[], warnings: string[], info }.
 * Pure with respect to the project's files; never launches a browser.
 */
export function validateProject(id, { dir = projectDir(id) } = {}) {
  const errors = [];
  const warnings = [];
  const err = m => errors.push(m);
  const warn = m => warnings.push(m);

  let project;
  try {
    project = readProject(id, dir);
  } catch (e) {
    return { errors: [e.message], warnings, info: {} };
  }
  const { duration, steps, scenes } = project;

  // -- structure
  if (project.compositionId !== id) err(`index.html: root data-composition-id is "${project.compositionId}", expected "${id}" (the directory name)`);
  if (project.width !== 1920 || project.height !== 1080) err(`index.html: canvas is ${project.width}x${project.height}; every animation is 1920x1080`);
  if (project.fps !== 30) err(`index.html: data-fps is ${project.fps}; every animation is 30 fps`);
  if (!(duration > 0)) err('index.html: root data-duration is missing or not positive');
  if (!existsSync(path.join(dir, 'vendor', 'gsap.min.js'))) err('vendor/gsap.min.js is missing (run node tools/anim/sync-shared.mjs)');
  if (!existsSync(path.join(dir, 'assets', 'fonts'))) err('assets/fonts is missing (run node tools/anim/sync-shared.mjs)');
  const rootHtml = readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (/<template\b/i.test(rootHtml)) err('index.html: the standalone root must not be wrapped in <template>');
  if (!/<script[^>]+src="vendor\/gsap\.min\.js"/.test(rootHtml)) err('index.html: GSAP must be loaded from vendor/gsap.min.js');

  const sceneIds = new Set();
  for (const s of scenes) {
    if (!FILE_RE.test(path.basename(s.file))) warn(`${s.file}: scene files are named <abbr>-NN-<scene>.html`);
    if (path.dirname(s.file) !== 'compositions') warn(`${s.file}: scenes live in compositions/`);
    if (sceneIds.has(s.id)) err(`${s.file}: duplicate composition id ${s.id}`);
    sceneIds.add(s.id);
    if (!s.root) err(`${s.file}: no root element with data-composition-id="${s.id}" (it must equal the host's id)`);
    if (s.start < -EPS || s.start + s.duration > duration + EPS) err(`${s.id}: host window ${s.start}-${s.start + s.duration} s leaves the ${duration} s root`);
    if (s.root && Math.abs(Number(s.root['data-duration']) - s.duration) > EPS) err(`${s.file}: root data-duration ${s.root['data-duration']} differs from the host's ${s.duration}`);
  }

  // -- per-file rules
  const files = sourceFiles(dir, scenes);
  for (const rel of files) {
    const html = readFileSync(path.join(dir, rel), 'utf8');
    const isRoot = rel === 'index.html';
    const cid = isRoot ? id : scenes.find(s => s.file === rel)?.id;
    const scripts = extractScripts(html);
    const code = scripts.join('\n');
    const codeNoComments = stripJsComments(code);

    if (!isRoot) {
      const templates = (html.match(/<template\b/gi) ?? []).length;
      if (templates !== 1) err(`${rel}: expected exactly one <template>, found ${templates}`);
    }

    // timelines
    const tlCount = (codeNoComments.match(/gsap\.timeline\s*\(/g) ?? []).length;
    if (tlCount !== 1) err(`${rel}: expected exactly one gsap.timeline(), found ${tlCount}`);
    if (tlCount && !/gsap\.timeline\s*\(\s*\{[^}]*paused\s*:\s*true/.test(codeNoComments)) err(`${rel}: the timeline must be created with { paused: true }`);
    if (!/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\s*\}/.test(codeNoComments)) err(`${rel}: missing the guard "window.__timelines = window.__timelines || {};" (required for @hyperframes/player)`);
    const reg = new RegExp(`window\\.__timelines\\[\\s*["']${cid}["']\\s*\\]\\s*=`);
    const regMatch = reg.exec(codeNoComments);
    if (!regMatch) err(`${rel}: the timeline must be registered as window.__timelines["${cid}"] (the composition id)`);
    else if (!isRoot) {
      const lastTween = Math.max(-1, ...tweenCalls(code).map(c => c.end));
      if (lastTween > regMatch.index) err(`${rel}: the timeline must be registered after the last tween (register last)`);
    }
    if (/\.play\s*\(/.test(codeNoComments)) err(`${rel}: never call play(); the renderer seeks the timeline`);

    // tweens
    for (const call of tweenCalls(code)) {
      if (call.owner === 'gsap' && call.method === 'timeline') continue;
      if (call.method === 'add' || call.method === 'timeline') {
        if (!(call.owner === 'tl' && call.method === 'add' && /^["']/.test(call.args[0] ?? ''))) err(`${rel}: ${call.owner}.${call.method}() is not allowed (do not nest timelines; use fromTo with positions)`);
        continue;
      }
      if (call.method !== 'fromTo') {
        err(`${rel}: ${call.owner}.${call.method}() is not allowed, use fromTo with explicit start values`);
        continue;
      }
      if (call.owner !== 'tl') err(`${rel}: tweens must be added to the composition's timeline (tl.fromTo), not gsap.fromTo`);
      if (call.vars.length !== 2) err(`${rel}: fromTo needs a from object and a to object: ${call.args.join(', ').slice(0, 80)}`);
      for (const k of call.keys) {
        if (!ANIMATABLE.has(k) && !TWEEN_CONTROLS.has(k) && !k.startsWith('--')) {
          err(`${rel}: "${k}" is not animatable in this course (allowed: transforms, opacity, colours, strokeDashoffset). In: ${call.args[0]}`);
        }
      }
      if (/repeat\s*:\s*-/.test(call.vars.join(' '))) err(`${rel}: repeat must be finite (never -1)`);
    }

    // determinism
    const ban = [
      [/\bMath\.random\b/, 'Math.random'], [/\bDate\.now\b|\bnew Date\b/, 'Date'], [/\bperformance\.now\b/, 'performance.now'],
      [/\brequestAnimationFrame\b/, 'requestAnimationFrame'], [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
      [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/, 'network calls'], [/\baddEventListener\b/, 'event listeners'],
    ];
    for (const [re, label] of ban) if (re.test(codeNoComments)) err(`${rel}: ${label} is banned (animation state must be a pure function of time)`);
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    const urls = [...new Set([...markup.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map(m => m[0]))];
    for (const u of urls) err(`${rel}: external URL ${u} (no network or CDN at render time)`);
    for (const css of extractStyles(html)) {
      if (/(^|[;{\s])transition\s*:|transition-property|@keyframes|(^|[;{\s])animation(-name)?\s*:/.test(css)) err(`${rel}: CSS transitions and keyframe animations are banned; use the GSAP timeline`);
      for (const { px, decl } of cssFontSizes(css)) if (px < 24) err(`${rel}: text smaller than 24 px (${decl})`);
    }
    for (const rule of html.matchAll(/style="([^"]*)"/g)) {
      for (const { px, decl } of cssFontSizes(rule[1])) if (px < 24) err(`${rel}: text smaller than 24 px in an inline style (${decl})`);
    }
    // type
    for (const [ch, cp] of uncoveredGlyphs(html)) err(`${rel}: the character "${ch}" (${cp}) is not in the shipped font subsets and would fall back to a system font. Draw it as SVG or use ASCII`);
  }

  // -- steps
  if (!steps.length) err('no steps: put data-steps=\'{"key":{"label","start","end"}}\' on each scene root');
  const keys = new Set();
  steps.forEach((s, i) => {
    if (keys.has(s.key)) err(`duplicate step key "${s.key}"`);
    keys.add(s.key);
    if (!/^[a-z][a-z0-9-]*$/.test(s.key)) err(`step key "${s.key}" must be lowercase kebab-case`);
    if (!(s.end > s.time)) err(`step "${s.key}": end ${s.end} must be after time ${s.time}`);
    const scene = scenes.find(sc => sc.id === s.scene);
    if (scene && s.end > scene.start + scene.duration + EPS) err(`step "${s.key}": end ${s.end} is after its scene ends (${scene.start + scene.duration})`);
    if (i > 0 && s.time < steps[i - 1].end - EPS) err(`step "${s.key}" starts (${s.time}) before "${steps[i - 1].key}" ends (${steps[i - 1].end})`);
  });
  if (steps.length && steps[0].time > EPS) warn(`the first step "${steps[0].key}" starts at ${steps[0].time} s, not 0`);
  for (const s of scenes) {
    const html = readFileSync(path.join(dir, s.file), 'utf8');
    for (const st of steps.filter(x => x.scene === s.id)) {
      if (!new RegExp(`addLabel\\(\\s*["']${st.key}["']`).test(html)) err(`${s.file}: no tl.addLabel("${st.key}", ...) for step "${st.key}" (labels mirror data-steps)`);
    }
  }

  // -- rail mirror (the persistent step rail declares the global times; it must match the scenes)
  const railTag = scenes.map(s => ({ s, html: readFileSync(path.join(dir, s.file), 'utf8') })).flatMap(({ s, html }) => findTags(html, 'data-rail-steps').map(t => ({ s, t })))[0];
  if (railTag) {
    let rail;
    try {
      rail = JSON.parse(railTag.t['data-rail-steps'].replace(/&quot;/g, '"'));
    } catch (e) {
      err(`${railTag.s.file}: data-rail-steps is not valid JSON (${e.message})`);
    }
    if (rail) {
      const rk = Object.keys(rail);
      const sk = steps.map(s => s.key);
      if (JSON.stringify(rk) !== JSON.stringify(sk)) err(`${railTag.s.file}: rail steps [${rk}] differ from the scenes' steps [${sk}]`);
      for (const s of steps) {
        const r = rail[s.key];
        if (!r) continue;
        if (Math.abs(r.start - s.time) > EPS || Math.abs(r.end - s.end) > EPS) err(`${railTag.s.file}: rail "${s.key}" is ${r.start}-${r.end} but the scene says ${s.time}-${s.end}`);
        if (r.label !== s.label) err(`${railTag.s.file}: rail label "${r.label}" differs from the scene label "${s.label}" for "${s.key}"`);
      }
    }
  } else warn('no data-rail-steps found: is there a step rail?');

  // -- motion sidecar
  const motionFile = path.join(dir, 'index.motion.json');
  if (!existsSync(motionFile)) err('index.motion.json is missing (appearsBy per step)');
  else {
    let motion;
    try {
      motion = JSON.parse(readFileSync(motionFile, 'utf8'));
    } catch (e) {
      err(`index.motion.json is not valid JSON (${e.message})`);
    }
    if (motion) {
      if (motion.duration !== undefined && Math.abs(motion.duration - duration) > EPS) err(`index.motion.json: duration ${motion.duration} differs from the root's ${duration}`);
      const appears = (motion.assertions ?? []).filter(a => a.kind === 'appearsBy');
      for (const st of steps) {
        if (!appears.some(a => a.bySec >= st.time - EPS && a.bySec <= st.end + EPS)) err(`index.motion.json: no appearsBy assertion falls inside step "${st.key}" (${st.time}-${st.end} s)`);
      }
      for (const a of motion.assertions ?? []) {
        for (const sel of [a.selector, a.a, a.b, a.withinSelector].filter(Boolean)) {
          if (!/^#[A-Za-z][\w-]*$/.test(sel)) warn(`index.motion.json: selector "${sel}" should be a single #id (class selectors match several elements)`);
        }
        if (a.bySec !== undefined && a.bySec > duration) err(`index.motion.json: ${a.selector} bySec ${a.bySec} is after the end (${duration} s)`);
      }
    }
  }

  // -- animation.json and captions
  try {
    const meta = readAnimationMeta(id, dir);
    if (meta.id !== id) err(`animation.json: id "${meta.id}" must equal the directory name "${id}"`);
    for (const k of ['title', 'lesson', 'platform', 'description']) if (!meta[k] || typeof meta[k] !== 'string') err(`animation.json: "${k}" is required`);
    if (meta.posterAt !== undefined && !(meta.posterAt >= 0 && meta.posterAt < duration)) err(`animation.json: posterAt ${meta.posterAt} is outside 0-${duration}`);
  } catch (e) {
    err(e.message);
  }
  try {
    const cues = readCaptions(id, dir);
    if (!Array.isArray(cues) || !cues.length) err('captions.json must be a non-empty array of { start, end, text, step? }');
    else {
      cues.forEach((c, i) => {
        if (typeof c.text !== 'string' || !c.text.trim()) err(`captions.json[${i}]: empty text`);
        if (!(c.end > c.start) || c.start < 0 || c.end > duration + EPS) err(`captions.json[${i}]: bad timing ${c.start}-${c.end} (video is ${duration} s)`);
        if (i > 0 && c.start < cues[i - 1].end - EPS) err(`captions.json[${i}]: starts before the previous cue ends`);
        const cps = c.text.length / Math.max(0.001, c.end - c.start);
        if (cps > 22) warn(`captions.json[${i}]: ${cps.toFixed(1)} characters per second is fast to read (aim for <= 22)`);
        if (c.text.length > 220) warn(`captions.json[${i}]: ${c.text.length} characters is long for one cue`);
        if (c.step && !keys.has(c.step)) err(`captions.json[${i}]: step "${c.step}" does not exist`);
        if (c.step) {
          const st = steps.find(x => x.key === c.step);
          if (st && (c.start < st.time - EPS || c.end > st.end + 0.55 + EPS)) warn(`captions.json[${i}]: ${c.start}-${c.end} s leaves step "${c.step}" (${st.time}-${st.end} s)`);
        }
      });
      for (const st of steps) if (!cues.some(c => c.step === st.key)) err(`captions.json: no cue for step "${st.key}"`);
    }
  } catch (e) {
    err(e.message);
  }

  return { errors, warnings, info: { steps: steps.map(s => ({ ...s, time: round3(s.time) })), duration } };
}
