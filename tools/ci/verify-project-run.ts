// CI helper for the "Project runner" job in .github/workflows/targets.yml (issue #10).
//   npx tsx tools/ci/verify-project-run.ts <starter|solution> <seed> <exercise> <exit-code> <output-file>
// Checks what `make test` did in an unzipped project: the starter must have failed (non-zero exit) and
// printed a progress code, the solution must have passed (exit 0) and printed a completion token, and
// the code must be accepted by the app's real verifyCode() with the seed written into .learner.
import { readFileSync } from 'node:fs';
import { verifyCode } from '../../src/testing/token';

const [kind, seed, exercise, exitCode, file] = process.argv.slice(2);
const fail = (msg: string): never => {
  console.error(`FAIL (${kind}): ${msg}`);
  process.exit(1);
};
let output = '';
try {
  output = readFileSync(file, 'utf8');
} catch {
  fail(`cannot read the log file "${file}" (did \`make test\` run?)`);
}

if (kind !== 'starter' && kind !== 'solution') fail('first argument must be starter or solution');
if (kind === 'starter' && exitCode === '0') fail('the starter passed `make test`; it must fail');
if (kind === 'solution' && exitCode !== '0') fail(`the solution failed \`make test\` (exit ${exitCode})`);

const line = output.split('\n').find(l => /TDCC1-R\d+-/i.test(l));
if (!line) fail('no TDCC1 code in the output');
const result = await verifyCode(line!, seed, { exercise });
if (!result.ok) fail(`verifyCode rejected the code: ${result.reason}: ${result.message}`);
if (result.ok) {
  const want = kind === 'starter' ? 'progress' : 'completion';
  if (result.code.type !== want) fail(`expected a ${want} code, got ${result.code.type}`);
  if (result.code.type === 'progress' && result.passed === result.total) fail('progress code says every check passed');
  console.log(`OK (${kind}): ${line!.trim()} accepted as ${result.code.type}`);
}
