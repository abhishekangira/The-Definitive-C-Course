// `npm run e2e:stress`: the full e2e suite, repeated, while busy-loop processes load the CPUs.
// E2E_STRESS_LOAD   number of busy loops (default: the CPU count, so the suite competes for every core)
// E2E_STRESS_REPEAT --repeat-each value (default 5)
// Extra arguments go to `playwright test`, e.g. `npm run e2e:stress -- course.spec.ts -g "Functions"`.
// Run `npm run build` first. Exit code is Playwright's.
import { spawn } from 'node:child_process';
import { availableParallelism, loadavg } from 'node:os';

const load = Number(process.env.E2E_STRESS_LOAD || availableParallelism());
const repeat = Number(process.env.E2E_STRESS_REPEAT || 5);
if (!Number.isInteger(load) || load < 0 || !Number.isInteger(repeat) || repeat < 1) {
  console.error('E2E_STRESS_LOAD must be an integer >= 0 and E2E_STRESS_REPEAT an integer >= 1');
  process.exit(2);
}

const loops = Array.from({ length: load }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
const stopLoops = () => { for (const l of loops) l.kill('SIGKILL'); };
process.on('exit', stopLoops);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopLoops(); process.exit(130); });

console.log(`e2e:stress: ${load} busy loops on ${availableParallelism()} usable CPUs, --repeat-each=${repeat}, load average at start ${loadavg()[0].toFixed(1)}`);
const started = Date.now();
const pw = spawn('npx', ['playwright', 'test', `--repeat-each=${repeat}`, '--retries=0', ...process.argv.slice(2)], { stdio: 'inherit' });
pw.on('exit', code => {
  console.log(`e2e:stress: exit ${code} after ${Math.round((Date.now() - started) / 1000)} s, load average at end ${loadavg()[0].toFixed(1)}`);
  stopLoops();
  process.exit(code ?? 1);
});
