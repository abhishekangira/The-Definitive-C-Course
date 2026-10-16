// npm run dod -- --module m01 [--fast] [--json]
//
// Runs the per-module definition of done (PLAN.md §3.6) in order and prints one table; exit status 1 on any FAIL,
// 2 on a usage error. --fast skips build and e2e. --json prints the same data as JSON (nothing else on stdout from this
// program; npm's own "> pkg@ver dod" banner goes to stdout first, so call it as `npm run -s dod -- … --json`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, runSteps, spawnExec, type Exec, type Report } from './run';
import { buildSteps } from './steps';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const USAGE = 'usage: npm run dod -- --module mNN [--fast] [--json]   (with --json use: npm run -s dod -- … --json)';

export interface CliArgs { module: string; fast: boolean; json: boolean; contentRoot: string }

export function parseArgs(argv: string[], contentRoot = path.join(ROOT, 'content')): CliArgs {
  const a: CliArgs = { module: '', fast: false, json: false, contentRoot };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--module') a.module = argv[++i] ?? '';
    else if (k === '--fast') a.fast = true;
    else if (k === '--json') a.json = true;
    else if (k === '--content-root') a.contentRoot = path.resolve(argv[++i] ?? '');
    else throw new Error(`unknown argument ${k}\n${USAGE}`);
  }
  if (!/^m\d+$/.test(a.module)) throw new Error(`--module mNN is required (for example --module m01)\n${USAGE}`);
  return a;
}

/** Returns the process exit status; `write` receives stdout text, `exec` is injectable for tests. */
export async function main(argv: string[], write: (s: string) => void = s => process.stdout.write(s), exec: Exec = spawnExec(ROOT), contentRoot?: string): Promise<{ code: number; report?: Report }> {
  let args: CliArgs;
  let steps;
  try {
    args = parseArgs(argv, contentRoot);
    steps = buildSteps(args);
  } catch (e) {
    console.error(`dod: ${(e as Error).message}`);
    return { code: 2 };
  }
  const report = await runSteps(steps, exec, { module: args.module, fast: args.fast },
    args.json ? undefined : r => write(`${r.status === 'SKIPPED' ? 'skip' : r.status.toLowerCase()}  ${r.name}\n`));
  write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `\n${formatReport(report)}\n`);
  return { code: report.ok ? 0 : 1, report };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(r => process.exit(r.code));
}
