// Promise-based child processes (so native compiles/runs of several samples overlap with each
// other and with the in-process wasm compiler), plus tiny concurrency helpers.
import { spawn } from 'node:child_process';

export interface ProcResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function run(cmd: string, args: string[], o: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = o.timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs) : null;
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', e => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (status, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ status, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut });
    });
    child.stdin.on('error', () => {}); // the child may exit without reading its input
    child.stdin.end(o.input ?? '');
  });
}

/** Runs async functions one at a time (for resources that are not re-entrant). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  lock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

/** Maps with at most `limit` calls in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
