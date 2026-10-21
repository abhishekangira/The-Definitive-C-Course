// npm run lint:content [-- --content-root dir] [--module m01] [--strict] [--errors-only] [--stats] [--json]
//                      [--videos file] [--public dir] [--animations dir]
//
// Lints content/modules/** against PLAN §2.4 (content format) and §2.5 (cadence, checkpoints, retrieval).
// Prints messages grouped by module as `file:line  severity  message  [rule]`; exit status 1 when there is
// an error (with --strict, a warning too). See tools/content-lint/README.md for every rule.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintContent, type LintOptions, type LintResult } from './lint';
import type { LintMessage } from './messages';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: lint:content [--content-root dir] [--module m01] [--strict] [--errors-only] [--stats] [--json] [--videos file] [--public dir] [--animations dir]';

export interface CliArgs extends LintOptions {
  strict: boolean;
  errorsOnly: boolean;
  /** Also print each lesson's cards and prose words per card. */
  stats: boolean;
  json: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const o: CliArgs = { contentRoot: path.join(ROOT, 'content'), strict: false, errorsOnly: false, stats: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value\n${USAGE}`); return argv[++i]; };
    if (a === '--content-root') o.contentRoot = path.resolve(next());
    else if (a === '--module') o.module = next();
    else if (a === '--videos') o.videosFile = path.resolve(next());
    else if (a === '--public') o.publicRoot = path.resolve(next());
    else if (a === '--animations') o.animationsRoot = path.resolve(next());
    else if (a === '--strict') o.strict = true;
    else if (a === '--errors-only') o.errorsOnly = true;
    else if (a === '--stats') o.stats = true;
    else if (a === '--json') o.json = true;
    else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  return o;
}

const colour = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);
const paint = (code: number) => (s: string) => (colour ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31), green = paint(32), yellow = paint(33), dim = paint(2), bold = paint(1);

/** 1 on an error, or on a warning with `--strict`. Notes (what a draft module is still missing) never fail a run. */
export const exitCode = (result: Pick<LintResult, 'errors' | 'warnings'>, strict: boolean): 0 | 1 => (result.errors > 0 || (strict && result.warnings > 0) ? 1 : 0);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `path:line  severity  message  [rule]`, with the path relative to `cwd` so terminals can click through. */
export function formatMessage(m: LintMessage, cwd = process.cwd()): string {
  const rel = path.relative(cwd, m.file) || m.file;
  const where = m.line > 0 ? `${rel}:${m.line}` : rel;
  const sev = m.severity === 'error' ? red('error  ') : m.severity === 'warning' ? yellow('warning') : dim('info   ');
  return `  ${where}  ${sev}  ${m.message}  ${dim(`[${m.rule}]`)}`;
}

/** Groups messages by module (site-level problems first) and renders the report. */
export function renderReport(result: LintResult, cwd = process.cwd(), errorsOnly = false): string {
  const out: string[] = [];
  const messages = errorsOnly ? result.messages.filter(m => m.severity === 'error') : result.messages;
  const groups = new Map<string, LintMessage[]>();
  for (const m of messages) {
    const key = m.module ? (result.site.modules.find(x => x.id === m.module)?.name ?? m.module) : 'site';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const order = ['site', ...result.site.modules.map(m => m.name)];
  for (const key of order) {
    const list = groups.get(key);
    if (!list) continue;
    const n = (severity: LintMessage['severity']) => list.filter(m => m.severity === severity).length;
    const notes = n('info') ? `, ${plural(n('info'), 'note')}` : '';
    out.push('', `${bold(key)} ${dim(`(${plural(n('error'), 'error')}, ${plural(n('warning'), 'warning')}${notes})`)}`);
    for (const m of list) out.push(formatMessage(m, cwd));
  }
  const { stats } = result;
  const what = `${stats.modules} module${stats.modules === 1 ? '' : 's'}, ${stats.lessons} lesson${stats.lessons === 1 ? '' : 's'}, ${stats.quizItems} quiz item${stats.quizItems === 1 ? '' : 's'}, ${stats.samples} sample${stats.samples === 1 ? '' : 's'}`;
  const notes = !errorsOnly && result.infos ? `${plural(result.infos, 'note')} on unreleased modules` : '';
  const counts = `${plural(result.errors, 'error')}, ${plural(result.warnings, 'warning')}${notes ? `, ${notes}` : ''}`;
  out.push('', result.errors ? red(`${counts} (${what})`) : result.warnings ? yellow(`${counts} (${what})`) : green(`All good: ${what}${notes ? `; ${notes}` : ''}.`));
  return out.join('\n');
}

/** One line per lesson: minutes, cards, and the prose words of each card (the budget is 250). */
export function renderStats(result: LintResult, cwd = process.cwd()): string {
  const out = ['', bold('lessons'), dim('  file  minutes  cards  words per card (limit 250)')];
  for (const l of result.lessons) {
    const words = l.words.map(w => (w > 250 ? red(String(w)) : w > 200 ? yellow(String(w)) : String(w))).join(' ');
    out.push(`  ${path.relative(cwd, l.file)}  ${String(l.minutes ?? '?').padStart(3)} min  ${String(l.cards).padStart(2)} cards  ${words}`);
  }
  return out.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = lintContent(args);
  if (args.json) {
    const { site: _site, ...rest } = result;
    console.log(JSON.stringify({ ...rest, messages: rest.messages.map(m => ({ ...m, file: path.relative(process.cwd(), m.file) })) }, null, 2));
  } else {
    console.log(`${bold('lint:content')}  ${dim(path.relative(process.cwd(), args.contentRoot) || '.')}${args.module ? dim(`  (module ${args.module})`) : ''}`);
    console.log(renderReport(result, process.cwd(), args.errorsOnly));
    if (args.stats) console.log(renderStats(result));
  }
  process.exitCode = exitCode(result, args.strict);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(2); }
}
