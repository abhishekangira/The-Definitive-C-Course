// Runs every native session (session.ts) and writes src/generated/sessions/<module>.json, or compares with it (--check).
// Linux x86-64 gcc 13 and clang 22 run here; macOS results come from `--target-run macos-arm64-appleclang` on the Targets
// workflow (src/generated/targets/macos-arm64-appleclang/<module>.sessions.json) and are merged in when the hash matches.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import type { SessionPlatform, SessionResult, SessionsFile } from '../../src/content-model/types';
import { stableStringify } from '../shared/stable-json';
import { ResultCache, environmentFingerprint } from './cache';
import type { NativeToolchain } from './native';
import { mapLimit } from './proc';
import { firstUserFrame } from '../../src/interactions/report-questions';
import { discoverSessions, runSession, stepsFor, type SessionRun, type SessionSpec } from './session';

/** <out>/<module>.sessions.json, written by `verify --target-run macos-arm64-appleclang`. */
export interface TargetSessionsFile {
  module: string;
  target: string;
  generatedBy: string;
  /** Every session with steps on macOS (`all` and `macos`); one with `problems` is kept for diagnosis and never merged. */
  sessions: Record<string, { hash: string; steps: SessionResult['runs']['macos']; problems?: string[] }>;
}

export const lldbCommand = (platform: SessionPlatform): string => (platform === 'macos' ? process.env.LLDB ?? 'lldb' : process.env.LLDB22 ?? 'lldb-22');

const firstLine = (cmd: string) => {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? `${r.stdout}${r.stderr}`.split('\n').find(l => l.trim())?.trim() ?? cmd : `${cmd}: not found`;
};

/** gdb, valgrind, lldb and make versions (provenance, and part of the cache key). */
export function sessionToolVersions(platform: SessionPlatform): Record<string, string> {
  const tools = platform === 'macos' ? { lldb: lldbCommand(platform), make: 'make' } : { gdb: 'gdb', valgrind: 'valgrind', lldb: lldbCommand(platform), make: 'make' };
  return Object.fromEntries(Object.entries(tools).map(([k, cmd]) => [k, firstLine(cmd)]));
}

/** Runs `platform` for every session that has steps for it, through the cache. */
export async function runSessions(specs: SessionSpec[], platform: SessionPlatform, tc: NativeToolchain, o: { cacheDir: string; workRoot: string; force?: boolean; log?: (l: string) => void }): Promise<Map<string, SessionRun>> {
  const cache = new ResultCache<SessionRun>(o.cacheDir, { read: !o.force, write: true });
  const versions = { cc: tc.version, ...sessionToolVersions(platform) };
  const env = environmentFingerprint();
  mkdirSync(o.workRoot, { recursive: true });
  const todo = specs.filter(s => stepsFor(s, platform).length);
  const runs = await mapLimit(todo, Math.max(1, Math.min(4, cpus().length)), async spec => {
    const key = ResultCache.key(['session', spec.hash, platform, versions, env]);
    let r = cache.get(key);
    if (!r) {
      const t0 = performance.now();
      r = await runSession(spec, platform, { cc: tc.cc, lldb: lldbCommand(platform), workRoot: o.workRoot });
      o.log?.(`  ran session ${spec.id} (${platform}) in ${Math.round(performance.now() - t0)} ms`);
      if (!r.timedOut && !r.problems.length) cache.set(key, r);
    }
    return [spec.id, r] as const;
  });
  return new Map(runs);
}

/** The session's C sources and headers, so a report question can show the lines the report points at. */
function sourcesOf(dir: string): Record<string, string> {
  const files = readdirSync(dir).filter(f => /\.[ch]$/.test(f)).sort();
  return Object.fromEntries(files.map(f => [f, readFileSync(path.join(dir, f), 'utf8')]));
}

/**
 * A session with `bug: <file>:<line>` grades a report question against its first user frame, so every run must point
 * there, and the line itself must not explain the bug: a comment on it is shown to the learner as the answer.
 */
