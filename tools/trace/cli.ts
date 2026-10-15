// npm run trace [-- --module m01] [--check] [--force] [--valgrind]
// Writes src/generated/traces/<sampleId>.json for every sample with `trace` (npm run verify does
// this too, after verifying). Hidden: --content-root, --generated-root, --cache-dir.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../shared/wasm-node';
import { discover } from '../verify/discover';
import { runTraces } from './run-traces';

function main(): void {
  const argv = process.argv.slice(2);
  let module: string | undefined;
  let contentRoot = path.join(ROOT, 'content');
  let generatedRoot = path.join(ROOT, 'src/generated');
  let cacheDir = path.join(ROOT, '.cache/verify/traces');
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) { console.error(`trace: ${k} needs a value`); process.exit(2); }
      return v;
    };
    if (k === '--module') module = val();
    else if (k === '--content-root') contentRoot = path.resolve(val());
    else if (k === '--generated-root') generatedRoot = path.resolve(val());
    else if (k === '--cache-dir') cacheDir = path.resolve(val());
    else if (['--check', '--force', '--valgrind'].includes(k)) flags.add(k);
    else { console.error(`trace: unknown argument ${k}\nusage: tsx tools/trace/cli.ts [--module mNN] [--check] [--force] [--valgrind]`); process.exit(2); }
  }
  const found = discover({ contentRoot, module });
  const workDir = path.join(tmpdir(), `tdcc-trace-${process.pid}`);
  mkdirSync(workDir, { recursive: true });
  process.once('exit', () => rmSync(workDir, { recursive: true, force: true }));
  const t0 = performance.now();
  const r = runTraces(found.samples, {
    generatedRoot, cacheDir, workDir, check: flags.has('--check'), force: flags.has('--force'),
    valgrind: flags.has('--valgrind') || undefined, log: console.log,
  });
  const problems = [...found.errors, ...r.problems, ...r.stale.map(id => `traces/${id}.json is stale; run npm run trace and commit`)];
  for (const n of r.notes) console.log(`note: ${n}`);
  for (const p of problems) console.log(`[FAIL] ${p}`);
  for (const id of r.written) console.log(`wrote ${path.relative(process.cwd(), path.join(generatedRoot, 'traces', `${id}.json`))}`);
  const total = found.samples.filter(s => s.meta.trace).length;
  console.log(`${total} trace sample(s): ${r.written.length} written, ${r.unchanged.length} unchanged, ${problems.length} problem(s) in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  process.exit(problems.length ? 1 : 0);
}

main();
