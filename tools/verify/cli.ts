// npm run verify [-- --module m01] [--force] [--check] [--only <id>] [--no-trace] [--no-sessions] [--verbose]
// npm run verify -- --target-run <TargetId|host> --out <dir> [--module m01]
//
// Build-time sample verification (PLAN §3.1–§3.4). For every C sample in content/ (lesson fences
// and quiz items) it compiles and runs gcc 13, clang 22 (+ ASan/UBSan) and the browser toolchain
// in Node, checks `expect`, flags browser-vs-64-bit differences, and writes
// src/generated/samples/<module>.json; samples with `trace` also get src/generated/traces/<id>.json.
// Native sessions (modules/<mNN-…>/sessions/<id>/session.yaml) run their shell steps with gcc 13 and clang 22 and
// write src/generated/sessions/<module>.json (tools/verify/session.ts; --no-sessions skips them).
//
//   --module   only that module (its generated file is still complete)
//   --force    ignore .cache/verify (results are cached per sample by content + toolchain hash)
//   --check    regenerate in memory and fail if a committed file is stale. UB run output and
//              display-only address text are excluded from the comparison: they legitimately
//              change between runs (garbage values, ASLR).
//   --only     verify one sample id and print the result; writes nothing
//   --target-run  CI runners (macOS arm64, Linux aarch64, Windows MSVC): native compile+run only,
//              writes <out>/<module>.json (TargetsFile: per sample {hash, result}). Commit those
//              under src/generated/targets/<target>/; verify then flags differences against them.
//
// Output conventions (see types.ts / normalise.ts for details):
//   - Only %p output is normalised (<addrN>, <NULL>), located exactly via a marked build.
//   - Native stdout runs on a pty (like the browser's tty stdout); stdout=both adds `runPipe`.
//   - SampleResult.hash = tools/shared/sample-hash.ts (the app uses sample-hash-iso.ts).
//
// Hidden flags (tests and fixtures): --content-root <dir> (default content/),
// --generated-root <dir> (default src/generated/), --cache-dir <dir> (default .cache/verify/).
// Exit status: 0 ok, 1 problems (or stale files with --check), 2 usage/internal error.
import path from 'node:path';
import type { TargetId } from '../../src/content-model/types';
import { ROOT } from '../shared/wasm-node';
import { hostTarget } from './native';
import { TARGET_LABEL } from './types';
import { targetRun, verify, type VerifyReport } from './verify';

interface Args {
  module?: string;
  only?: string;
  force: boolean;
  check: boolean;
  trace: boolean;
  sessions: boolean;
  verbose: boolean;
  targetRun?: TargetId;
  out?: string;
  contentRoot: string;
  generatedRoot: string;
  cacheDir: string;
}

function usage(msg?: string): never {
  if (msg) console.error(`verify: ${msg}`);
  console.error('usage: tsx tools/verify/cli.ts [--module mNN] [--force] [--check] [--only <id>] [--no-trace] [--no-sessions] [--verbose]\n' +
    '       tsx tools/verify/cli.ts --target-run <TargetId|host> --out <dir> [--module mNN] [--force]');
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    force: false, check: false, trace: true, sessions: true, verbose: false,
    contentRoot: path.join(ROOT, 'content'),
    generatedRoot: path.join(ROOT, 'src/generated'),
    cacheDir: path.join(ROOT, '.cache/verify'),
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i] ?? usage(`${k} needs a value`);
    switch (k) {
      case '--module': a.module = val(); break;
      case '--only': a.only = val(); break;
      case '--force': a.force = true; break;
      case '--check': a.check = true; break;
      case '--no-trace': a.trace = false; break;
      case '--no-sessions': a.sessions = false; break;
      case '--verbose': case '-v': a.verbose = true; break;
      case '--target-run': { const t = val(); a.targetRun = (t === 'host' ? hostTarget() : t) as TargetId; break; }
      case '--out': a.out = path.resolve(val()); break;
      case '--content-root': a.contentRoot = path.resolve(val()); break;
      case '--generated-root': a.generatedRoot = path.resolve(val()); break;
      case '--cache-dir': a.cacheDir = path.resolve(val()); break;
      case '--help': case '-h': usage();
      // falls through (usage exits)
      default: usage(`unknown argument ${k}`);
    }
  }
  if (a.targetRun && !(a.targetRun in TARGET_LABEL)) usage(`unknown target ${a.targetRun}`);
  if (a.targetRun && a.targetRun === 'wasm32-clang22') usage('--target-run is for native targets; the browser target runs on every verify');
  if (a.targetRun && !a.out) usage('--target-run needs --out <dir>');
  return a;
}

