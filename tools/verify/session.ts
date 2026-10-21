// Native sessions (docs/adr/0005-native-sessions.md): a folder `content/modules/<mNN-…>/sessions/<id>/` holds
// `session.yaml` and the files its shell steps use. Each platform runs `all` and then its own group in a fresh temp dir:
// Linux twice (CC = gcc 13, then clang 22), macOS on the Targets workflow (CC = Apple clang). Every step's stdout,
// stderr and exit status is normalised (normaliseSession) and stored, so lessons show real tool output, never typed text.
// Every session runs twice; a step whose normalised output differs between the runs is rejected (the stability check).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SessionPlatform, SessionStepResult } from '../../src/content-model/types';
import { lineDiff } from './normalise';
import { moduleIdOf } from './discover';
import { run } from './proc';

export interface SessionStep {
  run: string;
  as?: string;
  stdin?: string;
  /** ok: exit 0; fail: any other status; any: not checked. */
  exit: 'ok' | 'fail' | 'any';
  /** Run with this compiler only (gdb needs the gcc build, lldb the clang one). macOS counts as clang. */
  only?: 'gcc' | 'clang';
}

export interface SessionSpec {
  id: string;
  module: string;
  /** Absolute path of the session folder. */
  dir: string;
  /** Path for messages: modules/<mNN-…>/sessions/<id>. */
  rel: string;
  hash: string;
  groups: Record<'all' | 'linux' | 'macos', SessionStep[]>;
  /** `bug: main.c:5`: the line the report must point at, checked on every Linux run (sessions-file.ts). */
  bug?: { file: string; line: number };
}

const GROUPS = ['all', 'linux', 'macos'] as const;
const STEP_KEYS = new Set(['run', 'as', 'stdin', 'exit', 'only']);

/** Finds and validates every session.yaml under <contentRoot>/modules/<mNN-…>/sessions/<id>/. */
export function discoverSessions(contentRoot: string, module?: string): { sessions: SessionSpec[]; errors: string[] } {
  const sessions: SessionSpec[] = [];
  const errors: string[] = [];
  const modulesDir = path.join(contentRoot, 'modules');
  if (!existsSync(modulesDir)) return { sessions, errors };
  for (const moduleDir of readdirSync(modulesDir).sort()) {
    const id = moduleIdOf(moduleDir);
    const root = path.join(modulesDir, moduleDir, 'sessions');
    if (!id || (module && module !== id) || !existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      const dir = path.join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      const rel = `modules/${moduleDir}/sessions/${name}`;
      const err = (m: string) => errors.push(`${rel}/session.yaml: ${m}`);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { err('the folder name is the session id and must be lower-case kebab-case'); continue; }
      if (sessions.some(s => s.id === name)) { err(`duplicate session id "${name}" (ids are unique across the course, like exercise folders)`); continue; }
      let doc: unknown;
      try { doc = parseYaml(readFileSync(path.join(dir, 'session.yaml'), 'utf8')); } catch (e) { err((e as Error).message); continue; }
      const groups = parseGroups(doc, err);
      const bug = parseBug(doc, dir, err);
      if (groups && bug !== null) sessions.push({ id: name, module: id, dir, rel, hash: folderHash(dir), groups, ...(bug ? { bug } : {}) });
    }
  }
  return { sessions, errors };
}

function parseGroups(doc: unknown, err: (m: string) => void): SessionSpec['groups'] | null {
  const steps = (doc as { steps?: unknown } | null)?.steps;
  if (!steps || typeof steps !== 'object' || Array.isArray(steps)) { err('needs `steps:` with `all`, `linux` and/or `macos` lists'); return null; }
  const out: SessionSpec['groups'] = { all: [], linux: [], macos: [] };
  let ok = true;
  for (const [group, list] of Object.entries(steps as Record<string, unknown>)) {
    if (!(GROUPS as readonly string[]).includes(group) || !Array.isArray(list)) { err(`steps.${group}: expected one of ${GROUPS.join(', ')}, each a list`); ok = false; continue; }
    list.forEach((raw: unknown, i) => {
      const s = raw as Record<string, unknown>;
      const where = `steps.${group}[${i}]`;
      const bad = Object.keys(s ?? {}).filter(k => !STEP_KEYS.has(k));
      if (typeof s?.run !== 'string' || !s.run.trim()) { err(`${where}: needs \`run: <shell command>\``); ok = false; return; }
      if (bad.length) { err(`${where}: unknown key(s) ${bad.join(', ')}`); ok = false; return; }
      const exit = s.exit ?? 'ok';
      if (exit !== 'ok' && exit !== 'fail' && exit !== 'any') { err(`${where}: exit must be ok, fail or any`); ok = false; return; }
      if (s.only !== undefined && s.only !== 'gcc' && s.only !== 'clang') { err(`${where}: only must be gcc or clang`); ok = false; return; }
      if ((s.as !== undefined && typeof s.as !== 'string') || (s.stdin !== undefined && typeof s.stdin !== 'string')) { err(`${where}: as and stdin are strings`); ok = false; return; }
      out[group as keyof typeof out].push({ run: s.run, exit, as: s.as as string | undefined, stdin: s.stdin as string | undefined, only: s.only as SessionStep['only'] });
    });
  }
  if (ok && !GROUPS.some(g => out[g].length)) { err('has no steps'); return null; }
  return ok ? out : null;
}

