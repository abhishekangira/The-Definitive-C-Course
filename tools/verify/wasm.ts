// The browser target (wasm32-clang22): the shipped @yowasp/clang copy, the browser flags and
// browser_wasi_shim, all run in Node (tools/shared/wasm-node.ts), so CI checks what learners run.
import { compileWasm, wasmCompilerVersion } from '../shared/wasm-node';
import { WasmRunner } from '../shared/wasm-run-isolated';
import type { Diagnostic } from '../../src/content-model/types';
import { Mutex } from './proc';

export interface WasmCompileResult {
  ok: boolean;
  wasm?: Uint8Array;
  diagnostics: Diagnostic[];
  raw: string;
}

export interface WasmRunResult {
  stdout: string;
  stderr: string;
  exit: number | null;
  /** Trap message ("memory access out of bounds", "unreachable", …). */
  trap: string | null;
  /** "output-limit" when the program exceeded the output cap. */
  signal: string | null;
  timedOut: boolean;
}

export class WasmTarget {
  readonly version = wasmCompilerVersion();
  private runner = new WasmRunner();
  /** The yowasp compiler runs in this thread and is not re-entrant: one compile at a time. */
  private compiler = new Mutex();

  compile(code: string, o: { guardrail?: boolean } = {}): Promise<WasmCompileResult> {
    return this.compiler.lock(async () => {
      const r = await compileWasm({ files: { 'main.c': code }, sources: ['main.c'], guardrail: o.guardrail });
      return { ok: r.ok, wasm: r.wasm, diagnostics: r.diagnostics, raw: r.raw };
    });
  }

  async run(wasm: Uint8Array, o: { stdin?: string; args?: string[]; timeoutMs: number }): Promise<WasmRunResult> {
    const r = await this.runner.run(wasm, { stdin: o.stdin, args: o.args, timeoutMs: o.timeoutMs, maxOutput: 1 << 20 });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exit: r.kind === 'exit' ? r.exitCode : null,
      trap: r.kind === 'trap' ? (r.message ?? 'trap') : null,
      signal: r.kind === 'output-limit' ? 'output-limit' : null,
      timedOut: r.kind === 'timeout',
    };
  }

  close(): Promise<void> {
    return this.runner.close();
  }
}
