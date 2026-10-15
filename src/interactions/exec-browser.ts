// ExecBackend for src/testing/runner.ts that compiles and runs in the browser (CRuntime workers).
import { getRuntime } from '../runtime/CRuntime';
import type { ExecBackend } from '../testing/runner';

export const browserExec: ExecBackend = {
  async compile(files, sources, opts = {}) {
    const r = await getRuntime().compile({ files, sources, guardrail: opts.guardrail, leakcheck: opts.leakcheck, extraFlags: opts.extraFlags });
    return { ok: r.ok, diagnostics: r.diagnostics, raw: r.raw, artifact: r.wasm };
  },
  async run(artifact, o) {
    let stdout = '';
    let stderr = '';
    const h = getRuntime().run(artifact as Uint8Array, {
      mode: 'preset',
      presetStdin: o.stdin ?? '',
      args: ['main', ...(o.args ?? [])],
      cpuTimeoutMs: o.timeoutMs ?? 5000,
      onOutput: (fd, text) => { if (fd === 1) stdout += text; else stderr += text; },
    });
    const r = await h.done;
    return {
      stdout,
      stderr,
      exit: r.kind === 'exit' ? r.exitCode : null,
      trap: r.kind === 'trap' ? r.message ?? 'trap' : null,
      signal: null,
      timedOut: r.kind === 'timeout',
      leakcheck: r.leakcheck,
    };
  },
};