/** `bug: <file>:<line>` names a line of one of the folder's .c/.h files; undefined when absent, null when invalid. */
function parseBug(doc: unknown, dir: string, err: (m: string) => void): SessionSpec['bug'] | null {
  const raw = (doc as { bug?: unknown } | null)?.bug;
  if (raw === undefined) return undefined;
  const m = typeof raw === 'string' ? /^([\w.-]+\.[ch]):(\d+)$/.exec(raw) : null;
  if (!m) { err('bug must be `<file>.c:<line>` (or .h), the line the report points at'); return null; }
  const file = path.join(dir, m[1]);
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').length : 0;
  if (!lines) { err(`bug: ${m[1]} is not a file in this folder`); return null; }
  const line = Number(m[2]);
  if (line < 1 || line > lines) { err(`bug: ${m[1]} has no line ${line}`); return null; }
  return { file: m[1], line };
}

function folderHash(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update('\0').update(readFileSync(p)).update('\0');
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 16);
}

/** The steps one platform runs: `all`, then its own group, minus the steps for the other compiler. */
export function stepsFor(spec: SessionSpec, platform: SessionPlatform): SessionStep[] {
  const kind = platform === 'linux-gcc' ? 'gcc' : 'clang';
  const own = platform === 'macos' ? spec.groups.macos : spec.groups.linux;
  return [...spec.groups.all, ...own].filter(s => !s.only || s.only === kind);
}

// ---------- normalisation ----------

const DROP_LINE = [
  /libthread_db/, // gdb: "[Thread debugging using libthread_db enabled]", "Using host libthread_db library …"
  /^==PID== (Copyright \(C\)|Using Valgrind-|Parent PID:)/, // valgrind banner and the parent's PID
  /^(Date\/Time|Launch Time|OS Version|Analysis Tool Version|Parent Process):/, // macOS leaks header
  /^Physical footprint( \(peak\))?:/, // macOS leaks: the process's memory use, which differs between runs
];

/**
 * Makes one step's output the same on every run and machine: the work dir → `<dir>` and other temp files → `<tmpN>`
 * (keeping the extension), always. A tool step (`tool`, a step with `as:`) also gets PIDs → `<pid>` / `==PID==`, build
 * ids → `<id>`, hex addresses of 5+ digits → `<addrN>` (numbered by first appearance in the step, stdout then stderr,
 * so equal addresses stay equal), bash's `line N: <pid> Abort trap` PID → `<pid>`, and its banner lines that carry versions, dates or PIDs are dropped,
 * as are the macOS `leaks` memory figures and its `Binary Images` map. Apple ld's list of the files that define a
 * duplicate symbol is sorted. Shorter hex
 * (`0x1f`, a breakpoint offset) and all-zero values are left as they are. A step without `as:` is the program's own
 * output, so `mask = 0xDEADBEEF` or `process 3 items` stays as printed.
 */
