// Unit tests for the animation pipeline helpers and the static validator.
// The validator tests copy the real A1 project to a temp directory, break one rule at a time and expect the matching error,
// so a rule that stops biting fails here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANIM_DIR, RENDER_FLAGS, checkFreshness, findTags, listFiles, outputHashes, readAttrs, readProject, sha256, sourceHash, syncShared,
  toTranscript, toVtt, vttTime,
} from './lib.mjs';
import {
  ANIMATABLE, cssFontSizes, inFontSubset, objectKeys, stripJsComments, tweenCalls, uncoveredGlyphs, validateProject, visibleText,
} from './validate.mjs';
import { sampleTimes } from './check.mjs';
import { indexSnapshots, parseArgs } from './render.mjs';

const ID = 'a01-press-run';
const SRC = path.join(ANIM_DIR, ID);
let tmpRoot: string;

beforeAll(() => {
  syncShared(ID); // vendor/ and assets/fonts/ are gitignored copies
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'anim-test-'));
});
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

/** Copies A1 into a fresh temp dir (under the project's own id) and returns the path. */
function copyProject(label: string): string {
  const dir = path.join(tmpRoot, label, ID);
  mkdirSync(path.dirname(dir), { recursive: true });
  cpSync(SRC, dir, { recursive: true, filter: s => !/[\\/](\.hyperframes|renders)([\\/]|$)/.test(s) });
  return dir;
}

function validateMutated(label: string, file: string, mutate: (text: string) => string) {
  const dir = copyProject(label);
  const f = path.join(dir, file);
  const before = readFileSync(f, 'utf8');
  const after = mutate(before);
  expect(after, `mutation for "${label}" did not change ${file}`).not.toBe(before);
  writeFileSync(f, after);
  return validateProject(ID, { dir });
}

describe('lib: formats', () => {
  it('formats WebVTT timestamps', () => {
    expect(vttTime(0)).toBe('00:00:00.000');
    expect(vttTime(5.45)).toBe('00:00:05.450');
    expect(vttTime(3661.0004)).toBe('01:01:01.000');
  });

  it('writes a valid WebVTT file and escapes markup characters', () => {
    const vtt = toVtt([
      { start: 0.4, end: 5.4, text: 'You press Run.' },
      { start: 6, end: 7.5, text: 'A < B & C > D' },
    ]);
    expect(vtt).toBe('WEBVTT\n\n00:00:00.400 --> 00:00:05.400\nYou press Run.\n\n00:00:06.000 --> 00:00:07.500\nA &lt; B &amp; C &gt; D\n');
  });

  it('writes a transcript with step headings', () => {
    const t = toTranscript([{ start: 0, end: 1, text: 'One.', step: 'a' }, { start: 1, end: 2, text: 'Two.' }], [{ key: 'a', label: 'Alpha' }]);
    expect(t).toBe('Alpha\nOne.\n\nTwo.\n');
  });

  it('reads attributes in either quote style, with entities left alone', () => {
    const a = readAttrs(`<div id="x" data-steps='{"a":{"start":0}}' data-flag class="c d">`);
    expect(a).toMatchObject({ id: 'x', 'data-steps': '{"a":{"start":0}}', 'data-flag': '', class: 'c d' });
    const tags = findTags('<p data-a="1"></p><div data-a="2" data-b></div><span></span>', 'data-a');
    expect(tags.map(t => t._tag)).toEqual(['p', 'div']);
  });

  it('picks indexed snapshot frames by the time in the file name', () => {
    const dir = mkdtempSync(path.join(tmpRoot, 'snap-'));
    for (const n of ['frame-00-at-0.4s.png', 'frame-01-at-16.45s.png', 'contact-sheet.jpg', 'frame-02-at-44s.png']) writeFileSync(path.join(dir, n), '');
    expect(indexSnapshots(dir).map(f => f.t).sort((a, b) => a - b)).toEqual([0.4, 16.45, 44]);
  });
});

