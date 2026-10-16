// npm run exercises:expect [-- --module m01] [--only id] [--content-root dir] [--cc gcc] [--check]
// Regenerates tests.json / check.json from cases.yaml by running the reference solutions.
// Exit status 1 when a solution is rejected, a cases.yaml is invalid, (with --check) a file would change,
// or --only/--module matches nothing. Folders with no cases.yaml are skipped (not rejected).
import path from 'node:path';
import { ROOT } from '../shared/wasm-node';
import { expectAll } from './expect';

const USAGE = 'usage: exercises:expect [--module m01] [--only id] [--content-root dir] [--cc gcc] [--check]';

function parseArgs(argv: string[]) {
  const o = { contentRoot: path.join(ROOT, 'content'), module: undefined as string | undefined, only: undefined as string | undefined, cc: undefined as string | undefined, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value\n${USAGE}`); return argv[++i]; };
    if (a === '--module') o.module = next();
    else if (a === '--only') o.only = next();
    else if (a === '--content-root') o.contentRoot = path.resolve(next());
    else if (a === '--cc') o.cc = next();
    else if (a === '--check') o.check = true;
    else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  return o;
}

try {
  const o = parseArgs(process.argv.slice(2));
  const items = expectAll(o);
  for (const i of items) {
    const rel = path.relative(process.cwd(), i.target);
    const state = i.skipped ? '·' : !i.ok ? '✗' : i.changed ? (o.check ? '≠' : '✎') : '✓';
    if (i.skipped) console.log(`  ${state} ${i.id.padEnd(34)} skipped (no cases.yaml)`);
    else console.log(`  ${state} ${i.id.padEnd(34)} ${i.ok ? `${i.cases} ${i.cases === 1 ? "case" : "cases"} → ${path.basename(rel)}${i.changed ? (o.check ? ' would change' : ' updated') : ' unchanged'}` : ''}`);
    for (const p of i.problems) console.log(`      - ${p.replace(/\n/g, '\n        ')}`);
  }
  const active = items.filter(i => !i.skipped);
  const bad = active.filter(i => !i.ok), changed = active.filter(i => i.changed), skipped = items.filter(i => i.skipped);
  const filtered = o.only !== undefined || o.module !== undefined;
  if (items.length === 0) {
    console.log(filtered ? `No exercises or projects matched${o.only ? ` --only ${o.only}` : ''}${o.module ? ` --module ${o.module}` : ''}.` : 'No exercises or projects found.');
  } else {
    console.log(`\n${active.length} checked, ${skipped.length} skipped, ${bad.length} rejected, ${changed.length} ${o.check ? 'would change' : 'updated'}.`);
  }
  // Empty result with an explicit filter is a hard failure (typo in --only/--module must not silently pass).
  process.exitCode = (filtered && items.length === 0) || bad.length || (o.check && changed.length) ? 1 : 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
}
