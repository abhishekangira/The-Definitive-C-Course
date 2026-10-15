// npm run verify:exercises [-- --module m01] [--content-root dir] [--only id] [--cc gcc] [--verbose] [--json]
// Exit status 1 when any exercise, variant or project has a problem.
import path from 'node:path';
import { ROOT } from '../shared/wasm-node';
import { verifyAll, type ItemReport } from './verify';

function parseArgs(argv: string[]) {
  const o = { contentRoot: path.join(ROOT, 'content'), module: undefined as string | undefined, only: undefined as string | undefined,
    cc: undefined as string | undefined, verbose: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--module') o.module = next();
    else if (a === '--content-root') o.contentRoot = path.resolve(next());
    else if (a === '--only') o.only = next();
    else if (a === '--cc') o.cc = next();
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--json') o.json = true;
    else throw new Error(`unknown argument ${a}\nusage: verify:exercises [--module m01] [--content-root dir] [--only id] [--cc gcc] [--verbose] [--json]`);
  }
  return o;
}

const colour = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);
const paint = (code: number) => (s: string) => (colour ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = paint(32), red = paint(31), yellow = paint(33), dim = paint(2), bold = paint(1);

function printItem(i: ItemReport, verbose: boolean, width: number) {
  const mark = i.ok ? green('✓') : red('✗');
  const kind = dim(`${i.kind} · ${i.runsIn}`.padEnd(22));
  console.log(`  ${mark} ${i.id.padEnd(width)} ${kind} ${i.summary.join(' · ')}${dim(`  ${(i.ms / 1000).toFixed(1)} s`)}`);
  for (const p of i.problems) console.log(`      ${red('- ' + p)}`);
  for (const w of i.warnings) console.log(`      ${yellow('! ' + w)}`);
  if (verbose) for (const d of i.details) console.log(dim(`      ${d}`));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.json) console.log(`${bold('verify:exercises')}  ${dim(path.relative(process.cwd(), o.contentRoot) || '.')}${o.module ? dim(`  (module ${o.module})`) : ''}`);
  let module = '';
  const summary = await verifyAll({
    contentRoot: o.contentRoot, module: o.module, only: o.only, cc: o.cc, verbose: o.verbose,
    onItem: i => {
      if (o.json) return;
      if (i.module !== module) { module = i.module; console.log(bold(module)); }
      printItem(i, o.verbose, 26);
    },
  });
  const bad = summary.items.filter(i => !i.ok);
  if (o.json) console.log(JSON.stringify(summary, null, 2));
  else if (summary.items.length === 0) console.log(dim('No exercises or projects found.'));
  else {
    const counts = `${summary.items.length} checked (${summary.items.filter(i => i.kind === 'project').length} projects)`;
    console.log(bad.length ? red(`\n${bad.length} of ${counts} have problems.`) : green(`\nAll good: ${counts}, ${(summary.ms / 1000).toFixed(1)} s.`));
    if (bad.length && !o.verbose) console.log(dim('Run with --verbose to see why each reference solution failed.'));
  }
  process.exitCode = summary.ok ? 0 : 1;
}

main().then(() => process.exit(), e => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