export function bugProblems(spec: Pick<SessionSpec, 'bug'>, sources: Record<string, string>, runs: SessionResult['runs']): string[] {
  if (!spec.bug) return [];
  const { file, line } = spec.bug;
  const out: string[] = [];
  const text = sources[file]?.split('\n')[line - 1] ?? '';
  if (/\/\*|\/\//.test(text)) out.push(`bug: ${file}:${line} has a comment, which the report question would show as the answer; move it to the lesson text`);
  for (const p of ['linux-gcc', 'linux-clang'] as const) {
    const steps = runs[p];
    if (!steps) continue;
    const f = firstUserFrame(steps, sources);
    if (!f || f.file !== file || f.line !== line) out.push(`bug: ${file}:${line}, but the ${p} report's first frame in your code is ${f ? `${f.file}:${f.line}` : 'missing'}`);
  }
  return out;
}

const projection = (f: SessionsFile) => stableStringify({ ...f, generatedBy: '<version>' });

export interface SessionsReport { problems: string[]; notes: string[]; written: string[]; unchanged: string[]; stale: string[]; outputs: Record<string, string> }

export async function verifySessions(o: {
  contentRoot: string; generatedRoot: string; cacheDir: string; workRoot: string; module?: string; check?: boolean; force?: boolean;
  /** linux-x86_64-gcc13 and linux-x86_64-clang22, in that order. */
  toolchains: NativeToolchain[]; log?: (l: string) => void;
}): Promise<SessionsReport> {
  const rep: SessionsReport = { problems: [], notes: [], written: [], unchanged: [], stale: [], outputs: {} };
  const found = discoverSessions(o.contentRoot, o.module);
  rep.problems.push(...found.errors);
  if (!found.sessions.length) return rep;
  const [gcc, clang] = o.toolchains;
  const byPlatform: Array<[SessionPlatform, Map<string, SessionRun>]> = [];
  for (const [platform, tc] of [['linux-gcc', gcc], ['linux-clang', clang]] as const) {
    byPlatform.push([platform, await runSessions(found.sessions, platform, tc, { ...o, cacheDir: path.join(o.cacheDir, platform) })]);
  }
  const generatedBy = `tools/verify sessions; gcc: ${gcc.version}; clang22: ${clang.version}; ${Object.entries(sessionToolVersions('linux-gcc')).map(([k, v]) => `${k}: ${v}`).join('; ')}`;
  for (const m of [...new Set(found.sessions.map(s => s.module))]) {
    const file: SessionsFile = { module: m, generatedBy, sessions: {} };
    const stored = readJson<TargetSessionsFile>(path.join(o.generatedRoot, 'targets', 'macos-arm64-appleclang', `${m}.sessions.json`));
    for (const spec of found.sessions.filter(s => s.module === m)) {
      const platforms = (['linux-gcc', 'linux-clang', 'macos'] as const).filter(p => stepsFor(spec, p).length);
      const res: SessionResult = { id: spec.id, dir: spec.rel.split('/').slice(2).join('/'), hash: spec.hash, platforms, sources: sourcesOf(spec.dir), runs: {} };
      for (const [platform, runs] of byPlatform) {
        const r = runs.get(spec.id);
        if (!r) continue;
        rep.problems.push(...r.problems.map(p => `${spec.rel} (${platform}): ${p}`));
        res.runs[platform] = r.steps;
      }
      rep.problems.push(...bugProblems(spec, res.sources, res.runs).map(p => `${spec.rel}/session.yaml: ${p}`));
      const mac = stored?.sessions[spec.id];
      if (mac && mac.hash === spec.hash && !mac.problems?.length) res.runs.macos = mac.steps;
      else if (mac && mac.hash === spec.hash) rep.notes.push(`${spec.rel}: the stored macOS run has problems, so it is not shown: ${mac.problems!.join('; ')}`);
      else if (mac) rep.notes.push(`${spec.rel}: the stored macOS run is stale (the session changed); rerun the Targets workflow`);
      file.sessions[spec.id] = res;
    }
    const text = stableStringify(file);
    rep.outputs[m] = text;
    const target = path.join(o.generatedRoot, 'sessions', `${m}.json`);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    // Only the tool versions changed: keep the committed file (like samples, see verify.ts).
    if (current !== null && (current === text || projection(JSON.parse(current) as SessionsFile) === projection(file))) { rep.unchanged.push(target); continue; }
    if (o.check) { rep.stale.push(target); rep.problems.push(`${path.relative(process.cwd(), target)} is stale; run npm run verify and commit`); continue; }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
    rep.written.push(target);
  }
  return rep;
}

/**
 * `--target-run macos-arm64-appleclang`: the `all` and `macos` steps of every session, for the Targets workflow to
 * commit. A session problem (an unexpected exit, unstable output, an invalid session.yaml) is written into the file and
 * returned as a warning, never as a failure: the file is committed for diagnosis, `verify` never merges a run with
 * problems, and the macOS sample results of the same run are still stored. The Linux `verify` fails on the same problems.
 */
export async function targetRunSessions(o: { contentRoot: string; outDir: string; cacheDir: string; workRoot: string; module?: string; force?: boolean; tc: NativeToolchain; log?: (l: string) => void }): Promise<{ warnings: string[]; written: string[] }> {
  const found = discoverSessions(o.contentRoot, o.module);
  const warnings = [...found.errors];
  const written: string[] = [];
  const runs = await runSessions(found.sessions, 'macos', o.tc, o);
  const versions = Object.entries(sessionToolVersions('macos')).map(([k, v]) => `${k}: ${v}`).join('; ');
  for (const m of [...new Set(found.sessions.map(s => s.module))]) {
    const file: TargetSessionsFile = { module: m, target: o.tc.target, generatedBy: `tools/verify --target-run sessions; ${o.tc.version}; ${versions}`, sessions: {} };
    for (const spec of found.sessions.filter(s => s.module === m)) {
      const r = runs.get(spec.id);
      if (!r) continue;
      warnings.push(...r.problems.map(p => `${spec.rel} (macos): ${p}`));
      file.sessions[spec.id] = { hash: spec.hash, steps: r.steps, ...(r.problems.length ? { problems: r.problems } : {}) };
    }
    const target = path.join(o.outDir, `${m}.sessions.json`);
    writeFileSync(target, stableStringify(file));
    written.push(target);
    o.log?.(`wrote ${target} (${Object.keys(file.sessions).length} sessions)`);
  }
  return { warnings, written };
}

function readJson<T>(f: string): T | null {
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}
