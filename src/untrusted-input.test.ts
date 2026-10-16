// Untrusted-input audit (issue #7): hostile input for the paths where user-controlled text or JSON
// enters the app. Expected values come from the real code (encode*, migrate, buildProjectZip), never retyped.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { MiniMarkdown } from './components/MiniMarkdown';
import { embedSrc } from './components/youtube-embed';
import { emptyProgress, MAX_IMPORT_BYTES, mergeProgress, migrate, parseProgressFile, summarise, type ProgressV1 } from './progress/store';
import { buildProjectZip, buildZipFromFolder, projectZipEntries, zipFolderName, type ProjectZipInput } from './testing/project-zip';
import { encodeCompletionToken, encodeProgressCode, formatCode, parseCode, verifyCode } from './testing/token';
import type { TestsSpec } from './content-model/types';

const SEED = '0123456789abcdef';
const at = '2026-01-01T00:00:00.000Z';
const hostile = (json: string) => JSON.parse(json) as unknown; // JSON.parse makes "__proto__" an own key, as an imported file would

function protoClean() {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
}

describe('progress import: migrate', () => {
  const head = `"version":1,"seed":"${SEED}","createdAt":"${at}"`;

  it('does not let __proto__ / constructor keys change any prototype', () => {
    const p = migrate(hostile(`{${head},"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},
      "exercises":{"__proto__":{"attempts":9,"polluted":1},"constructor":{"attempts":2}},
      "cards":{"__proto__":[1,2]},"lessons":{"__proto__":{"completedAt":"x"}},
      "settings":{"__proto__":{"polluted":1}}}`));
    protoClean();
    for (const sec of [p.cards, p.lessons, p.exercises, p.samples, p.quizzes, p.projects, p.settings]) expect(Object.getPrototypeOf(sec)).toBe(Object.prototype);
    expect(Object.keys(p.exercises)).toEqual(['constructor']);
    expect(Object.keys(p)).not.toContain('__proto__');
    expect(Object.keys(p.cards)).toEqual([]);
  });

  it('replaces known fields that are not objects with empty ones', () => {
    for (const bad of ['"abc"', '5', 'null', 'true', '[1,2]', '[]']) {
      const p = migrate(hostile(`{${head},"cards":${bad},"lessons":${bad},"samples":${bad},"exercises":${bad},"quizzes":${bad},"projects":${bad},"settings":${bad}}`));
      expect(p.cards).toEqual({});
      expect(p.lessons).toEqual({});
      expect(p.exercises).toEqual({});
      expect(p.settings).toEqual({});
      expect(() => summarise(p)).not.toThrow();
    }
  });

  it('drops wrong-typed entries so summarise and mergeProgress cannot throw on them', () => {
    const p = migrate(hostile(`{${head},
      "cards":{"a":"xyz","b":[1,"2"],"c":[-1],"d":[1.5],"ok":[3,1]},
      "lessons":{"a":null,"b":5,"c":{"completedAt":7},"ok":{"completedAt":"${at}"}},
      "exercises":{"a":null,"b":"s","c":{"attempts":"many","passed":"yes","codes":"TDCC1","hintsViewed":null},"d":{"attempts":3,"passed":true}},
      "quizzes":{"a":7,"b:checkpoint":{"score":"1","total":2,"passed":true,"at":"${at}"}},
      "projects":{"a":[],"b":{"passed":"true"}},
      "samples":{"a":{"prediction":1}}}`));
    expect(p.cards).toEqual({ ok: [3, 1] });
    expect(Object.keys(p.lessons)).toEqual(['ok']);
    expect(Object.keys(p.exercises).sort()).toEqual(['c', 'd']);
    expect(p.exercises.c.attempts).toBe(0);
    expect(p.exercises.c.passed).toBe(false);
    expect(p.exercises.c.codes).toBeUndefined();
    expect(p.exercises.d.passed).toBe(true);
    expect(p.quizzes).toEqual({});
    expect(p.projects).toEqual({});
    expect(p.samples).toEqual({});
    const s = summarise(p);
    expect(s.exercisesPassed).toBe(1);
    expect(() => mergeProgress(emptyProgress(), p)).not.toThrow();
  });

  it('ignores unknown top-level keys and bad settings values', () => {
    const p = migrate(hostile(`{${head},"evil":"<script>","settings":{"platform":"amiga","stdinMode":{"a":1},"storedOutputMode":"yes","x":1}}`));
    expect(Object.keys(p).sort()).toEqual(['cards', 'createdAt', 'exercises', 'lessons', 'projects', 'quizzes', 'samples', 'seed', 'settings', 'version']);
    expect(p.settings).toEqual({});
  });

  it('rejects non-objects, bad versions and bad seeds', () => {
    for (const raw of [null, 5, 'x', [], [1]]) expect(() => migrate(raw)).toThrow();
    expect(() => migrate({ version: 2, seed: SEED })).toThrow(/version/);
    for (const seed of ['', 'ABCDEF0123456789', `${SEED}0`, 7, null, '../../etc/passwd']) expect(() => migrate({ version: 1, seed })).toThrow(/seed/);
  });

  it('keeps a very large (but under the cap) document and stays fast', () => {
    const exercises: Record<string, unknown> = {};
    for (let i = 0; i < 20000; i++) exercises[`e${i}`] = { attempts: i, passed: i % 2 === 0, code: 'x'.repeat(50) };
    const text = JSON.stringify({ version: 1, seed: SEED, createdAt: at, exercises });
    const t0 = performance.now();
    const p = parseProgressFile(text);
    expect(Object.keys(p.exercises)).toHaveLength(20000);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('refuses a document over the size cap, and text that is not JSON', () => {
    expect(() => parseProgressFile('x'.repeat(MAX_IMPORT_BYTES + 1))).toThrow(/too large/);
    expect(() => parseProgressFile('{"version":1,')).toThrow(/not valid JSON/);
    expect(() => parseProgressFile('')).toThrow();
  });
});

describe('progress import: mergeProgress', () => {
  it('merging a hostile (migrated) file changes no prototype and keeps both sides', () => {
    const mine: ProgressV1 = { ...emptyProgress(), seed: SEED, exercises: { a: { attempts: 1, substantive: 0, activeMs: 0, hintsViewed: 0, passed: false, solutionViewed: false, mastered: false } } };
    const theirs = migrate(hostile(`{"version":1,"seed":"${SEED}","createdAt":"${at}","cards":{"__proto__":[7]},"exercises":{"__proto__":{"attempts":99},"a":{"attempts":5,"passed":true}},"lessons":{"__proto__":{"completedAt":"x"}}}`));
    const merged = mergeProgress(mine, theirs);
    protoClean();
    expect(Object.getPrototypeOf(merged.exercises)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(merged.cards)).toBe(Object.prototype);
    expect(merged.exercises.a.attempts).toBe(5);
    expect(merged.exercises.a.passed).toBe(true);
    expect(JSON.parse(JSON.stringify(merged))).toEqual(merged);
  });
});

describe('completion and progress codes', () => {
  const good = { exercise: 'caesar', bits: '0101', run: 3, src: '1a2b3c4d' };

  it('formatCode(parseCode(code)) gives back the canonical code, dropping surrounding text', async () => {
    const code = await encodeProgressCode(good, SEED);
    const done = await encodeCompletionToken({ exercise: 'cash.variants.1' }, SEED);
    for (const c of [code, done]) {
      const parsed = parseCode(`  Here you go:\n"${c.toUpperCase()}" thanks ${'x'.repeat(5000)}`);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatCode(parsed.code)).toBe(c);
    }
  });

  it('rejects malformed, truncated and look-alike input without throwing', () => {
    const inputs = [
      '', ' ', 'TDCC1-', 'TDCC1-R1', 'TDCC1-R1-x', 'TDCC1-Rx-caesar-DONE-12345678', 'TDCC2-R1-caesar-DONE-12345678',
      'TDCC1-R1-caesar-DONE-1234567', 'TDCC1-R1-caesar-DONE-1234567g', 'TDCC1-R1--DONE-12345678', 'TDCC1-R1-.-DONE-12345678',
      'TDCC1-R1-../../x-DONE-12345678', 'TDCC1-R1-caesar-0101-99999999999-1a2b3c4d-12345678', 'TDCC1-R1-caesar-0102-3-1a2b3c4d-12345678',
      'ＴＤＣＣ１-R1-caesar-DONE-12345678', 'TDCC1-R1-caesar-DONE-１２３４５６７８', 'TDCC1\u200b-R1-caesar-DONE-12345678',
      '\u0000TDCC1-R1-caesar-DONE-\u0000', '😀'.repeat(1000), 'TDCC1-' + '😀'.repeat(1000), 'TDCC1-R1-' + '-'.repeat(1000),
    ];
    for (const t of inputs) expect(parseCode(t).ok, JSON.stringify(t.slice(0, 40))).toBe(false);
  });

  it('is linear on oversized input (a megabyte of dashes, dots and letters)', () => {
    for (const filler of ['-', '.', '_', 'a', '-a', 'a-']) {
      const t0 = performance.now();
      const text = 'TDCC1-R1-' + filler.repeat(Math.ceil(1_000_000 / filler.length)) + 'x ';
      parseCode(text);
      parseCode(text.slice(0, -2) + '\n!');
      expect(performance.now() - t0, `filler ${filler}`).toBeLessThan(1000);
    }
  });

  it('verifyCode rejects another learner\'s code, another exercise, and does not throw on junk', async () => {
    const code = await encodeProgressCode(good, SEED);
    expect((await verifyCode(code, SEED, { exercise: 'caesar' })).ok).toBe(true);
    expect(await verifyCode(code, 'fedcba9876543210')).toMatchObject({ ok: false, reason: 'mac' });
    expect(await verifyCode(code, SEED, { exercise: 'cash' })).toMatchObject({ ok: false, reason: 'wrong-exercise' });
    expect(await verifyCode('TDCC1-R7-caesar-DONE-12345678', SEED)).toMatchObject({ ok: false, reason: 'runner-version' });
    expect(await verifyCode('\u202eTDCC1-R1-caesar-DONE-12345678\u202c', SEED)).toMatchObject({ ok: false });
    expect(await verifyCode('x'.repeat(2_000_000), SEED)).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

describe('MiniMarkdown (prompts, hints, explanations)', () => {
  const html = (text: string) => renderToStaticMarkup(createElement(MiniMarkdown, { text }));
  const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map(m => m[1]);

  it('never emits a javascript:, data:, vbscript: or protocol-relative href', () => {
    const urls = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example/x', '&#106;avascript:alert(1)', '%6Aavascript:alert(1)', 'file:///etc/passwd', 'blob:https://x'];
    for (const u of urls) expect(hrefs(html(`[click](${u})`)), u).toEqual(['#']);
    expect(hrefs(html('[a](https://example.com/x) [b](#top) [c](./rel)'))).toEqual(['https://example.com/x', '#top', './rel']);
  });

  it('escapes raw HTML in every block type, and in link text and code', () => {
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const out = html([payload, '', `- ${payload}`, `1. ${payload}`, `**${payload}**`, `[${payload}](https://x.example)`, '`' + payload + '`', '```', payload, '```', '[x](https://a.example"onmouseover="alert(1))'].join('\n'));
    // After removing the tags MiniMarkdown itself makes, no "<" is left: everything else was escaped to text.
    const bare = out.replace(/<\/?(div|p|ul|ol|li|strong|em|code|pre)>/g, '').replace(/<a href="[^"<>]*"( target="_blank")? rel="noreferrer">|<\/a>/g, '');
    expect(bare).not.toContain('<');
    expect(out).not.toMatch(/ onmouseover=/);
    expect(out).toContain('&lt;script&gt;');
  });

  it('survives unbalanced markup, huge input and control characters', () => {
    for (const t of ['**', '`', '[', '[]()', '[a](', '```', '- ', '1. ', '\0\u202e', '*'.repeat(100000), '['.repeat(50000), '`a'.repeat(50000)]) expect(() => html(t)).not.toThrow();
  });
});

describe('YouTube embed parameters', () => {
  it('builds the privacy-enhanced embed URL only from a valid id and integer times', () => {
    const u = new URL(embedSrc({ id: 'SlqjA04_dpk', start: 10, end: 20 })!);
    expect(u.origin).toBe('https://www.youtube-nocookie.com');
    expect(u.pathname).toBe('/embed/SlqjA04_dpk');
    expect([...u.searchParams.keys()].sort()).toEqual(['autoplay', 'end', 'rel', 'start']);
  });

  it('refuses an id or times that could add a path segment or query parameter', () => {
    for (const id of ['', 'short', 'SlqjA04_dpk/../x', 'SlqjA04_dp?', 'SlqjA04_dpk&x=1', 'SlqjA04_dp#', 'SlqjA04_dpk ', '../../watch', 'https://evil.example', 'ＳｌｑｊＡ０４_dpk']) {
      expect(embedSrc({ id, start: 1, end: 2 }), id).toBeNull();
    }
    for (const [start, end] of [[-1, 5], [1.5, 5], [NaN, 5], [5, 1], [0, Infinity], [Number('1e21'), Number('2e21')]]) expect(embedSrc({ id: 'SlqjA04_dpk', start, end })).toBeNull();
  });

  it('every segment in videos.json yields a valid embed URL', () => {
    const videos = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'videos.json'), 'utf8')) as { id: string; start: number; end: number }[];
    expect(videos.length).toBeGreaterThan(0);
    for (const v of videos) expect(embedSrc(v)).not.toBeNull();
  });
});

describe('no raw-HTML sinks in the app', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'generated' ? [] : walk(p);
    return /\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
  it('no source file under src/ uses innerHTML, dangerouslySetInnerHTML, insertAdjacentHTML, document.write, eval or new Function', () => {
    const sink = /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;
    const hits = walk(path.resolve(__dirname)).filter(f => sink.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('project zip file names', () => {
  const spec: TestsSpec = { sources: ['a.c'], checks: [] } as unknown as TestsSpec;
  const input = (files: Record<string, string>, id = 'caesar'): ProjectZipInput => ({ id, spec, files, checkMjs: '//', learncH: '//' });

  it('rejects traversal, absolute, drive-letter, empty and dot segments and control characters in file paths', () => {
    const bad = ['../x.c', 'a/../../x.c', '..\\x.c', 'a\\..\\..\\x.c', '/etc/passwd', '\\\\server\\share', 'C:\\x.c', 'c:x.c', 'a//b.c', 'a/./b.c', './', '', '.', 'a/', 'a\0b.c', 'a\nb.c', 'tests/..'];
    for (const p of bad) expect(() => projectZipEntries(input({ [p]: 'x' })), JSON.stringify(p)).toThrow(/unsafe path/);
  });

  it('accepts ordinary and Unicode file names, and the zip contains only entries under one folder', () => {
    const files = { 'a.c': 'x', 'tests/t.c': 'y', 'données-ü.txt': 'z', 'my file (1).c': 'w' };
    const zip = unzipSync(buildProjectZip(input(files)));
    const names = Object.keys(zip);
    expect(names.length).toBeGreaterThan(Object.keys(files).length);
    for (const n of names) {
      expect(n.startsWith('caesar/')).toBe(true);
      expect(n.split('/')).not.toContain('..');
    }
    expect(strFromU8(zip['caesar/tests/t.c'])).toBe('y');
  });

  it('rejects a folder id that is not one plain path segment', () => {
    for (const id of ['', '..', '../x', 'a/b', 'a\\b', '/abs', 'a\0', 'a b\n', '.hidden/..']) expect(() => buildProjectZip(input({ 'a.c': 'x' }, id)), JSON.stringify(id)).toThrow(/unsafe/);
  });

  it('check.json, check.mjs and .learner always come from the app, not from content files', () => {
    const entries = projectZipEntries({ ...input({ 'a.c': 'x', 'check.json': 'EVIL', 'check.mjs': 'EVIL', '.learner': 'EVIL' }), learner: { version: 1, seed: SEED, exercise: 'caesar' } });
    expect(entries['check.json']).toBe(JSON.stringify(spec, null, 2) + '\n');
    expect(entries['check.mjs']).toBe('//');
    expect(entries['.learner']).not.toBe('EVIL');
  });

  it('zipFolderName maps hostile exercise ids to one safe segment', () => {
    for (const id of ['../../x', '..', 'a/../b', 'a b/c', 'ÜNI/çode', '\\x', 'a\0b', 'project/../../x', '']) {
      const n = zipFolderName(id);
      expect(n, JSON.stringify(id)).not.toMatch(/[/\\\0]|\.\./);
    }
  });

  it('buildZipFromFolder: hostile exercise folder entries cannot escape the zip', () => {
    const folder = { 'tests.json': JSON.stringify(spec), 'starter.c': 'int main(void){}', '../evil.c': 'x' };
    expect(() => buildZipFromFolder({ exerciseId: 'project/../../x', folder, seed: SEED, checkMjs: '//', learncH: '//' })).toThrow();
  });
});
