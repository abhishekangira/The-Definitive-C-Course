// Runs a wasm32-wasip1 command module with @bjorn3/browser_wasi_shim. No DOM: used by the run worker
// in the browser and by tools/verify in Node, so CI executes programs exactly the way learners do.
import { WASI, WASIProcExit, Fd, File, Directory, PreopenDirectory, wasi as W } from '@bjorn3/browser_wasi_shim';
import type { LeakEvent, RunResult } from './protocol';
import { LEAKCHECK_REPORT } from './flags';

export class OutputLimitExceeded extends Error {}
const EMPTY = new Uint8Array(0);

class StdinFd extends Fd {
  pending: Uint8Array = EMPTY;
  constructor(private readChunk: (max: number) => Uint8Array | null, private beforeRead: () => void) { super(); }
  fd_fdstat_get() { const s = new W.Fdstat(W.FILETYPE_CHARACTER_DEVICE, 0); s.fs_rights_base = BigInt(W.RIGHTS_FD_READ); return { ret: 0, fdstat: s }; }
  fd_filestat_get() { return { ret: 0, filestat: new W.Filestat(0n, W.FILETYPE_CHARACTER_DEVICE, 0n) }; }
  fd_read(size: number) {
    if (this.pending.length === 0) {
      this.beforeRead();
      const chunk = this.readChunk(size); // may block on Atomics.wait (SAB mode)
      if (!chunk || chunk.length === 0) return { ret: 0, data: EMPTY }; // EOF for this read
      this.pending = chunk;
    }
    const n = Math.min(size, this.pending.length);
    const out = this.pending.slice(0, n);
    this.pending = this.pending.subarray(n);
    return { ret: 0, data: out };
  }
}

class OutFd extends Fd {
  constructor(private sink: (b: Uint8Array) => void, private budget: { used: number; max: number }) { super(); }
  // A character device without seek rights makes isatty() true, so stdout is line-buffered like a terminal.
  fd_fdstat_get() { const s = new W.Fdstat(W.FILETYPE_CHARACTER_DEVICE, 0); s.fs_rights_base = BigInt(W.RIGHTS_FD_WRITE); return { ret: 0, fdstat: s }; }
  fd_filestat_get() { return { ret: 0, filestat: new W.Filestat(0n, W.FILETYPE_CHARACTER_DEVICE, 0n) }; }
  fd_write(data: Uint8Array) {
    if (data.byteLength === 0) return { ret: 0, nwritten: 0 }; // musl emits zero-length iovecs
    this.budget.used += data.byteLength;
    if (this.budget.used > this.budget.max) {
      const allowed = data.byteLength - (this.budget.used - this.budget.max);
      if (allowed > 0) this.sink(data.subarray(0, allowed));
      throw new OutputLimitExceeded(`output limit of ${this.budget.max} bytes exceeded`);
    }
    this.sink(data);
    return { ret: 0, nwritten: data.byteLength };
  }
}

export type Tree = { [name: string]: string | Uint8Array | Tree };
function toMap(t: Tree): Map<string, File | Directory> {
  const m = new Map<string, File | Directory>();
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === 'string') m.set(k, new File(new TextEncoder().encode(v)));
    else if (v instanceof Uint8Array) m.set(k, new File(v));
    else m.set(k, new Directory(toMap(v)));
  }
  return m;
}
function fromMap(m: Map<string, unknown>): Tree {
  const o: Tree = {};
  for (const [k, v] of m) o[k] = v instanceof File ? v.data : fromMap((v as Directory).contents as Map<string, unknown>);
  return o;
}

const TRAP_HINTS: Array<[RegExp, string]> = [
  [/unreachable/, 'The program called abort(), an assert() failed, or a check trapped. Natively this is SIGABRT.'],
  [/memory access out of bounds/, 'The program touched memory outside its address space (often a stack overflow or a wild pointer). Natively this is SIGSEGV.'],
  [/divide by zero/, 'Integer division by zero. Natively this is SIGFPE.'],
  [/divide result unrepresentable|integer overflow/, 'INT_MIN / -1 does not fit in an int. Natively this is SIGFPE.'],
  [/call stack|too much recursion/i, 'The call stack ran out (infinite or very deep recursion). Natively this is SIGSEGV.'],
  [/null function|signature mismatch/, 'A call through a NULL or wrongly typed function pointer. Natively this is usually SIGSEGV.'],
];

export function trapHint(message: string): string {
  return TRAP_HINTS.find(([re]) => re.test(message))?.[1] ?? 'The program stopped with a runtime trap.';
}

export interface RunOptions {
  bytes?: Uint8Array;
  module?: WebAssembly.Module;
  args?: string[];
  env?: string[];
  files?: Tree;
  stdout: (b: Uint8Array) => void;
  stderr: (b: Uint8Array) => void;
  stdinSync?: (max: number) => Uint8Array | null; // preset / SAB modes
  stdinAsync?: (max: number) => Promise<Uint8Array | null>; // JSPI mode
  beforeStdinRead?: () => void;
  /** Called when the program starts/stops sleeping (so the CPU watchdog can pause). JSPI only. */
  onSleep?: (sleeping: boolean) => void;
  maxOutput?: number;
  onInstantiated?: (ms: number) => void;
}

