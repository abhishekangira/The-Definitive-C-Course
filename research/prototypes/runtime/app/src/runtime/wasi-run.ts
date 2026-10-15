// Runs a wasm32-wasip1 *command* module with @bjorn3/browser_wasi_shim. No DOM; usable in a Worker or Node.
import { WASI, WASIProcExit, Fd, File, Directory, PreopenDirectory, wasi as W } from '@bjorn3/browser_wasi_shim';
import type { RunResult } from './protocol';

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
      const chunk = this.readChunk(size);            // may block on Atomics.wait (SAB mode)
      if (!chunk || chunk.length === 0) return { ret: 0, data: EMPTY }; // EOF for this read; TTY-like, later reads ask again
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
  // CHARACTER_DEVICE without seek rights => isatty() is true => stdout line-buffered, like a terminal.
  fd_fdstat_get() { const s = new W.Fdstat(W.FILETYPE_CHARACTER_DEVICE, 0); s.fs_rights_base = BigInt(W.RIGHTS_FD_WRITE); return { ret: 0, fdstat: s }; }
  fd_filestat_get() { return { ret: 0, filestat: new W.Filestat(0n, W.FILETYPE_CHARACTER_DEVICE, 0n) }; }
  fd_write(data: Uint8Array) {
    if (data.byteLength === 0) return { ret: 0, nwritten: 0 };   // musl emits zero-length iovecs
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

type Tree = { [name: string]: string | Uint8Array | Tree };
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
  for (const [k, v] of m) o[k] = v instanceof File ? v.data : fromMap((v as Directory).contents);
  return o;
}

const TRAP_HINTS: Array<[RegExp, string]> = [
  [/unreachable/, 'abort(), failed assert(), or a sanitizer trap (native: SIGABRT / SIGILL)'],
  [/memory access out of bounds/, 'invalid memory access, e.g. stack overflow or wild pointer (native: SIGSEGV)'],
  [/divide by zero/, 'integer division by zero (native: SIGFPE)'],
  [/integer overflow/, 'INT_MIN / -1 (native: SIGFPE)'],
  [/call stack|too much recursion/i, 'call stack exhausted (native: SIGSEGV)'],
];

export type RunOptions = {
  bytes?: Uint8Array; module?: WebAssembly.Module;
  args?: string[]; env?: string[]; files?: Tree;
  stdout: (b: Uint8Array) => void; stderr: (b: Uint8Array) => void;
  stdinSync?: (max: number) => Uint8Array | null;           // preset / SAB modes
  stdinAsync?: (max: number) => Promise<Uint8Array | null>; // JSPI mode
  beforeStdinRead?: () => void;
  maxOutput?: number;
  onInstantiated?: (ms: number) => void;
};

export const hasJSPI = () => typeof (WebAssembly as any).Suspending === 'function' && typeof (WebAssembly as any).promising === 'function';

export async function runWasi(o: RunOptions): Promise<RunResult> {
  const budget = { used: 0, max: o.maxOutput ?? 1 << 20 };
  const root = new PreopenDirectory('/', toMap({ tmp: {}, ...(o.files ?? {}) }) as any);
  let instance: WebAssembly.Instance | undefined;
  let jspiChunk: Uint8Array | null = null;
  const stdin = new StdinFd(
    o.stdinAsync ? () => { const c = jspiChunk; jspiChunk = null; return c; } : (o.stdinSync ?? (() => null)),
    () => { (instance?.exports.__course_flush_stdout as (() => void) | undefined)?.(); o.beforeStdinRead?.(); },
  );
  const fds = [stdin, new OutFd(o.stdout, budget), new OutFd(o.stderr, budget), root];
  const w = new WASI(o.args ?? ['main'], o.env ?? [], fds, { debug: false }); // NB 0.4.2: omitting {debug:false} turns logging ON
  const imports: Record<string, any> = { ...w.wasiImport };
  if (o.stdinAsync) {
    const syncRead = w.wasiImport.fd_read as (...a: number[]) => number;
    imports.fd_read = new (WebAssembly as any).Suspending(async (fd: number, iovs: number, n: number, nread: number) => {
      if (fd === 0 && stdin.pending.length === 0) {
        (instance?.exports.__course_flush_stdout as (() => void) | undefined)?.();
        jspiChunk = await o.stdinAsync!(4096);       // wasm stack is suspended here; worker event loop keeps running
      }
      return syncRead(fd, iovs, n, nread);
    });
  }
  const t0 = performance.now();
  const module = o.module ?? await WebAssembly.compile(o.bytes as BufferSource);
  instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: imports });
  o.onInstantiated?.(performance.now() - t0);
  (w as any).inst = instance;
  const start = instance.exports._start as () => void;
  const t1 = performance.now();
  let result: RunResult;
  try {
    if (o.stdinAsync) await (WebAssembly as any).promising(start)();
    else start();
    result = { kind: 'exit', exitCode: 0, ms: 0 };
  } catch (e: any) {
    if (e instanceof WASIProcExit) result = { kind: 'exit', exitCode: e.code, ms: 0 };
    else if (e instanceof OutputLimitExceeded) result = { kind: 'output-limit', exitCode: null, message: e.message, ms: 0 };
    else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {
      const hint = TRAP_HINTS.find(([re]) => re.test(e.message))?.[1] ?? 'runtime trap';
      result = { kind: 'trap', exitCode: null, message: e.message, hint, ms: 0 };
    } else throw e;
  }
  result.ms = performance.now() - t1;
  result.files = fromMap(root.dir.contents as any);
  return result;
}
