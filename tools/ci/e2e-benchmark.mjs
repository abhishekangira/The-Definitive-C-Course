// Temporary CI experiment: preserve the production worker, retry and serial settings.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const seconds = ms => (ms / 1000).toFixed(1);
function cases(suites) {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({
      id: `${spec.id}:${test.projectName}`, file: spec.file, title: spec.title,
      status: test.status, expectedStatus: test.expectedStatus,
      attempts: test.results.map(result => ({ status: result.status, duration: result.duration })),
    }))),
    ...cases(suite.suites ?? []),
  ]);
}

function run(total, index) {
  if (![1, 2, 4].includes(total) || !Number.isInteger(index) || index < 1 || index > total)
    throw new Error('Expected run <1|2|4> <shard index>');
  const out = path.resolve('.cache/e2e-benchmark');
  mkdirSync(out, { recursive: true });
  const metric = {
    total, index, sha: process.env.BENCH_SOURCE_SHA,
    setupMs: Date.now() - Number(process.env.BENCH_JOB_STARTED_MS),
    node: process.version, playwright: read('node_modules/@playwright/test/package.json').version,
    cpus: os.availableParallelism(), memoryBytes: os.totalmem(), repetitions: [],
  };
  let failed = false;
  for (let repetition = 1; repetition <= 3; repetition++) {
    const reportFile = path.join(out, `report-${total}-${index}-${repetition}.json`);
    const args = ['node_modules/@playwright/test/cli.js', 'test', '--workers=2', '--reporter=list,json',
      `--output=${out}/artifacts-${repetition}`];
    if (total > 1) args.push(`--shard=${index}/${total}`);
    const started = performance.now();
    const result = spawnSync(process.execPath, args, {
      stdio: 'inherit', env: { ...process.env, CI: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile },
    });
    const wallMs = performance.now() - started;
    let report;
    try { report = read(reportFile); } catch { /* no report is a failed measurement */ }
    metric.repetitions.push({ repetition, wallMs, exitCode: result.status, signal: result.signal,
      stats: report?.stats, errors: report?.errors, cases: report ? cases(report.suites) : [] });
    save(path.join(out, `metric-${total}-${index}.json`), metric);
    console.log(`BENCHMARK total=${total} shard=${index} repetition=${repetition} seconds=${seconds(wallMs)} exit=${result.status}`);
    if (result.status !== 0 || !report) { failed = true; break; }
  }
  process.exitCode = failed ? 1 : 0;
}

function summarize(directory) {
  const files = readdirSync(directory, { recursive: true }).filter(file => /^metric-.*\.json$/.test(path.basename(file)));
  const metrics = files.map(file => read(path.join(directory, file)));
  const issues = [];
  const baseline = metrics.find(metric => metric.total === 1 && metric.index === 1);
  const baselineIds = new Set(baseline?.repetitions[0]?.cases.map(test => test.id) ?? []);
  if (!baselineIds.size) issues.push('Missing baseline test cases');
  const rows = [];
  for (const total of [1, 2, 4]) {
    const shards = metrics.filter(metric => metric.total === total).sort((a, b) => a.index - b.index);
    if (shards.length !== total || new Set(shards.map(shard => shard.index)).size !== total) {
      issues.push(`Expected ${total} distinct shards for ${total}-shard scenario`); continue;
    }
    const walls = [], withSetup = [], runnerTime = [];
    let retries = 0, flaky = 0;
    for (let repetition = 0; repetition < 3; repetition++) {
      const runs = shards.map(shard => shard.repetitions[repetition]);
      if (runs.some(run => !run || run.exitCode !== 0 || run.errors?.length)) {
        issues.push(`${total} shards repetition ${repetition + 1}: incomplete or failed`); continue;
      }
      const allCases = runs.flatMap(run => run.cases);
      const ids = new Set(allCases.map(test => test.id));
      if (ids.size !== allCases.length || ids.size !== baselineIds.size || [...baselineIds].some(id => !ids.has(id)))
        issues.push(`${total} shards repetition ${repetition + 1}: missing or duplicate test cases`);
      if (runs.some(run => run.stats?.unexpected > 0)) issues.push(`${total} shards: unexpected failures`);
      retries += allCases.reduce((sum, test) => sum + Math.max(0, test.attempts.length - 1), 0);
      flaky += runs.reduce((sum, run) => sum + (run.stats?.flaky ?? 0), 0);
      walls.push(Math.max(...runs.map(run => run.wallMs)));
      withSetup.push(Math.max(...runs.map((run, i) => shards[i].setupMs + run.wallMs)));
      runnerTime.push(runs.reduce((sum, run, i) => sum + shards[i].setupMs + run.wallMs, 0));
    }
    if (walls.length === 3) rows.push({ total, medianTestMs: median(walls), medianWithSetupMs: median(withSetup),
      medianRunnerMs: median(runnerTime), testTimesMs: walls, setupTimesMs: shards.map(shard => shard.setupMs), retries, flaky });
  }
  if (new Set(metrics.map(metric => metric.sha)).size !== 1) issues.push('Measurements use different source commits');
  if (metrics.some(metric => !Number.isFinite(metric.setupMs) || metric.setupMs < 0)) issues.push('Invalid setup measurement');
  const base = rows.find(row => row.total === 1);
  const lines = [
    '# Playwright sharding benchmark', '', `Source: ${baseline?.sha ?? 'unavailable'}`, '',
    '| Shards | Median tests | Median setup + tests | Saved vs 1 shard | Runner time | Retries / flaky |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows.map(row => `| ${row.total} | ${seconds(row.medianTestMs)} s | ${seconds(row.medianWithSetupMs)} s | ${base ? seconds(base.medianWithSetupMs - row.medianWithSetupMs) : '?'} s | ${seconds(row.medianRunnerMs)} s | ${row.retries} / ${row.flaky} |`),
    '', 'Three repetitions per shard; parallel duration is the slowest shard in each repetition.',
    'Setup includes checkout, Node/npm, artifact download and Chromium installation. Shared build, queue time and report upload/merge are excluded.',
    'The same build is downloaded by every scenario. Separating E2E from the current single CI job adds overhead not isolated by this experiment.',
    'Runner time sums setup and test durations across shards. Repetitions reuse each runner; first-run caches may differ from later repetitions.',
    '', issues.length ? 'INVALID COMPARISON:\n' + issues.map(issue => `- ${issue}`).join('\n') : `Coverage checked: ${baselineIds.size} cases assigned exactly once in every repetition.`, '',
  ];
  const markdown = lines.join('\n');
  console.log(markdown);
  writeFileSync('benchmark-summary.md', markdown);
  save('benchmark-summary.json', { rows, issues, metrics });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.exitCode = issues.length ? 1 : 0;
}

const [mode, first, second] = process.argv.slice(2);
if (mode === 'run') run(Number(first), Number(second));
else if (mode === 'summarize') summarize(first);
else throw new Error('Usage: e2e-benchmark.mjs run <total> <index> | summarize <directory>');
