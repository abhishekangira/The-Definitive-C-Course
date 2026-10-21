// check.mjs: the course's local test runner (check50-style). Bundled by tools/check/build.mjs into a
// single zero-dependency file that ships in every project zip.
//
//   node check.mjs [dir] [--hint] [--json] [--only "check name"] [--cc gcc] [--verbose] [--keep]
//   node check.mjs --doctor [--cc gcc]     the environment report (doctor.ts)
//
// It uses the same test semantics as the in-browser runner (src/testing/runner.ts) with the learner's
// own compiler, prints ✓/✗ per check with plain-English explanations, and finishes with a progress
// code (or, when everything passes, a completion token) for the course. Exit status: 0 all checks
// passed, 1 some failed, 2 the project folder or check.json is unusable.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { arch } from 'node:os';
import path from 'node:path';
import type { TestsSpec } from '../../../src/content-model/types';
import { describeResult, type Line, type Tone } from '../../../src/testing/format';
import { HARNESS_FILE } from '../../../src/testing/harness';
import { runTests, type TestReport, type TestResult } from '../../../src/testing/runner';
import { isUnitTest, validateTestsSpec } from '../../../src/testing/spec';
import {
  encodeCompletionToken, encodeProgressCode, LEARNER_FILE, parseLearnerFile, RUNNER_VERSION, sourceHash, TOKEN_FORMAT, type LearnerFile,
} from '../../../src/testing/token';
import { assess, formatDoctor, gatherFacts } from './doctor';
import { findCompiler, NativeBackend } from './native-backend';

const STATE_FILE = '.check-state';

const USAGE = `Usage: node check.mjs [folder] [options]

Runs the course's checks on the project in [folder] (default: the current folder).

Options:
  --hint         show the next hint for the first failing check
  --only NAME    run only the check called NAME
  --cc COMPILER  use this C compiler (default: $CC, then cc, clang, gcc)
  --json         print the results as JSON
  --verbose      also print the full compiler output
  --keep         keep the temporary build folder
  --version      print the runner version
  --doctor       check this machine for the course (compiler, Node, debuggers…) and exit
`;

interface Args {
  dir: string;
  hint: boolean;
  json: boolean;
  verbose: boolean;
  keep: boolean;
  only?: string;
  cc?: string;
  help: boolean;
  version: boolean;
  doctor: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dir: '.', hint: false, json: false, verbose: false, keep: false, help: false, version: false, doctor: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    const value = () => {
      const eq = s.indexOf('=');
      if (eq > 0) return s.slice(eq + 1);
      if (i + 1 >= argv.length) throw new Error(`${s} needs a value`);
      return argv[++i];
    };
    if (s === '--hint') a.hint = true;
    else if (s === '--json') a.json = true;
    else if (s === '--verbose') a.verbose = true;
    else if (s === '--keep') a.keep = true;
    else if (s === '--help' || s === '-h') a.help = true;
    else if (s === '--version') a.version = true;
    else if (s === '--doctor') a.doctor = true;
    else if (s === '--only' || s.startsWith('--only=')) a.only = value();
    else if (s === '--cc' || s.startsWith('--cc=')) a.cc = value();
    else if (s.startsWith('-')) throw new Error(`unknown option ${s}`);
    else positional.push(s);
  }
  if (positional.length > 1) throw new Error('give at most one project folder');
  if (positional[0]) a.dir = positional[0];
  return a;
}

// ---------------------------------------------------------------- output

const IS_WINDOWS = process.platform === 'win32';
function painter(enabled: boolean) {
  const p = (code: number) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { green: p(32), red: p(31), yellow: p(33), cyan: p(36), dim: p(2), bold: p(1) };
}

interface State {
  runs: number;
  /** Hint tiers already shown per check name. */
  hints: Record<string, number>;
}

function readState(dir: string): State {
  try {
    const s = JSON.parse(readFileSync(path.join(dir, STATE_FILE), 'utf8')) as Partial<State>;
    return { runs: Number.isInteger(s.runs) ? s.runs! : 0, hints: typeof s.hints === 'object' && s.hints ? s.hints : {} };
  } catch {
    return { runs: 0, hints: {} };
  }
}

function writeState(dir: string, s: State): void {
  try { writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(s, null, 2) + '\n'); } catch { /* read-only folder: codes still print */ }
}

