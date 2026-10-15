// ExecBackend for the in-browser toolchain, run in Node: the same @yowasp/clang copy, flags, support
// files (tools/shared/wasm-node.ts) and WASI runner (src/runtime/wasi-run.ts) that learners get, so
// "the reference solution passes" means it passes in the browser too.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import type { RunResult } from '../../src/runtime/protocol';
import { decodeBytes } from '../../src/testing/compare';
import { outcomeFromWasi, toFileTree, type CompileOptions, type CompileOutcome, type ExecBackend, type ExecOutcome, type ExecRunOptions } from '../../src/testing/exec';
import { compileWasm, wasmCompilerVersion } from '../shared/wasm-node';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Worker start-up and module compilation are not the program's fault: allow for them on top of the budget. */
const STARTUP_ALLOWANCE_MS = 1000;
const MAX_OUTPUT = 1 << 20;

let workerFile: Promise<string> | undefined;
let workerDir: string | undefined;

/** Bundles the worker once per process (tsx's loader does not apply inside worker threads). */
function bundledWorker(): Promise<string> {
  return (workerFile ??= (async () => {
    workerDir = mkdtempSync(path.join(tmpdir(), 'tdcc-wasm-worker-'));
    const outfile = path.join(workerDir, 'wasm-run-worker.mjs');
    await build({ entryPoints: [path.join(HERE, 'wasm-run-worker.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' });
    process.once('exit', () => { if (workerDir) rmSync(workerDir, { recursive: true, force: true }); });
    return outfile;
  })());
}

export class WasmNodeBackend implements ExecBackend<Uint8Array> {
  readonly name = `${wasmCompilerVersion()} (browser toolchain)`;
  readonly combinedMemoryBuild = true;
  readonly memoryNote = 'the course leak checker';
  readonly memoryHint = 'The leak checker reports where the block was allocated: follow that pointer and make sure every path frees it exactly once.';

  async compile(files: Record<string, string>, sources: string[], o: CompileOptions): Promise<CompileOutcome<Uint8Array>> {
    const tree = toFileTree(files) as unknown as Record<string, string>; // nested objects are directories
    const r = await compileWasm({ files: tree, sources, guardrail: o.guardrail, leakcheck: o.leakcheck, extraFlags: o.extraFlags });
    return { ok: r.ok, diagnostics: r.diagnostics, raw: r.raw, artifact: r.wasm };
  }

  async run(wasm: Uint8Array, o: ExecRunOptions): Promise<ExecOutcome> {
    const file = await bundledWorker();
    return new Promise<ExecOutcome>(resolve => {
      const worker = new Worker(file, { workerData: { wasm, stdin: o.stdin ?? '', args: o.args ?? [], maxOutput: MAX_OUTPUT } });
      let settled = false;
      const done = (r: ExecOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(r);
      };
      const timer = setTimeout(() => done({ stdout: '', stderr: '', exit: null, timedOut: true }), o.timeoutMs + STARTUP_ALLOWANCE_MS);
      worker.once('message', (m: { result: RunResult; stdout: Uint8Array; stderr: Uint8Array }) =>
        done(outcomeFromWasi(m.result, decodeBytes(m.stdout), decodeBytes(m.stderr))));
      worker.once('error', e => done({ stdout: '', stderr: '', exit: null, trap: e.message }));
    });
  }
}
