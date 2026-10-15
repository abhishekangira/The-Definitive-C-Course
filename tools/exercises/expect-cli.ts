// npm run exercises:expect [-- --module m01] [--only id] [--content-root dir] [--cc gcc] [--check]
// Regenerates tests.json / check.json from cases.yaml by running the reference solutions.
// Exit status 1 when a solution is rejected, a cases.yaml is missing/invalid, or (with --check) a file would change.
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
    const state = !i.ok ? '✗' : i.changed ? (o.check ? '≠' : '✎') : '✓';
    console.log(`  ${state} ${i.id.padEnd(34)} ${i.ok ? `${i.cases} ${i.cases === 1 ? "case" : "cases"} → ${path.basename(rel)}${i.changed ? (o.check ? ' would change' : ' updated') : ' unchanged'}` : ''}`);
    for (const p of i.problems) console.log(`      - ${p.replace(/\n/g, '\n        ')}`);
  }
  const bad = items.filter(i => !i.ok), changed = items.filter(i => i.changed);
  if (items.length === 0) console.log('No exercises or projects found.');
  else console.log(`\n${items.length} checked, ${bad.length} rejected, ${changed.length} ${o.check ? 'would change' : 'updated'}.`);
  process.exitCode = bad.length || (o.check && changed.length) ? 1 : 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
}
