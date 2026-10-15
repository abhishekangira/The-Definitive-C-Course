// npm run videos:check [-- --online] [--videos file] [--transcripts dir] [--strict]
//
// Offline (the default, and what CI runs): videos.json schema, at most 2 segments per module,
// segment bounds, and that each anchor quote appears in the committed transcript excerpt
// (tools/videos/transcripts/<id>.vtt) within 3 s of the segment boundary. See validate.ts.
// --online: also asks YouTube's oEmbed endpoint whether each video still exists and may be embedded.
// This tool never calls yt-dlp: YouTube rate-limits datacenter IPs. Excerpts are refreshed by hand
// (see README.md), e.g. with tools/videos/excerpt.ts.
//
// Exit status 1 when there is an error (or, with --strict, a warning).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VideoEntry } from '../../src/content-model/types';
import { checkOnline, describeSegment, validateVideos, type VideoMessage } from './validate';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface CheckFilesOptions {
  videosFile: string;
  transcriptsDir: string;
  online?: boolean;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (key: string, status: number, delayMs: number) => void;
}

export interface CheckFilesResult {
  entries: VideoEntry[];
  messages: VideoMessage[];
}

/** Reads videos.json and the transcript excerpts, validates them, and (online) asks oEmbed. */
export async function checkVideoFiles(o: CheckFilesOptions): Promise<CheckFilesResult> {
  if (!existsSync(o.videosFile)) {
    return { entries: [], messages: [{ severity: 'error', message: `${o.videosFile} does not exist` }] };
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(o.videosFile, 'utf8'));
  } catch (e) {
    return { entries: [], messages: [{ severity: 'error', message: `${o.videosFile} is not valid JSON: ${(e as Error).message}` }] };
  }
  const messages = validateVideos(data, id => {
    // Ids are matched against the file name, so refuse anything that could leave the folder.
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
    const file = path.join(o.transcriptsDir, `${id}.vtt`);
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  });
  const entries = Array.isArray(data) ? (data as VideoEntry[]) : [];
  if (o.online && !messages.some(m => m.severity === 'error' && m.key === undefined)) {
    // Only entries with the right shape are asked about: a malformed id would be a pointless request.
    const askable = entries.filter(v => v && typeof v.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.id));
    messages.push(...(await checkOnline(askable, { fetchImpl: o.fetchImpl, retryDelayMs: o.retryDelayMs, sleep: o.sleep, onRetry: o.onRetry })));
  }
  return { entries, messages };
}

// ---------------------------------------------------------------------------------------------

interface Args {
  videosFile: string;
  transcriptsDir: string;
  online: boolean;
  strict: boolean;
}

export function parseArgs(argv: string[]): Args {
  const o: Args = {
    videosFile: path.join(ROOT, 'videos.json'),
    transcriptsDir: path.join(ROOT, 'tools', 'videos', 'transcripts'),
    online: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--online') o.online = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--videos') o.videosFile = path.resolve(next());
    else if (a === '--transcripts') o.transcriptsDir = path.resolve(next());
    else throw new Error(`unknown argument ${a}\nusage: videos:check [--online] [--strict] [--videos file] [--transcripts dir]`);
  }
  return o;
}

const colour = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);
const paint = (code: number) => (s: string) => (colour ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = paint(32), red = paint(31), yellow = paint(33), dim = paint(2), bold = paint(1);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`${bold('videos:check')}  ${dim(path.relative(process.cwd(), args.videosFile) || args.videosFile)}${args.online ? dim('  (online)') : dim('  (offline)')}`);
  const { entries, messages } = await checkVideoFiles({
    ...args,
    onRetry: (key, status, ms) => console.log(dim(`  ${key}: HTTP ${status}, retrying in ${Math.round(ms / 1000)} s`)),
  });
  const forEntry = (key: string) => messages.filter(m => m.key === key);
  for (const v of entries) {
    const mine = forEntry(v.key);
    const bad = mine.some(m => m.severity === 'error');
    console.log(`  ${bad ? red('✗') : green('✓')} ${v.key.padEnd(8)} ${v.title} ${dim(`${v.module} lesson ${v.lesson} · ${describeSegment(v)} · ${v.channel}`)}`);
    for (const m of mine) console.log(`      ${m.severity === 'error' ? red('- ' + m.message) : yellow('! ' + m.message)}`);
  }
  const general = messages.filter(m => m.key === undefined || !entries.some(v => v.key === m.key));
  for (const m of general) console.log(`  ${m.severity === 'error' ? red('- ' + m.message) : yellow('! ' + m.message)}`);
  const errors = messages.filter(m => m.severity === 'error').length;
  const warnings = messages.length - errors;
  const summary = `${entries.length} segment${entries.length === 1 ? '' : 's'}, ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
  console.log(errors ? red(`\n${summary}`) : warnings ? yellow(`\n${summary}`) : green(`\nAll good: ${summary}.`));
  process.exitCode = errors > 0 || (args.strict && warnings > 0) ? 1 : 0;
}

// Run only when executed (tsx tools/videos/check.ts), not when imported by the tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(), e => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