const rel = (f: string) => path.relative(process.cwd(), f) || f;

function printReport(r: VerifyReport, a: Args, ms: number): void {
  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  const width = Math.min(32, Math.max(8, ...r.samples.map(s => s.sample.id.length)));
  for (const s of r.samples) {
    const mark = s.problems.length ? 'FAIL' : ' ok ';
    const tags = [
      s.cached ? 'cached' : '',
      s.result.flagged ? `flagged${s.sample.meta.platform ? ' (platform)' : ''}` : '',
      s.sample.meta.expect && s.sample.meta.expect !== 'success' ? `expect=${s.sample.meta.expect}` : '',
      s.sample.meta.target === 'native' ? 'native-only' : '',
    ].filter(Boolean).join(', ');
    console.log(`[${mark}] ${pad(s.sample.id, width)} ${pad(`${s.sample.module}/${s.sample.lesson}`, 28)} ${tags}`);
    const cont = (t: string) => t.replace(/\n/g, '\n         ');
    for (const p of s.problems) console.log(`       problem: ${cont(p)}`);
    if (a.verbose || s.problems.length) for (const n of s.notes) console.log(`       note: ${cont(n)}`);
  }
  const f = r.fragments;
  if (f.checked || f.partial.length) {
    console.log(`fragments: ${f.checked} syntax-checked${f.partial.length ? `; ${f.partial.length} fragment=partial skipped: ${f.partial.map(p => `${p.file}:${p.line}`).join(', ')}` : ''}`);
    for (const w of f.warnings) console.log(`       warning: ${w.replace(/\n/g, '\n                ')}`);
  }
  for (const n of r.notes) console.log(`note: ${n}`);
  const unattached = r.problems.filter(p => !r.samples.some(s => s.problems.some(sp => p.endsWith(sp))));
  for (const p of unattached) console.log(`[FAIL] ${p.replace(/\n/g, '\n       ')}`);
  for (const w of r.files.written) console.log(`wrote ${rel(w)}`);
  const failing = r.samples.filter(s => s.problems.length).length;
  console.log(`\n${r.samples.length} sample(s), ${failing} failing, ${r.problems.length} problem(s) in ${(ms / 1000).toFixed(2)} s` +
    (a.check ? (r.files.stale.length ? ` — ${r.files.stale.length} generated file(s) stale` : ' — generated files up to date') : ''));
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  if (a.targetRun) {
    const r = await targetRun({ target: a.targetRun, outDir: a.out!, contentRoot: a.contentRoot, cacheDir: path.join(a.cacheDir, 'targets'), module: a.module, force: a.force, log: console.log });
    for (const p of r.problems) console.log(`[FAIL] ${p}`);
    if (r.warnings.length) console.log(`${r.warnings.length} native session problem(s), written into <module>.sessions.json for diagnosis (never merged; exit status unaffected)`);
    process.exit(r.problems.length ? 1 : 0);
  }
  const report = await verify({
    contentRoot: a.contentRoot, generatedRoot: a.generatedRoot, cacheDir: a.cacheDir,
    module: a.module, only: a.only, force: a.force, check: a.check, trace: a.trace, sessions: a.sessions,
    log: a.verbose ? console.log : undefined,
  });
  printReport(report, a, performance.now() - t0);
  process.exit(report.problems.length ? 1 : 0);
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(2);
});
