// A2 shows a real gcc 13 build of hello.c. This test runs the on-screen commands
// with gcc-13 and fails if a number, symbol, command or path on screen is stale.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ANIM_DIR } from './lib.mjs';

type Machine = { arch: string; hasGcc13: boolean; glibc: string };
type Files = { index: string; sourceHtml: string; scenes: Record<'preprocess' | 'compile' | 'assemble' | 'link' | 'load', string> };
type Facts = {
  source: string; commands: string[]; stdout: string; exit: number;
  outputs: Record<string, { stdout: string }>;
  nmObj: string; nmExe: string;
  variables: Record<string, string>; files: Files;
};
type FactsModule = {
  ID: string;
  VARIABLE_IDS: readonly string[];
  boundTexts(html: string, id: string): string[];
  collectFromProject(): Facts;
  commandsFrom(html: string): string[];
  declaredDefaults(indexHtml: string): Record<string, string>;
  factsSkipReason(env: Record<string, string | undefined>, machine?: Machine): string | undefined;
  listing(html: string): string;
  unboundText(html: string): string;
};
// a02-facts.mjs is plain JS (it also runs as `node tools/anim/a02-facts.mjs --write`); its shape is typed here.
const factsPath: string = './a02-facts.mjs';
const {
  ID, VARIABLE_IDS, boundTexts, collectFromProject, commandsFrom, declaredDefaults, factsSkipReason, listing, unboundText,
} = (await import(factsPath)) as FactsModule;

const skip = factsSkipReason(process.env);

describe('A2 skip function', () => {
  const off = { arch: 'arm64' as const, hasGcc13: false, glibc: '2.41' };

  it('returns no reason on CI, even on a non-reference machine', () => {
    expect(factsSkipReason({ CI: 'true' }, off)).toBeUndefined();
  });

  it('returns a reason off CI when the machine is not the reference', () => {
    const reason = factsSkipReason({ CI: 'false' }, off);
    expect(reason).toMatch(/arch|gcc-13|glibc/);
  });

  it('returns a reason off CI when glibc is not 2.39', () => {
    expect(factsSkipReason({ CI: 'false' }, { arch: 'x64', hasGcc13: true, glibc: '2.41' })).toMatch(/glibc/);
  });
});

describe.skipIf(skip)('A2: what the animation shows is what gcc 13 does', () => {
  // Vitest runs this callback during collection even when skipIf skips the suite, so gcc stays in beforeAll.
  let facts!: Facts;
  let varsFile!: Record<string, string>;
  let defaults!: Record<string, string>;
  let html!: string;
  beforeAll(() => {
    facts = collectFromProject();
    varsFile = JSON.parse(readFileSync(path.join(ANIM_DIR, ID, 'variables.json'), 'utf8')) as Record<string, string>;
    defaults = declaredDefaults(facts.files.index);
    html = Object.values(facts.files.scenes).join('\n');
  });

  it('parses the listing and runs the on-screen commands', () => {
    expect(facts.source).toContain('printf("Hello, %s!\\n", "C")');
    expect(facts.source).not.toContain('printf("Hello, C!\\n")');
    expect(facts.commands).toEqual([
      'cc -E hello.c -o hello.i',
      'cc -S hello.i',
      'cc -c hello.s',
      'nm hello.o',
      'cc hello.o -o hello',
      'nm hello',
      'readelf -l hello',
      './hello',
      'echo $?',
    ]);
    expect(listing(facts.files.sourceHtml)).toBe(facts.source);
    expect(Object.values(facts.files.scenes).flatMap(commandsFrom)).toEqual(facts.commands);
  });

  it('the load scene shows the program stdout and exit 0', () => {
    expect(facts.stdout).toBe('Hello, C!\n');
    expect(facts.outputs['echo $?'].stdout).toBe(idText(facts.files.scenes.load, 'bl06-status'));
    expect(facts.exit).toBe(0);
    expect(idText(facts.files.scenes.load, 'bl06-out')).toBe('Hello, C!');
    expect(idText(facts.files.scenes.load, 'bl06-status')).toBe('0');
  });

  it('nm hello.o reports U printf, not puts', () => {
    expect(facts.nmObj).not.toMatch(/\bU puts\b/);
    expect(facts.nmObj).toMatch(/\bU printf\b/);
    expect(facts.nmObj).toMatch(/\bT main\b/);
    expect(facts.variables.nmObjPrintf).toBe('U printf');
  });

  it('variables.json matches the gcc 13 run, and each declared default equals it', () => {
    expect(Object.keys(varsFile).sort()).toEqual([...VARIABLE_IDS].sort());
    expect(varsFile).toEqual(facts.variables);
    expect(defaults).toEqual(varsFile);
  });

  it('every bound value on screen equals variables.json', () => {
    for (const id of VARIABLE_IDS) {
      const shown = boundTexts(html, id);
      expect(shown.length, id).toBeGreaterThan(0);
      for (const t of shown) expect(t, id).toBe(varsFile[id]);
    }
  });

  it('the preprocess scene shows the same hello.c and its line count', () => {
    const pre = facts.files.scenes.preprocess;
    expect(listing(pre)).toBe(facts.source);
    const lines = facts.source.split('\n').length - 1;
    expect(idText(pre, 'bl02-clines')).toBe(`${lines} lines`);
    expect(Number(facts.variables.iLines)).toBeGreaterThan(10 * lines);
  });
});

