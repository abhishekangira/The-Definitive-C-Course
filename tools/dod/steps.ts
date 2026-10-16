// The ordered steps of the per-module definition of done (PLAN.md §3.6) and how to build them for one module.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface Step {
  id: string;
  /** PLAN.md §3.6 point (1-7) this step belongs to. */
  point: number;
  name: string;
  /** Program and arguments, run from the repo root. Empty when `skip` is set. */
  command: string[];
  env?: Record<string, string>;
  /** When set the step is not run and is reported as `SKIPPED (<reason>)`. */
  skip?: string;
}

export interface BuildOptions { module: string; fast?: boolean; contentRoot: string }

export function findModuleDir(contentRoot: string, module: string): string | undefined {
  const modules = path.join(contentRoot, 'modules');
  if (!existsSync(modules)) return undefined;
  const dir = readdirSync(modules).find(d => d.startsWith(`${module}-`));
  return dir && path.join(modules, dir);
}

/** Ids of the `<Animation id="…">` elements the module's lessons reference (unique, in order of appearance). */
export function animationIds(moduleDir: string): string[] {
  const lessons = path.join(moduleDir, 'lessons');
  const ids = new Set<string>();
  if (!existsSync(lessons)) return [];
  for (const f of readdirSync(lessons).filter(f => f.endsWith('.mdx')).sort()) {
    for (const m of readFileSync(path.join(lessons, f), 'utf8').matchAll(/<Animation\s+id="([^"]+)"/g)) ids.add(m[1]);
  }
  return [...ids];
}

const npm = (...args: string[]) => ['npm', 'run', '--silent', ...args];

/** Steps in the order they run (sequentially: the checks are timing-sensitive on small machines). */
export function buildSteps({ module, fast = false, contentRoot }: BuildOptions): Step[] {
  const dir = findModuleDir(contentRoot, module);
  if (!dir) throw new Error(`unknown module "${module}": no ${contentRoot}/modules/${module}-* directory`);
  const anims = animationIds(dir);
  const steps: Step[] = [
    { id: 'typecheck', point: 6, name: 'typecheck', command: npm('typecheck') },
    { id: 'lint', point: 3, name: 'lint:content --strict', command: npm('lint:content', '--', '--strict', '--module', module) },
    { id: 'verify', point: 1, name: 'verify --check', command: npm('verify', '--', '--check', '--module', module) },
    { id: 'trace', point: 1, name: 'trace --check', command: npm('trace', '--', '--check', '--module', module) },
    { id: 'exercises', point: 2, name: 'verify:exercises', command: npm('verify:exercises', '--', '--module', module) },
    { id: 'videos', point: 5, name: 'videos:check', command: npm('videos:check') },
    anims.length
      ? { id: 'anim', point: 4, name: `anim:check --static (${anims.join(', ')})`, command: ['sh', '-c', anims.map(a => `npm run --silent anim:check -- --static ${a}`).join(' && ')] }
      : { id: 'anim', point: 4, name: 'anim:check --static', command: [], skip: 'module references no animation' },
    { id: 'unit', point: 6, name: 'unit tests of tools/', command: npm('test', '--', 'tools') },
    fast
      ? { id: 'build', point: 6, name: 'build', command: [], skip: '--fast' }
      : { id: 'build', point: 6, name: 'build', command: npm('build') },
    fast
      ? { id: 'e2e', point: 6, name: 'e2e', command: [], skip: '--fast' }
      : { id: 'e2e', point: 6, name: `e2e (${module})`, command: npm('e2e'), env: { E2E_MODULE: module } },
    { id: 'targets', point: 7, name: 'platform targets', command: [], skip: 'CI Targets workflow only' },
  ];
  return steps;
}