type WasmJSPI = typeof WebAssembly & {
  Suspending: new (fn: (...a: number[]) => Promise<number>) => unknown;
  promising: (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => Promise<unknown>;
};
export const hasJSPI = (): boolean =>
  typeof (WebAssembly as Partial<WasmJSPI>).Suspending === 'function' && typeof (WebAssembly as Partial<WasmJSPI>).promising === 'function';

function parseLeakReport(bytes: unknown): LeakEvent[] | undefined {
  if (!(bytes instanceof Uint8Array)) return undefined;
  return new TextDecoder().decode(bytes).split('\n').filter(Boolean).map(l => JSON.parse(l) as LeakEvent);
}

export async function runWasi(o: RunOptions): Promise<RunResult> {
  const budget = { used: 0, max: o.maxOutput ?? 1 << 20 };
  const root = new PreopenDirectory('/', toMap({ tmp: {}, ...(o.files ?? {}) }) as never);
  let instance: WebAssembly.Instance | undefined;
  let jspiChunk: Uint8Array | null = null;
  const flushProgramStdout = () => (instance?.exports.__course_flush_stdout as (() => void) | undefined)?.();
  const stdin = new StdinFd(
    o.stdinAsync ? () => { const c = jspiChunk; jspiChunk = null; return c; } : (o.stdinSync ?? (() => null)),
    () => { flushProgramStdout(); o.beforeStdinRead?.(); },
  );
  const fds = [stdin, new OutFd(o.stdout, budget), new OutFd(o.stderr, budget), root];
  const w = new WASI(o.args ?? ['main'], o.env ?? [], fds, { debug: false }); // 0.4.2: omitting {debug:false} turns logging ON
  const imports: Record<string, unknown> = { ...w.wasiImport };
  const jspi = hasJSPI();
  const J = WebAssembly as WasmJSPI;

  if (jspi && o.stdinAsync) {
    const syncRead = w.wasiImport.fd_read as (...a: number[]) => number;
    imports.fd_read = new J.Suspending(async (fd: number, iovs: number, n: number, nread: number) => {
      if (fd === 0 && stdin.pending.length === 0) {
        flushProgramStdout();
        jspiChunk = await o.stdinAsync!(4096); // the wasm stack is suspended; the worker's event loop keeps running
      }
      return syncRead(fd, iovs, n, nread);
    });
  }

  if (jspi) {
    // sleep()/nanosleep(): browser_wasi_shim busy-waits in poll_oneoff. Suspend instead, so the CPU is
    // idle and the watchdog can pause. Only all-clock subscriptions are handled here.
    const syncPoll = w.wasiImport.poll_oneoff as (...a: number[]) => number;
    imports.poll_oneoff = new J.Suspending(async (inPtr: number, outPtr: number, nsubs: number, neventsPtr: number) => {
      const memory = instance!.exports.memory as WebAssembly.Memory;
      let view = new DataView(memory.buffer);
      let waitNs = Infinity;
      for (let i = 0; i < nsubs; i++) {
        const base = inPtr + 48 * i;
        if (view.getUint8(base + 8) !== 0) return syncPoll(inPtr, outPtr, nsubs, neventsPtr); // not a clock
        let ns = Number(view.getBigUint64(base + 24, true));
        if (view.getUint16(base + 40, true) & 1) { // absolute time
          const clock = view.getUint32(base + 16, true);
          const now = clock === 0 ? Date.now() * 1e6 : performance.now() * 1e6;
          ns = Math.max(0, ns - now);
        }
        waitNs = Math.min(waitNs, ns);
      }
      o.onSleep?.(true);
      await new Promise(r => setTimeout(r, Math.min(waitNs / 1e6, 2 ** 31 - 1)));
      o.onSleep?.(false);
      view = new DataView(memory.buffer);
      for (let i = 0; i < nsubs; i++) {
        const ev = outPtr + 32 * i;
        view.setBigUint64(ev, view.getBigUint64(inPtr + 48 * i, true), true); // userdata
        view.setUint16(ev + 8, 0, true); // errno: success
        view.setUint8(ev + 10, 0); // type: clock
      }
      view.setUint32(neventsPtr, nsubs, true);
      return 0;
    });
  }

  const t0 = performance.now();
  const module = o.module ?? (await WebAssembly.compile(o.bytes as BufferSource));
  instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: imports } as WebAssembly.Imports);
  o.onInstantiated?.(performance.now() - t0);
  (w as unknown as { inst: WebAssembly.Instance }).inst = instance;
  const start = instance.exports._start as () => void;
  const t1 = performance.now();
  let result: RunResult;
  try {
    // Under JSPI the program always runs inside promising(): stdin and sleep can suspend, and the
    // usable recursion depth roughly doubles.
    if (jspi) await J.promising(start as (...a: unknown[]) => unknown)();
    else start();
    result = { kind: 'exit', exitCode: 0, ms: 0 };
  } catch (e) {
    if (e instanceof WASIProcExit) result = { kind: 'exit', exitCode: e.code, ms: 0 };
    else if (e instanceof OutputLimitExceeded) result = { kind: 'output-limit', exitCode: null, message: e.message, ms: 0 };
    else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {
      result = { kind: 'trap', exitCode: null, message: e.message, hint: trapHint(e.message), ms: 0 };
    } else throw e;
  }
  result.ms = performance.now() - t1;
  const files = fromMap(root.dir.contents as unknown as Map<string, unknown>);
  result.leakcheck = parseLeakReport(files[LEAKCHECK_REPORT]);
  delete files[LEAKCHECK_REPORT];
  result.files = files;
  return result;
}
