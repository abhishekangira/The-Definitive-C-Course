#!/usr/bin/env node
// `npm run anim:check`: every animation project must be valid, lint-clean, check-clean and freshly rendered.
//
//   node tools/anim/check.mjs                 all projects
//   node tools/anim/check.mjs a01             only projects whose id starts with "a01"
//   node tools/anim/check.mjs --static        no browser: static validation, hyperframes lint, manifest freshness (seconds)
//
// Per project, in order (the first failure of a stage does not stop the later stages, so one run reports everything):
//   1. sync-shared                      the vendored GSAP and fonts are copied in
//   2. static validation                tools/anim/validate.mjs: the PLAN 4.6 rules lint cannot see, steps/rail/motion/captions consistency
//   3. hyperframes lint                 0 errors, 0 warnings
//   4. hyperframes check --strict       runtime, layout, motion sidecar, WCAG AA contrast (sampled at every step's settled frame)
//   5. manifest freshness               public/animations/<id>/ matches animations/manifest.json, whose sourceHash covers the project
//                                       files, the pinned CLI version, the render flags and the pipeline version
// Also fails on rendered folders or manifest entries that have no project.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DIR, browserVersion, checkFreshness, listProjects, projectDir, readManifest, readProject, runHf, syncShared } from './lib.mjs';
import { validateProject } from './validate.mjs';

const BAD = '✗';
const OK = '✓';

function parseJson(text) {
  const i = text.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return null;
  }
}

/** Errors and warnings fail the project (check runs with --strict); info-level findings are transient geometry notes. */
function summariseFindings(label, section, problems, notes) {
  if (!section) return;
  for (const f of section.findings ?? []) {
    const where = [f.sourceFile, f.selector, f.time !== undefined ? `t=${f.time}s` : null].filter(Boolean).join(' ');
    const line = `${label} ${f.severity}: ${f.code}: ${String(f.message).slice(0, 220)} (${where})`;
    (f.severity === 'info' ? notes : problems).push(line);
  }
}

/** Times to sample in `hyperframes check`: each step's settled frame and its midpoint, so every state is audited. */
export function sampleTimes(steps) {
  const t = new Set();
  for (const s of steps) {
    t.add(Math.round(s.end * 100) / 100);
    t.add(Math.round(((s.time + s.end) / 2) * 100) / 100);
  }
  return [...t].sort((a, b) => a - b);
}

export function checkProject(id, { staticOnly = false } = {}) {
  const problems = [];
  const notes = [];
  const dir = projectDir(id);
  syncShared(id);

  const v = validateProject(id);
  problems.push(...v.errors.map(e => `validate: ${e}`));
  notes.push(...v.warnings.map(w => `validate warning: ${w}`));

  const lint = runHf(['lint', dir, '--json']);
  const lintJson = parseJson(lint.stdout);
  if (!lintJson) problems.push(`lint: no JSON output:\n${(lint.stdout + lint.stderr).slice(0, 600)}`);
  else {
    if (lintJson.errorCount || lintJson.warningCount) problems.push(`lint: ${lintJson.errorCount} error(s), ${lintJson.warningCount} warning(s)`);
    summariseFindings('lint', lintJson, problems, notes);
  }

  if (!staticOnly && !problems.length) {
    const project = readProject(id);
    const args = ['check', dir, '--strict', '--json', '--at', sampleTimes(project.steps).join(',')];
    const r = runHf(args);
    const j = parseJson(r.stdout);
    if (!j) problems.push(`check: no JSON output:\n${(r.stdout + r.stderr).slice(0, 800)}`);
    else {
      if (j.browserSkipped) problems.push('check: the browser did not run (lint failed or Chromium could not start)');
      if (!j.ok) problems.push('check --strict failed');
      for (const k of ['runtime', 'layout', 'motion', 'contrast']) summariseFindings(k, j[k], problems, notes);
      notes.push(`check: runtime ${j.runtime?.errorCount ?? '?'}e/${j.runtime?.warningCount ?? '?'}w, layout ${j.layout?.totalIssueCount ?? 0} finding(s) at ${j.layout?.samples?.length ?? '?'} samples, motion ${j.motion?.errorCount ?? '?'}e (${j.motion?.samples ?? '?'} samples), contrast ${j.contrast?.passed ?? '?'}/${j.contrast?.checked ?? '?'} AA`);
    }
  } else if (!staticOnly) notes.push('check: skipped because an earlier stage failed');

  const fresh = checkFreshness(id);
  problems.push(...fresh.problems.map(p => `render: ${p}`));
  return { id, problems, notes };
}

function main(argv) {
  const staticOnly = argv.includes('--static');
  const only = argv.filter(a => !a.startsWith('--'));
  const ids = listProjects(only);
  const all = listProjects();
  if (!ids.length) {
    console.log('No animation projects found.');
    return;
  }
  if (!staticOnly && !browserVersion()) {
    console.error('Chromium not found. Set HYPERFRAMES_BROWSER_PATH, or run with --static to skip the browser gate.');
    process.exit(2);
  }
  let failed = 0;
  for (const id of ids) {
    const t0 = Date.now();
    process.stdout.write(`${id} ...\n`);
    const r = checkProject(id, { staticOnly });
    for (const n of r.notes) console.log(`  ${n}`);
    if (r.problems.length) {
      failed++;
      console.log(`  ${BAD} ${r.problems.length} problem(s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      for (const p of r.problems) console.log(`    - ${p}`);
    } else console.log(`  ${OK} ok in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }

  // Orphans are only meaningful when the whole set was checked.
  if (!only.length) {
    const manifest = readManifest();
    const orphans = [];
    for (const id of Object.keys(manifest.animations)) if (!all.includes(id)) orphans.push(`animations/manifest.json lists ${id}, which has no project`);
    if (existsSync(PUBLIC_DIR)) {
      for (const d of readdirSync(PUBLIC_DIR, { withFileTypes: true })) {
        if (d.isDirectory() && !all.includes(d.name)) orphans.push(`public/animations/${d.name}/ has no project in animations/`);
      }
    }
    if (orphans.length) {
      failed++;
      console.log(`${BAD} orphans:`);
      for (const o of orphans) console.log(`    - ${o}`);
    }
  }

  console.log(failed ? `\n${BAD} anim:check failed (${failed})` : `\n${OK} anim:check passed (${ids.length} animation${ids.length === 1 ? '' : 's'}${staticOnly ? ', static only' : ''})`);
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
