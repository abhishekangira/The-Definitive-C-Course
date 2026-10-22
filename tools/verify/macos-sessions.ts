// The `macos-sessions` row of `npm run dod`: every native session that has macOS steps must have its stored macOS run.
//
//   tsx tools/verify/macos-sessions.ts --module mNN [--generated-root <dir>]
//
// Reads only src/generated/sessions/<module>.json (no network, no Targets artifact). `verify` merges a macOS run into
// that file only while its hash matches the session folder and the run has no problems (sessions-file.ts), so a session
// whose `platforms` lists `macos` but has no `runs.macos` is one whose macOS run is missing, stale or broken. On Targets
// that is only a ::warning::; this row makes it a failure. Exit 0 on pass or skip, 1 on fail, 2 on a usage error.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionsFile } from '../../src/content-model/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_GENERATED_ROOT = path.join(ROOT, 'src', 'generated');

export const sessionsFilePath = (generatedRoot: string, module: string) => path.join(generatedRoot, 'sessions', `${module}.json`);

/** Why the row is skipped for this module, or undefined when there is a sessions file to check. */
export function macosSessionsSkip(generatedRoot: string, module: string): string | undefined {
  return existsSync(sessionsFilePath(generatedRoot, module)) ? undefined : `no sessions: no src/generated/sessions/${module}.json`;
}

/** Ids of the sessions that have macOS steps but no stored macOS run, sorted. */
export function missingMacosRuns(file: SessionsFile): string[] {
  return Object.values(file.sessions).filter(s => s.platforms.includes('macos') && !s.runs.macos).map(s => s.id).sort();
}

export type MacosSessionsResult = { status: 'pass' | 'fail' | 'skip'; message: string };

export function checkMacosSessions(generatedRoot: string, module: string): MacosSessionsResult {
  const skip = macosSessionsSkip(generatedRoot, module);
  if (skip) return { status: 'skip', message: skip };
  const rel = `src/generated/sessions/${module}.json`;
  let file: SessionsFile;
  try {
    file = JSON.parse(readFileSync(sessionsFilePath(generatedRoot, module), 'utf8')) as SessionsFile;
  } catch (e) {
    return { status: 'fail', message: `${rel} is not valid JSON (${(e as Error).message}); regenerate it with npm run verify` };
  }
  const sessions = file?.sessions;
  if (!sessions || typeof sessions !== 'object' || Object.values(sessions).some(s => !Array.isArray(s?.platforms) || !s.runs || typeof s.runs !== 'object')) {
    return { status: 'fail', message: `${rel} is not a sessions file (each session needs \`platforms\` and \`runs\`); regenerate it with npm run verify` };
  }
  const missing = missingMacosRuns(file);
  const withMac = Object.values(file.sessions).filter(s => s.platforms.includes('macos')).length;
  if (!missing.length) return { status: 'pass', message: `${module}: all ${withMac} session(s) with macOS steps have a stored macOS run` };
  return {
    status: 'fail',
    message: [
      `${module}: ${missing.length} session(s) with macOS steps have no stored macOS run (missing, stale or with problems):`,
      ...missing.map(id => `  ${id} (${file.sessions[id].dir})`),
      'Rerun the Targets workflow on main, or read its warning for this session.',
    ].join('\n'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  let module = '';
  let generatedRoot = DEFAULT_GENERATED_ROOT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module') module = argv[++i] ?? '';
    else if (argv[i] === '--generated-root') generatedRoot = path.resolve(argv[++i] ?? '');
    else { console.error(`unknown argument ${argv[i]}`); module = ''; break; }
  }
  if (!/^m\d+$/.test(module)) {
    console.error('usage: tsx tools/verify/macos-sessions.ts --module mNN [--generated-root <dir>]');
    process.exit(2);
  }
  const r = checkMacosSessions(generatedRoot, module);
  (r.status === 'fail' ? console.error : console.log)(r.status === 'skip' ? `skipped: ${r.message}` : r.message);
  process.exit(r.status === 'fail' ? 1 : 0);
}