describe('A2: a platform value typed outside a binding fails', () => {
  // 0 is the exit status (`return 0` and bl-06). 1..6 are editor line numbers, the hello.c "6 lines" count, and the step badges.
  // "x86-64" and "gcc 13" name the lesson's platform; mask those phrases so a measured 13, 64 or 86 still fails.
  const allowedDigits = new Set(['0', '1', '2', '3', '4', '5', '6']);
  // Captions and the description name "T main" and "U printf" on purpose: those symbols are the lesson and are stable
  // on every x86-64 gcc. The check there is the platform-dependent values, plus digit runs and loader/libc strings.
  const proseIds = ['iLines', 'sLines', 'objBytes', 'exeBytes', 'interpreter', 'nmExePrintf', 'sExcerpt', 'printfDecl'];
  const scenes = ['bl-01-source', 'bl-02-preprocess', 'bl-03-compile', 'bl-04-assemble', 'bl-05-link', 'bl-06-load'];

  it('scene text, captions and the description have no unbound variable, digit run, or loader string', () => {
    const dir = path.join(ANIM_DIR, ID);
    const vars = JSON.parse(readFileSync(path.join(dir, 'variables.json'), 'utf8')) as Record<string, string>;
    const hits: string[] = [];
    for (const name of scenes) {
      const html = readFileSync(path.join(dir, 'compositions', `${name}.html`), 'utf8');
      // sExcerpt is checked per non-blank trimmed line. No value is skipped: the shortest, sLines "50", is still a measured count.
      hits.push(...platformHits(name, unboundText(html), vars, VARIABLE_IDS, allowedDigits));
    }
    const captions = JSON.parse(readFileSync(path.join(dir, 'captions.json'), 'utf8')) as { text: string }[];
    const description = (JSON.parse(readFileSync(path.join(dir, 'animation.json'), 'utf8')) as { description: string }).description;
    hits.push(...platformHits('captions+description', [...captions.map(c => c.text), description].join('\n'), vars, proseIds, allowedDigits));
    expect(hits, 'bind it with data-var-text=<id>.').toEqual([]);
  });
});

const FIX = 'bind it with data-var-text=<id>.';

function platformHits(where: string, raw: string, vars: Record<string, string>, ids: readonly string[], allowedDigits: Set<string>) {
  const hits: string[] = [];
  for (const id of ids) {
    const parts = id === 'sExcerpt' ? vars[id].split('\n').map(l => l.trim()).filter(l => l.length > 0) : [vars[id]];
    for (const part of parts) {
      if (raw.includes(part)) hits.push(`${where}: ${JSON.stringify(part)} (${id}) is outside a binding. ${FIX}`);
    }
  }
  const text = raw.replace(/x86-64/g, ' ').replace(/gcc 13/g, ' ');
  for (const m of text.matchAll(/\d+/g)) {
    if (!allowedDigits.has(m[0])) hits.push(`${where}: digit run "${m[0]}" is outside a binding. ${FIX}`);
  }
  for (const m of raw.matchAll(/ld-|\.so|GLIBC_|@PLT/g)) {
    hits.push(`${where}: "${m[0]}" is outside a binding. ${FIX}`);
  }
  return hits;
}

function idText(html: string, id: string) {
  const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</`));
  expect(m, id).toBeTruthy();
  return m![1].replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot);/g, t => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' }[t]!)).trim();
}
