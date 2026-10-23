#!/usr/bin/env node
// Runs the on-screen hello.c build chain with gcc-13 (LC_ALL=C) and returns the
// platform-dependent values A2 shows. `node tools/anim/a02-facts.mjs --write`
// writes animations/a02-build-and-load/variables.json from that run.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANIM_DIR } from './lib.mjs';

export const ID = 'a02-build-and-load';
export const VARIABLE_IDS = Object.freeze([
  'iLines', 'sLines', 'printfDecl', 'sExcerpt',
  'nmObjMain', 'nmObjPrintf', 'objBytes', 'exeBytes', 'nmExePrintf', 'interpreter',
]);

const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' };

export function plain(html) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot);/g, m => ENT[m]);
}

/** Visible scene text with bound values removed. Style, script and svg are not on screen. */
export function unboundText(html) {
  const cut = html
    .replace(/<([a-zA-Z][\w:-]*)\b[^>]*\bdata-var-text="[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  return plain(cut);
}

/** The C source shown in the editor: text of each `.bl-line`'s code span. */
export function listing(html) {
  const lines = [...html.matchAll(/<div class="bl-line[^"]*"[^>]*><span class="bl-ln"[^>]*>\d+<\/span><span>([\s\S]*?)<\/span><\/div>/g)]
    .map(m => plain(m[1]).replace(/\s+$/, ''));
  return lines.join('\n') + '\n';
}

export function commandsFrom(html) {
  return [...html.matchAll(/class="bl-cmd"[^>]*>([\s\S]*?)<\//g)].map(m => plain(m[1]).replace(/\s+/g, ' ').trim());
}

/** The authored text of every element bound to variable `id` (what check and snapshot show). */
export function boundTexts(html, id) {
  return [...html.matchAll(new RegExp(`data-var-text="${id}"[^>]*>([\\s\\S]*?)</`, 'g'))]
    .map(m => plain(m[1]).replace(/\s+$/, ''));
}

export function declaredDefaults(indexHtml) {
  const m = indexHtml.match(/data-composition-variables=(['"])([\s\S]*?)\1/);
  if (!m) throw new Error('index.html: missing data-composition-variables');
  const decls = JSON.parse(m[2].replace(/&quot;/g, '"'));
  const out = {};
  for (const d of decls) out[d.id] = String(d.default);
  return out;
}

export function detectMachine() {
  const gcc = spawnSync('gcc-13', ['--version'], { encoding: 'utf8' });
  let glibc = '';
  try { glibc = process.report.getReport().header.glibcVersionRuntime || ''; } catch { /* no report */ }
  if (!glibc) {
    const ldd = spawnSync('ldd', ['--version'], { encoding: 'utf8' });
    const t = `${ldd.stdout || ''}\n${ldd.stderr || ''}`;
    const m = t.match(/(\d+\.\d+)\s*$/m);
    glibc = m ? m[1] : '';
  }
  return { arch: process.arch, hasGcc13: gcc.status === 0, glibc };
}

/**
 * Skip reason for the gcc-backed facts, or undefined when they must run.
 * Pure in (env, machine): on CI it never skips, even on a non-reference machine.
 */
export function factsSkipReason(env = process.env, machine = detectMachine()) {
  if (env.CI === 'true') return undefined;
  if (machine.arch !== 'x64') return `arch is ${machine.arch}, not x64`;
  if (!machine.hasGcc13) return 'gcc-13 is missing';
  if (machine.glibc !== '2.39') return `glibc is ${machine.glibc}, not 2.39`;
  return undefined;
}

export function toGcc(cmd) {
  return cmd.replace(/^cc(?=\s|$)/, 'gcc-13');
}

function expandTabs(line, tab = 8) {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(tab - (out.length % tab)) : ch;
  return out.trimEnd();
}

function wcLines(text) {
  return (text.match(/\n/g) || []).length;
}

function nmLine(out, name) {
  for (const line of out.split('\n')) {
    const m = line.match(/^[0-9a-fA-F ]*\s([A-Za-z])\s(\S+)/);
    if (m && (m[2] === name || m[2].startsWith(`${name}@`))) return `${m[1]} ${m[2]}`;
  }
  return null;
}

function sExcerpt(sText) {
  const lines = sText.split('\n');
  const i = lines.findIndex(l => /\bcall\s+printf\b/.test(l));
  // gcc turns printf("...\n") into puts. Return '' so the facts test can assert on nm, instead of throwing first.
  if (i < 0) return '';
  const pick = lines.slice(Math.max(0, i - 3), i + 1);
  if (pick.some(l => /0x[0-9a-fA-F]/.test(l))) throw new Error('assembly excerpt contains an address');
  return pick.map(l => expandTabs(l)).join('\n');
}

function run(argv, cwd) {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** Run the on-screen commands (cc → gcc-13) in a temp dir and return the values A2 shows. */
export function collectFacts({ source, commands }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'a02-facts-'));
  try {
    writeFileSync(path.join(dir, 'hello.c'), source);
    let lastStatus = 0;
    let stdout = '';
    const outputs = {};
    for (const cmd of commands) {
      // `stdout: "0"` is equivalent while ./hello exits 0. A non-zero ./hello is reported, not thrown, so `return 1` fails the assertions.
      if (cmd === 'echo $?') { outputs[cmd] = { status: 0, stdout: String(lastStatus), stderr: '' }; continue; }
      const argv = toGcc(cmd).split(/\s+/);
      const r = run(argv, dir);
      outputs[cmd] = r;
      lastStatus = r.status;
      if (argv[0] === './hello') stdout = r.stdout;
      else if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr || r.stdout || r.error}`);
    }
    const iText = readFileSync(path.join(dir, 'hello.i'), 'utf8');
    const sText = readFileSync(path.join(dir, 'hello.s'), 'utf8');
    const nmObj = outputs['nm hello.o']?.stdout ?? run(['nm', 'hello.o'], dir).stdout;
    const nmExe = outputs['nm hello']?.stdout ?? run(['nm', 'hello'], dir).stdout;
    const elf = outputs['readelf -l hello']?.stdout ?? run(['readelf', '-l', 'hello'], dir).stdout;
    const decl = iText.match(/^extern int printf \(const char \*[^\n]*\.\.\.\);$/m);
    if (!decl) throw new Error('hello.i has no printf declaration');
    const interp = elf.match(/Requesting program interpreter:\s+(\S+)\]/);
    if (!interp) throw new Error('readelf -l hello: no program interpreter');
    const nmObjPrintf = nmLine(nmObj, 'printf');
    const nmObjMain = nmLine(nmObj, 'main');
    const nmExePrintf = nmLine(nmExe, 'printf');
    return {
      source, commands, stdout, exit: lastStatus, outputs,
      nmObj, nmExe,
      variables: {
        iLines: String(wcLines(iText)),
        sLines: String(wcLines(sText)),
        printfDecl: decl[0],
        sExcerpt: sExcerpt(sText),
        nmObjMain: nmObjMain ?? '',
        nmObjPrintf: nmObjPrintf ?? '',
        objBytes: String(statSync(path.join(dir, 'hello.o')).size),
        exeBytes: String(statSync(path.join(dir, 'hello')).size),
        nmExePrintf: nmExePrintf ?? '',
        interpreter: interp[1],
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function projectFiles() {
  const dir = path.join(ANIM_DIR, ID);
  const scene = f => readFileSync(path.join(dir, 'compositions', f), 'utf8');
  return {
    dir,
    index: readFileSync(path.join(dir, 'index.html'), 'utf8'),
    sourceHtml: scene('bl-01-source.html'),
    scenes: {
      preprocess: scene('bl-02-preprocess.html'),
      compile: scene('bl-03-compile.html'),
      assemble: scene('bl-04-assemble.html'),
      link: scene('bl-05-link.html'),
      load: scene('bl-06-load.html'),
    },
  };
}

export function collectFromProject() {
  const p = projectFiles();
  const source = listing(p.sourceHtml);
  const commands = Object.values(p.scenes).flatMap(commandsFrom);
  return { ...collectFacts({ source, commands }), files: p };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMain() && process.argv.includes('--write')) {
  const facts = collectFromProject();
  const missing = ['nmObjMain', 'nmObjPrintf', 'nmExePrintf', 'sExcerpt'].filter(k => !facts.variables[k]);
  if (missing.length) throw new Error(`nm did not report main/printf (${missing.join(', ')})\n${facts.nmObj}`);
  const file = path.join(ANIM_DIR, ID, 'variables.json');
  writeFileSync(file, `${JSON.stringify(facts.variables, null, 2)}\n`);
  process.stdout.write(`wrote ${file}\n`);
}
