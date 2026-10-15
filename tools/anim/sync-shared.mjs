#!/usr/bin/env node
// Copies animations/_shared/{vendor,fonts} into every animation project (vendor/ and assets/fonts/).
//
// Projects must be self-contained (HyperFrames lint rejects `../` asset paths), so the single canonical
// copy of GSAP and the fonts lives in animations/_shared and is synced into each project. The synced
// copies are GITIGNORED (animations/.gitignore): check.mjs and render.mjs run this first, so a fresh
// clone needs no manual step.
//
//   node tools/anim/sync-shared.mjs            sync all projects
//   node tools/anim/sync-shared.mjs a01        sync projects whose id starts with "a01"
//   node tools/anim/sync-shared.mjs --check    exit 1 if any synced copy is missing or stale (writes nothing)
//   node tools/anim/sync-shared.mjs --prune    also delete files in vendor/ and assets/fonts/ that are not in _shared
import { listProjects, syncShared } from './lib.mjs';

export function syncAll(only = [], opts = {}) {
  const results = [];
  for (const id of listProjects(only)) results.push({ id, ...syncShared(id, opts) });
  return results;
}

function main(argv) {
  const check = argv.includes('--check');
  const prune = argv.includes('--prune');
  const only = argv.filter(a => !a.startsWith('--'));
  const results = syncAll(only, { dryRun: check, prune });
  let stale = 0;
  for (const r of results) {
    const changed = r.copied.length + r.removed.length;
    stale += changed;
    const verb = check ? 'stale' : 'synced';
    console.log(`${r.id}: ${changed ? `${verb} ${r.copied.length} file(s)${r.removed.length ? `, removed ${r.removed.length}` : ''}` : `up to date (${r.upToDate} files)`}`);
    for (const f of r.copied) console.log(`  ${check ? 'differs' : 'copied'}  ${f}`);
    for (const f of r.removed) console.log(`  ${check ? 'extra' : 'removed'}  ${f}`);
  }
  if (!results.length) console.log('No animation projects found.');
  if (check && stale) {
    console.error('Synced copies are out of date. Run: node tools/anim/sync-shared.mjs');
    process.exit(1);
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
