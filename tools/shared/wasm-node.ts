// Node access to the in-browser toolchain: the same slimmed @yowasp/clang copy that ships in
// public/toolchain, the same support files, the same compile-core and the same WASI runner.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { compileC, type CompileInput, type CompileOutput, type RunClang, type SupportFiles } from '../../src/runtime/compile-core';
import { runWasi } from '../../src/runtime/wasi-run';
import type { RunResult } from '../../src/runtime/protocol';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function toolchainVersion(): { version: string; totalSize: number } {
  const f = path.join(ROOT, 'src/generated/toolchain-version.json');
  if (!existsSync(f)) execFileSync(process.execPath, [path.join(ROOT, 'tools/toolchain/prepare.mjs')], { stdio: 'inherit' });
  return JSON.parse(readFileSync(f, 'utf8'));
}

export function supportFiles(): SupportFiles {
  const dir = path.join(ROOT, 'src/runtime/c');
  const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
  return {
    'course_rt.c': read('course_rt.c'),
    'ubsan_rt.c': read('ubsan_rt.c'),
    'leakcheck.c': read('leakcheck.c'),
    'leakcheck.h': read('leakcheck.h'),
    'learnc.h': read('learnc.h'),
  };
}

let clangP: Promise<RunClang> | null = null;
export function loadClang(): Promise<RunClang> {
  return (clangP ??= (async () => {
    const { version } = toolchainVersion();
    const bundle = path.join(ROOT, 'public/toolchain', `clang-${version}`, 'bundle.js');
    if (!existsSync(bundle)) execFileSync(process.execPath, [path.join(ROOT, 'tools/toolchain/prepare.mjs'), '--force'], { stdio: 'inherit' });
    const mod = (await import(pathToFileURL(bundle).href)) as { runClang: RunClang };
    await mod.runClang(null, {}, { fetchProgress: () => {} }); // prefetch; silences the default progress logger
    return mod.runClang;
  })());
}

export function wasmCompilerVersion(): string {
  return `yowasp-clang ${toolchainVersion().version}`;
}

export async function compileWasm(input: CompileInput): Promise<CompileOutput> {
  return compileC(await loadClang(), supportFiles(), input);
}

export interface WasmRun extends RunResult {
  stdout: string;
  stderr: string;
}

export async function runWasm(wasm: Uint8Array, o: { stdin?: string; args?: string[]; files?: Record<string, string>; maxOutput?: number; timeoutMs?: number } = {}): Promise<WasmRun> {
  let stdout = '';
  let stderr = '';
  const d1 = new TextDecoder();
  const d2 = new TextDecoder();
  let preset: Uint8Array | null = new TextEncoder().encode(o.stdin ?? '');
  const result = await runWasi({
    bytes: wasm,
    args: ['main', ...(o.args ?? [])],
    files: o.files,
    maxOutput: o.maxOutput ?? 1 << 20,
    stdout: b => { stdout += d1.decode(b, { stream: true }); },
    stderr: b => { stderr += d2.decode(b, { stream: true }); },
    stdinSync: () => { const p = preset; preset = null; return p; },
  });
  stdout += d1.decode();
  stderr += d2.decode();
  return { ...result, stdout, stderr };
}