describe('lib: project reading', () => {
  it('derives global step times from the host windows and the scenes\' data-steps', () => {
    const p = readProject(ID);
    expect(p).toMatchObject({ compositionId: ID, duration: 45, width: 1920, height: 1080, fps: 30 });
    expect(p.steps.map(s => s.key)).toEqual(['source', 'compile', 'link', 'run', 'output', 'native']);
    expect(p.steps.map(s => s.time)).toEqual([0, 6, 17, 23, 31, 37]);
    expect(p.steps.map(s => s.end)).toEqual([5.45, 16.45, 22.45, 30.45, 36.45, 44.45]);
    expect(p.steps.map(s => s.label)).toEqual(['Source', 'Compile', 'Link', 'Run', 'Output', 'Native']);
  });

  it('chooses check samples at every step end and midpoint', () => {
    expect(sampleTimes([{ time: 0, end: 4 }, { time: 6, end: 10 }])).toEqual([2, 4, 8, 10]);
  });
});

describe('lib: hashing and freshness', () => {
  it('computes SHA-256 hex digests', () => {
    expect(sha256('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });

  it('lists project files without tool output and hashes them deterministically', () => {
    const dir = copyProject('hash');
    mkdirSync(path.join(dir, '.hyperframes'), { recursive: true });
    writeFileSync(path.join(dir, '.hyperframes', 'junk.json'), '{}');
    mkdirSync(path.join(dir, 'renders'), { recursive: true });
    writeFileSync(path.join(dir, 'renders', 'x.mp4'), 'x');
    const files = listFiles(dir);
    expect(files).toContain('index.html');
    expect(files.some(f => f.startsWith('.hyperframes') || f.startsWith('renders'))).toBe(false);
    const h1 = sourceHash(dir);
    expect(sourceHash(dir)).toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a source file, the CLI version, the flags or the pipeline version change', () => {
    const dir = copyProject('hash2');
    const base = sourceHash(dir);
    expect(sourceHash(dir, { hfVersion: '0.0.0' })).not.toBe(base);
    expect(sourceHash(dir, { flags: [...RENDER_FLAGS, '--workers', '1'] })).not.toBe(base);
    expect(sourceHash(dir, { pipeline: 999 })).not.toBe(base);
    const f = path.join(dir, 'compositions', 'pr-00-bg.html');
    writeFileSync(f, readFileSync(f, 'utf8') + '\n<!-- touched -->\n');
    expect(sourceHash(dir)).not.toBe(base);
  });

  it('flags stale, altered, missing and unexpected render outputs', () => {
    const dir = copyProject('fresh');
    const out = path.join(tmpRoot, 'fresh-out');
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, `${ID}.mp4`), 'video');
    writeFileSync(path.join(out, 'steps.json'), '{}');
    const manifest = { version: 1, renderer: {}, animations: { [ID]: { sourceHash: sourceHash(dir), browser: 'x', outputs: outputHashes(ID, out) } } };
    expect(checkFreshness(ID, { manifest, dir, outDir: out })).toEqual({ ok: true, problems: [] });

    writeFileSync(path.join(out, 'steps.json'), '{"edited":true}');
    expect(checkFreshness(ID, { manifest, dir, outDir: out }).problems.join('\n')).toMatch(/steps\.json differs/);
    writeFileSync(path.join(out, 'steps.json'), '{}');

    writeFileSync(path.join(out, 'extra.txt'), 'x');
    expect(checkFreshness(ID, { manifest, dir, outDir: out }).problems.join('\n')).toMatch(/unexpected file .*extra\.txt/);
    rmSync(path.join(out, 'extra.txt'));

    rmSync(path.join(out, `${ID}.mp4`));
    expect(checkFreshness(ID, { manifest, dir, outDir: out }).problems.join('\n')).toMatch(/a01-press-run\.mp4 is missing/);
    writeFileSync(path.join(out, `${ID}.mp4`), 'video');

    writeFileSync(path.join(dir, 'captions.json'), '[]');
    const stale = checkFreshness(ID, { manifest, dir, outDir: out });
    expect(stale.ok).toBe(false);
    expect(stale.problems[0]).toMatch(/STALE/);

    expect(checkFreshness('a99-none', { manifest }).problems[0]).toMatch(/never rendered/);
  });
});

describe('validate: building blocks', () => {
  it('knows which characters the font subsets cover', () => {
    for (const ch of 'Aa0 ~·×—…’“”•↑↓') expect(inFontSubset(ch.codePointAt(0)!), ch).toBe(true);
    for (const ch of '→≈✓≥≤⚠') expect(inFontSubset(ch.codePointAt(0)!), ch).toBe(false);
  });

  it('finds uncovered glyphs in text, entities and attributes-free text only', () => {
    expect(uncoveredGlyphs('<p>a &rarr; b</p>')).toEqual([['→', 'U+2192']]);
    expect(uncoveredGlyphs('<p>ok &middot; fine</p><!-- → in a comment --><script>var s = "→";</script>')).toEqual([]);
    expect(visibleText('<b>x</b>&amp;<i>y</i>').replace(/\s+/g, '')).toBe('x&y');
  });

  it('reads pixel font sizes from font-size and the font shorthand', () => {
    const css = `.a { font-size: 20px; } .b { font: 700 18px/1.2 var(--font-mono); } .c { font: 400 var(--s, 38px)/56px x; --code-size: 22px; } .d { font-size: max(24px, 0.74em); } .e { font-size: 0.8em; }`;
    expect(cssFontSizes(css).map(x => x.px)).toEqual([20, 24, 18, 22]);
  });

  it('parses tween calls and their property keys', () => {
    const js = `
      // tl.to("#ignored", { width: 1 });
      tl.fromTo("#a", { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.1);
      tl.fromTo(sel + " .d", { strokeDashoffset: 1 }, { strokeDashoffset: 0, "--hue": 3 }, at);
      tl.to("#b", { width: 10 });
    `;
    const calls = tweenCalls(js);
    expect(calls.map(c => c.method)).toEqual(['fromTo', 'fromTo', 'to']);
    expect(calls[0].keys).toEqual(['opacity', 'y', 'opacity', 'y', 'duration', 'ease']);
    expect(calls[1].keys).toContain('--hue');
    expect(calls[2].keys).toEqual(['width']);
    expect(stripJsComments('a // c\nb /* d */ "x//y"')).toBe('a \nb  "x//y"');
    expect(objectKeys('{ a: 1, "b-c": { d: 2 }, e: f(1, 2) }')).toEqual(['a', 'b-c', 'e']);
    expect(ANIMATABLE.has('width')).toBe(false);
    expect(ANIMATABLE.has('strokeDashoffset')).toBe(true);
  });
});

describe('validate: the A1 project', () => {
  it('passes with no errors and no warnings', () => {
    const r = validateProject(ID);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  const scene = 'compositions/pr-02-compile.html';
  const cases: Array<[string, string, (t: string) => string, RegExp]> = [
    ['to() instead of fromTo', scene, t => t.replace('tl.addLabel("compile", S.compile.start);', 'tl.addLabel("compile", S.compile.start);\n      tl.to("#pr02-title", { opacity: 1 }, 0);'), /tl\.to\(\) is not allowed/],
    ['layout property', scene, t => t.replace('{ opacity: 1, y: 0, duration: 0.6 }, 0.1);', '{ opacity: 1, width: 400, duration: 0.6 }, 0.1);'), /"width" is not animatable/],
    ['delay', scene, t => t.replace('{ opacity: 1, y: 0, duration: 0.6 }, 0.1);', '{ opacity: 1, y: 0, delay: 1, duration: 0.6 }, 0.1);'), /"delay" is not animatable/],
    ['callback', scene, t => t.replace('{ opacity: 1, y: 0, duration: 0.6 }, 0.1);', '{ opacity: 1, y: 0, onComplete: function () {}, duration: 0.6 }, 0.1);'), /"onComplete" is not animatable/],
    ['infinite repeat', scene, t => t.replace('yoyo: true, repeat: 1, immediateRender: false }, 8.9);', 'yoyo: true, repeat: -1, immediateRender: false }, 8.9);'), /repeat must be finite/],
    ['Math.random', scene, t => t.replace('var D = 11;', 'var D = 11; var r = Math.random();'), /Math\.random is banned/],
    ['setTimeout', scene, t => t.replace('var D = 11;', 'var D = 11; setTimeout(function () {}, 1);'), /timers is banned/],
    ['play()', scene, t => t.replace('window.__timelines = window.__timelines || {};', 'tl.play();\n      window.__timelines = window.__timelines || {};'), /never call play/],
    ['missing guard', scene, t => t.replace('window.__timelines = window.__timelines || {};', ''), /missing the guard/],
    ['registered before the last tween', scene, t => t.replace('      window.__timelines["pr-02-compile"] = tl;\n', '').replace('      tl.fromTo("#pr02-stage"', '      window.__timelines["pr-02-compile"] = tl;\n      tl.fromTo("#pr02-stage"'), /register last/],
    ['wrong registry key', scene, t => t.replace('window.__timelines["pr-02-compile"] = tl;', 'window.__timelines["pr-02-typo"] = tl;'), /must be registered as window\.__timelines\["pr-02-compile"\]/],
    ['second timeline', scene, t => t.replace('var D = 11;', 'var D = 11; var extra = gsap.timeline({ paused: true });'), /exactly one gsap\.timeline/],
    ['unpaused timeline', scene, t => t.replace('gsap.timeline({ paused: true, defaults', 'gsap.timeline({ defaults'), /paused: true/],
    ['arrow glyph', scene, t => t.replace('Compiler messages.', 'Compiler messages →'), /"→" \(U\+2192\) is not in the shipped font subsets/],
    ['arrow entity', scene, t => t.replace('Compiler messages.', 'Compiler messages &rarr;'), /U\+2192/],
    ['small code size variable', scene, t => t.replace('--code-size: 28px;', '--code-size: 22px;'), /smaller than 24 px \(--code-size: 22px\)/],
    ['small text', scene, t => t.replace('#pr02-note { font: 400 28px/1.25', '#pr02-note { font: 400 20px/1.25'), /smaller than 24 px/],
    ['css transition', scene, t => t.replace('#root { position: absolute; inset: 0; }', '#root { position: absolute; inset: 0; transition: opacity 1s; }'), /CSS transitions and keyframe animations are banned/],
    ['CDN script', 'index.html', t => t.replace('<script src="vendor/gsap.min.js"></script>', '<script src="vendor/gsap.min.js"></script>\n    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>'), /external URL https:\/\/cdn\.jsdelivr\.net/],
    ['wrong canvas', 'index.html', t => t.replace('data-duration="45" data-width="1920" data-height="1080">', 'data-duration="45" data-width="1280" data-height="720">'), /every animation is 1920x1080/],
    ['host/root id mismatch', 'index.html', t => t.replace('data-composition-id="a01-press-run"', 'data-composition-id="a01-typo"'), /expected "a01-press-run"/],
    ['scene past the end', 'index.html', t => t.replace('data-start="37" data-duration="8"', 'data-start="37" data-duration="9"'), /leaves the 45 s root/],
    ['rail drift', 'compositions/pr-00-rail.html', t => t.replace('"compile":{"label":"Compile","start":6,"end":16.45}', '"compile":{"label":"Compile","start":6,"end":16.5}'), /rail "compile" is 6-16\.5/],
    ['label missing', scene, t => t.replace('tl.addLabel("compile", S.compile.start);', ''), /no tl\.addLabel\("compile"/],
    ['step end before time', scene, t => t.replace('"end":10.45', '"end":0'), /must be after time/],
    ['missing cue', 'captions.json', t => t.replace('"step": "link"', '"step": "linkx"'), /does not exist|no cue for step "link"/],
    ['overlapping cues', 'captions.json', t => t.replace('"start": 6.3', '"start": 5.0'), /starts before the previous cue ends/],
    ['cue beyond the video', 'captions.json', t => t.replace('"end": 44.8', '"end": 46'), /bad timing/],
    ['no appearsBy in a step', 'index.motion.json', t => t.replace(/\{ "kind": "appearsBy", "selector": "#pr06-[^}]*\},?\n/g, ''), /no appearsBy assertion falls inside step "native"/],
    ['bad meta', 'animation.json', t => t.replace('"lesson": "1.1"', '"lesson": ""'), /"lesson" is required/],
  ];
  for (const [name, file, mutate, expected] of cases) {
    it(`rejects: ${name}`, () => {
      const r = validateMutated(name.replace(/\W+/g, '-'), file, mutate);
      expect(r.errors.join('\n')).toMatch(expected);
    });
  }

  it('warns, but does not fail, on fast captions', () => {
    const r = validateMutated('fast-captions', 'captions.json', t => t.replace('"end": 5.4', '"end": 1.4'));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/characters per second is fast/);
  });
});

describe('render: argument parsing (#111)', () => {
  it('keeps an id that comes before the flags', () => {
    expect(parseArgs(['a02', '--force']).ids).toEqual(['a02']);
  });
  it('keeps an id that comes after the flags', () => {
    expect(parseArgs(['--force', 'a02']).ids).toEqual(['a02']);
  });
  it('keeps a lone id', () => {
    expect(parseArgs(['a02']).ids).toEqual(['a02']);
  });
  it('treats the argument after --webm as its directory, not an id', () => {
    const r = parseArgs(['--webm', 'dist/animations']);
    expect(r.ids).toEqual([]);
    expect(r.webmDir).toBe('dist/animations');
  });
  it('keeps an id before --webm', () => {
    const r = parseArgs(['a01', '--webm', 'out']);
    expect(r.ids).toEqual(['a01']);
    expect(r.webmDir).toBe('out');
  });
  it('collects the flags', () => {
    const r = parseArgs(['a01', '--force', '--dry-run']);
    expect([...r.flags]).toEqual(['--force', '--dry-run']);
    expect(r.webmDir).toBeNull();
  });
  it('gives no ids, no flags and no --webm dir for no arguments', () => {
    const r = parseArgs([]);
    expect(r.ids).toEqual([]);
    expect([...r.flags]).toEqual([]);
    expect(r.webmDir).toBeNull();
  });
  it('rejects an unknown flag, listing the valid ones', () => {
    expect(() => parseArgs(['--dryrun', 'a01'])).toThrow('unknown flag --dryrun; valid flags: --force, --dry-run, --webm');
    expect(() => parseArgs(['--webm=out', 'a01'])).toThrow('unknown flag --webm=out; valid flags: --force, --dry-run, --webm');
  });
  it('rejects a second --webm instead of taking its directory as an id', () => {
    expect(() => parseArgs(['--webm', 'out', '--webm', 'other'])).toThrow('--webm can be given only once');
  });
  it('rejects --webm without a directory', () => {
    expect(() => parseArgs(['--webm'])).toThrow('--webm needs an output directory');
    expect(() => parseArgs(['--webm', '--force'])).toThrow('--webm needs an output directory');
  });
});

describe('render: the CLI rejects bad arguments with one line, before rendering anything', () => {
  const RENDER = fileURLToPath(new URL('./render.mjs', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [RENDER, ...args], { encoding: 'utf8', timeout: 30_000 });
  it('an unknown id names the id and the valid ids, and exits 2', () => {
    const r = run('zz9', '--dry-run');
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stderr).toMatch(/^render\.mjs: Unknown animation\(s\): zz9\. Known: a01-press-run, /);
  });
  it('an unknown flag lists the valid flags, and exits 2', () => {
    const r = run('a01', '--dryrun');
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('render.mjs: unknown flag --dryrun; valid flags: --force, --dry-run, --webm\n');
  });
});
