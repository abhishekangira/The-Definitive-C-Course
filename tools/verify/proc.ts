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

/**
 * `group` (POSIX only): run the child as the leader of its own process group, and kill the whole group on timeout and
 * once the leader exits. Without it a timeout kills only `cmd`, and a grandchild that keeps the pipes open (a shell's
 * `leaks` or `lldb`) holds off `close`, so the timeout never ends the run (issue #73, Targets run 39498908355).
 */
export function run(cmd: string, args: string[], o: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; group?: boolean } = {}): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const group = !!o.group && process.platform !== 'win32';
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: group });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const killGroup = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* the group is already gone */ } };
    const timer = o.timeoutMs ? setTimeout(() => { timedOut = true; if (group) killGroup(); else child.kill('SIGKILL'); }, o.timeoutMs) : null;
    // The leader has exited: anything it left behind in its group (a stray background job) would hold the pipes open.
    // A process outside the group (one that called setsid) could still hold them, so stop reading after 2 s.
    if (group) child.on('exit', () => { killGroup(); setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, 2000).unref(); });
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