export function normaliseSession(texts: string[], workDirs: string[], o: { tool?: boolean } = {}): string[] {
  const tool = o.tool ?? true;
  const tmp = new Map<string, string>();
  const addr = new Map<string, string>();
  const dirs = [...new Set(workDirs)].sort((a, b) => b.length - a.length);
  return texts.map(text => {
    let t = text;
    for (const d of dirs) t = t.split(d).join('<dir>');
    t = t.replace(/(?:\/private)?(?:\/tmp|\/var\/folders\/[^\s/]+\/[^\s/]+\/T)\/([\w.-]+?)(\.\w+)?(?=[\s:'"`),]|$)/gm, (m, _n, ext = '') => {
      const key = m.replace(/^\/private/, '');
      if (!tmp.has(key)) tmp.set(key, `<tmp${tmp.size + 1}>`);
      return tmp.get(key)! + ext;
    });
    if (!tool) return t;
    t = t.replace(/==\d+==/g, '==PID==').replace(/--\d+--/g, '--PID--')
      .replace(/\b(Process|process|LWP|pid|PID:?) \d+\b/g, '$1 <pid>')
      .replace(/^(Process: +\S+) \[\d+\]/gm, '$1 [<pid>]')
      .replace(/\bBuildId: [0-9a-f]+/g, 'BuildId: <id>') // ASan: the build id hashes the binary, which embeds the work dir
      .replace(/^(bash: line \d+: +)\d+(?= )/gm, '$1<pid>') // bash reporting a signal death: `bash: line 1:  8667 Abort trap: 6`
      // macOS leaks: the load map of every image, with UUIDs that change with each link; it ends at a blank line or the end.
      .replace(/^Binary Images:\n(?:.+\n?)*/gm, '')
      // Apple's ld lists the files of a duplicate symbol in either order between runs: sort that list.
      .replace(/^(duplicate symbol '[^'\n]+' in:\n)((?: {4}\S.*\n)+)/gm, (_m, head: string, files: string) => head + files.split('\n').filter(Boolean).sort().map(l => `${l}\n`).join(''));
    t = t.replace(/\b0x[0-9a-fA-F]{5,}\b/g, h => {
      if (/^0x0+$/.test(h)) return h;
      const key = h.toLowerCase().replace(/^0x0+/, '0x');
      if (!addr.has(key)) addr.set(key, `<addr${addr.size + 1}>`);
      return addr.get(key)!;
    });
    return t.split('\n').filter(l => !DROP_LINE.some(re => re.test(l))).join('\n');
  });
}

// ---------- running ----------

export interface SessionTools {
  /** The compiler `$CC` names. */
  cc: string;
  /** lldb on Linux is `lldb-22` (`LLDB22` overrides it); `lldb` on macOS. */
  lldb: string;
  workRoot: string;
  timeoutMs?: number;
}
// The steps get LC_ALL=C and an empty DEBUGINFOD_URLS: with a debuginfod server set, gdb and lldb fetch symbols from
// the network (issue #73 saw lldb 22 hang on it). Don't use lldb's `settings set …debuginfod.server-urls ""` instead:
// lldb 22 hung on `process launch` after it here.

export interface SessionRun { steps: SessionStepResult[]; problems: string[]; timedOut: boolean }

export const SESSION_CFLAGS = '-std=c17 -Wall -Wextra -pedantic -g -O0';

async function runOnce(spec: SessionSpec, steps: SessionStep[], tools: SessionTools): Promise<SessionRun> {
  const work = mkdtempSync(path.join(tools.workRoot, `${spec.id}-`));
  try {
    cpSync(spec.dir, work, { recursive: true, filter: src => path.basename(src) !== 'session.yaml' });
    const env = {
      ...process.env, LC_ALL: 'C', LANG: 'C', TERM: 'dumb', GCC_COLORS: '', DEBUGINFOD_URLS: '',
      CC: tools.cc, LLDB: tools.lldb, CFLAGS: SESSION_CFLAGS,
    };
    const out: SessionRun = { steps: [], problems: [], timedOut: false };
    for (const [i, s] of steps.entries()) {
      const r = await run('bash', ['-c', s.run], { cwd: work, input: s.stdin, env, timeoutMs: tools.timeoutMs ?? 60_000, group: true });
      const exit = r.status ?? 128 + signalNumber(r.signal);
      const [stdout, stderr] = normaliseSession([r.stdout, r.stderr], [work, realpathSync(work)], { tool: !!s.as });
      out.steps.push({ cmd: s.run, ...(s.as ? { as: s.as } : {}), stdout, stderr, exit });
      const where = `step ${i + 1} \`${s.run}\``;
      if (r.timedOut) { out.timedOut = true; out.problems.push(`${where} timed out after ${(tools.timeoutMs ?? 60_000) / 1000} s`); break; }
      if ((s.exit === 'ok' && exit !== 0) || (s.exit === 'fail' && exit === 0)) {
        out.problems.push(`${where}: expected exit ${s.exit}, got ${exit}${stderr.trim() ? `\n${stderr.trimEnd().split('\n').slice(-6).join('\n')}` : ''}`);
      }
    }
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const SIGNALS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGBUS: 7, SIGFPE: 8, SIGKILL: 9, SIGSEGV: 11, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15 };
const signalNumber = (s: NodeJS.Signals | null) => (s ? SIGNALS[s] ?? 0 : 0);

/** Runs one platform's steps twice and keeps the first run; a step whose output differs between the runs is a problem. */
export async function runSession(spec: SessionSpec, platform: SessionPlatform, tools: SessionTools): Promise<SessionRun> {
  const steps = stepsFor(spec, platform);
  const first = await runOnce(spec, steps, tools);
  if (first.timedOut) return first;
  const second = await runOnce(spec, steps, tools);
  if (second.timedOut) return { ...first, problems: [...first.problems, ...second.problems], timedOut: true };
  first.steps.forEach((a, i) => {
    const b = second.steps[i];
    for (const k of ['stdout', 'stderr', 'exit'] as const) {
      if (String(a[k]) !== String(b?.[k])) first.problems.push(`step ${i + 1} \`${a.cmd}\` is unstable: its ${k} differs between two runs\n${lineDiff(String(a[k]), String(b?.[k]))}`);
    }
  });
  return first;
}