function fail(message: string, json: boolean): never {
  if (json) console.log(JSON.stringify({ error: message }, null, 2));
  else console.error(message);
  process.exit(2);
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  // `node check.mjs | head` closes the pipe early: stop quietly instead of crashing.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(process.exitCode ?? 1); throw e; });
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) { console.log(USAGE); return; }
  if (args.version) { console.log(`check.mjs R${RUNNER_VERSION} (codes ${TOKEN_FORMAT})`); return; }
  if (args.doctor) {
    const facts = gatherFacts({ cc: args.cc, platform: process.env.CHECK_PLATFORM ?? process.platform, noSanitizers: !!process.env.CHECK_NO_SANITIZERS });
    const verdict = assess(facts);
    const unicode = !IS_WINDOWS || !!process.env.WT_SESSION;
    console.log(`check.mjs R${RUNNER_VERSION} doctor\n\n${formatDoctor(facts, verdict, { pass: unicode ? '✓' : '+', fail: unicode ? '✗' : 'x' }).join('\n')}\n`);
    process.exitCode = verdict.ok ? 0 : 1;
    return;
  }

  const dir = path.resolve(args.dir);
  const specPath = path.join(dir, 'check.json');
  if (!existsSync(specPath)) {
    fail(`No check.json in ${dir}.\nRun this from the project folder (the one with check.json), or pass its path: node check.mjs path/to/project`, args.json);
  }
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(specPath, 'utf8')); } catch (e) { fail(`check.json is not valid JSON: ${(e as Error).message}`, args.json); }
  const problems = validateTestsSpec(raw, { runsIn: 'native', exists: f => existsSync(path.join(dir, f)) });
  if (problems.errors.length) fail(`check.json has problems (download the project again?):\n  - ${problems.errors.join('\n  - ')}`, args.json);
  const spec = raw as TestsSpec;

  let learner: LearnerFile | undefined;
  let learnerProblem: string | undefined;
  const learnerPath = path.join(dir, LEARNER_FILE);
  if (existsSync(learnerPath)) {
    try { learner = parseLearnerFile(readFileSync(learnerPath, 'utf8')); } catch (e) { learnerProblem = (e as Error).message; }
  } else learnerProblem = `there is no ${LEARNER_FILE} file here, so no progress code (download the project from the course to get one)`;

  const compiler = findCompiler(args.cc);
  if (!compiler) {
    fail(process.platform === 'darwin'
      ? 'No C compiler found. Install the Xcode Command Line Tools:  xcode-select --install'
      : 'No C compiler found. Install one:  sudo apt install build-essential   (Ubuntu / WSL)', args.json);
  }

  // The learner's sources (as on disk) and the exercise's own files the tests need.
  const learnerFiles: Record<string, string> = {};
  for (const s of spec.sources) if (existsSync(path.join(dir, s))) learnerFiles[s] = readFileSync(path.join(dir, s), 'utf8');
  const exerciseFiles: Record<string, string> = {};
  for (const t of spec.tests) if (isUnitTest(t)) exerciseFiles[t.unit.harness] = readFileSync(path.join(dir, t.unit.harness), 'utf8');

  const platform = process.env.CHECK_PLATFORM ?? process.platform;
  const backend = new NativeBackend(compiler, {
    dir, cc: compiler.cc, platform, keep: args.keep, noSanitizers: !!process.env.CHECK_NO_SANITIZERS,
    learnerFiles: [...spec.sources, ...Object.keys(exerciseFiles), HARNESS_FILE],
  });
  process.on('exit', () => backend.dispose());

  const colour = !args.json && !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);
  const c = painter(colour);
  const unicode = !IS_WINDOWS || !!process.env.WT_SESSION;
  const MARK = { pass: c.green(unicode ? '✓' : '+'), fail: c.red(unicode ? '✗' : 'x'), skip: c.yellow(unicode ? '–' : '-') };
  const tone: Record<Tone, (s: string) => string> = { plain: s => s, dim: c.dim, bad: c.red, good: c.green, hint: c.cyan };
  const state = readState(dir);
  // Only a full run counts as a run and earns a code: with --only, unselected checks are skipped,
  // so a code made from it would claim that everything else fails.
  const full = args.only === undefined;
  if (full) state.runs += 1;
  const title = (spec as { title?: string }).title ?? learner?.title ?? path.basename(dir);
  const out = (s = '') => { if (!args.json) console.log(s); };

  out();
  out(`${c.bold(title)}  ${c.dim(`(${spec.sources.join(', ')})`)}`);
  out(c.dim(`${backend.name} · ${platform}-${arch()} · check.mjs R${RUNNER_VERSION}`));
  out();

  // Hints: every failing check shows the tiers already revealed (at least the first). --hint reveals
  // one more tier of the first failing check that still has an unseen one.
  const revealed = (name: string) => state.hints[name] ?? 1;
  let hintUsed = false;
  let lastSkip: string | undefined;
  const printResult = (r: TestResult) => {
    if (args.json) return;
    if (r.status === 'skip') {
      if (args.only && r.name !== args.only) return; // not selected: say nothing
      // One line per skipped check; the reason only when it changes.
      out(`${MARK.skip} ${c.dim(r.name)}`);
      if (r.message && r.message !== lastSkip) out(`    ${c.dim(r.message)}`);
      lastSkip = r.message;
      return;
    }
    lastSkip = undefined;
    const note = r.status === 'pass' && r.note ? c.dim(`  (${r.note})`) : '';
    out(`${MARK[r.status]} ${r.status === 'fail' ? c.bold(r.name) : r.name}${note}`);
    let tiers = revealed(r.name);
    if (r.status === 'fail' && args.hint && !hintUsed && (r.hints?.length ?? 0) > tiers) {
      hintUsed = true;
      tiers += 1;
      state.hints[r.name] = tiers;
    }
    for (const l of describeResult(r, tiers) as Line[]) {
      const pad = '    ' + '    '.repeat(l.indent ?? 0);
      const mark = l.mark ? `${MARK[l.mark]} ` : '';
      out(`${pad}${mark}${tone[l.tone ?? 'plain'](l.text)}`);
    }
    if (args.verbose && r.kind === 'compile' && (r.diagnostics?.length ?? 0) > 0) {
      for (const d of r.diagnostics!) out(c.dim(`    | ${d.file}:${d.line}:${d.col}: ${d.severity}: ${d.message}`));
    }
  };

  const report: TestReport = await runTests(spec, learnerFiles, exerciseFiles, backend, { only: args.only, onResult: printResult });
  if (args.verbose && !args.json && report.compile.raw.trim()) out(c.dim(report.compile.raw.trim().replace(/^/gm, '    | ')));

  let progressCode: string | undefined;
  let completionToken: string | undefined;
  if (learner && full) {
    if (report.allPassed) completionToken = await encodeCompletionToken({ exercise: learner.exercise }, learner.seed);
    progressCode = await encodeProgressCode({ exercise: learner.exercise, bits: report.bits, run: state.runs, src: await sourceHash(learnerFiles) }, learner.seed);
  }
  writeState(dir, state);

  if (args.json) {
    console.log(JSON.stringify({
      runner: RUNNER_VERSION, exercise: learner?.exercise, title, compiler: compiler.version, platform: `${platform}-${arch()}`,
      passed: report.passed, total: report.total, allPassed: report.allPassed, bits: report.bits, run: state.runs,
      only: args.only, progressCode, completionToken, learnerProblem, results: report.results,
    }, null, 2));
  } else {
    out();
    const selected = args.only ? report.results.find(r => r.name === args.only) : undefined;
    if (args.only && !selected) out(c.yellow(`There is no check called ${JSON.stringify(args.only)}.`));
    else if (selected) {
      const verdict = selected.status === 'pass' ? c.green('passed') : selected.status === 'fail' ? c.red('failed') : c.yellow('skipped');
      out(`${c.bold(selected.name)}: ${verdict}. ${c.dim('Run make test to run every check.')}`);
    }
    else if (report.allPassed) out(c.green(c.bold(`All ${report.total} checks passed.`)));
    else out(`${c.bold(`${report.passed}/${report.total}`)} checks passed.${c.dim('  Fix the first failure, then run make test again.')}`);
    const more = report.results.some(r => r.status === 'fail' && (r.hints?.length ?? 0) > revealed(r.name));
    if (more) out(c.dim('Stuck? `make hint` (or node check.mjs --hint) shows the next hint for the first failing check.'));
    else if (args.hint && !hintUsed && !report.allPassed) out(c.dim('No more hints: everything the course has for these checks is shown above.'));
    out();
    if (completionToken) out(`Completion token (paste it into the course):  ${c.bold(completionToken)}`);
    else if (progressCode) out(`Progress code (paste it into the course):  ${c.bold(progressCode)}`);
    else if (!full) out(c.dim('No progress code for a single check: run make test (all checks) to get one.'));
    else out(c.yellow(`No progress code: ${learnerProblem}.`));
    out();
  }
  process.exitCode = report.allPassed ? 0 : 1;
}

main().catch(e => {
  console.error(`check.mjs stopped unexpectedly: ${(e as Error).stack ?? e}`);
  process.exit(2);
});
