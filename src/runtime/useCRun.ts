// React hook around CRuntime: compile + run with streamed output and (when supported) interactive stdin.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getRuntime, detectStdinMode, type CompileResult, type RunHandle, type ToolchainState } from './CRuntime';
import type { RunResult, StdinMode } from './protocol';
import type { Diagnostic } from '../content-model/types';

export type Segment = { kind: 'out' | 'err' | 'in' | 'sys'; text: string };

export type RunPhase = 'idle' | 'compiling' | 'running' | 'waiting-input' | 'done';

export interface RunSummary {
  compile: CompileResult;
  result?: RunResult & { wallMs: number };
  stdout: string;
  stderr: string;
}

export interface RunRequest {
  files: Record<string, string>;
  sources?: string[];
  stdin?: string;
  args?: string[];
  guardrail?: boolean;
  leakcheck?: boolean;
  extraFlags?: string[];
  /** Force pre-filled stdin even when interactive input is available (tests, samples with stdin). */
  preset?: boolean;
  cpuTimeoutMs?: number;
}

export function useToolchainState(): ToolchainState {
  const [state, setState] = useState<ToolchainState>(() => getRuntime().state);
  useEffect(() => getRuntime().subscribe(setState), []);
  return state;
}

export function useCRun() {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [rawDiagnostics, setRawDiagnostics] = useState('');
  const [result, setResult] = useState<(RunResult & { wallMs: number }) | null>(null);
  const handle = useRef<RunHandle | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; handle.current?.kill(); }, []);

  const append = useCallback((seg: Segment) => {
    setSegments(prev => {
      const last = prev[prev.length - 1];
      if (last && last.kind === seg.kind && seg.kind !== 'in') return [...prev.slice(0, -1), { kind: last.kind, text: last.text + seg.text }];
      return [...prev, seg];
    });
  }, []);

  const run = useCallback(async (req: RunRequest): Promise<RunSummary> => {
    const rt = getRuntime();
    setSegments([]); setResult(null); setDiagnostics([]); setRawDiagnostics('');
    setPhase('compiling');
    const compile = await rt.compile({
      files: req.files, sources: req.sources ?? Object.keys(req.files).filter(f => f.endsWith('.c')),
      guardrail: req.guardrail, leakcheck: req.leakcheck, extraFlags: req.extraFlags,
    });
    if (!mounted.current) return { compile, stdout: '', stderr: '' };
    setDiagnostics(compile.diagnostics);
    setRawDiagnostics(compile.raw);
    if (!compile.ok || !compile.wasm) { setPhase('done'); return { compile, stdout: '', stderr: '' }; }
    setPhase('running');
    let stdout = '';
    let stderr = '';
    const mode: StdinMode = req.preset || req.stdin !== undefined ? 'preset' : detectStdinMode();
    const h = rt.run(compile.wasm, {
      mode,
      presetStdin: req.stdin ?? '',
      args: ['main', ...(req.args ?? [])],
      cpuTimeoutMs: req.cpuTimeoutMs,
      onOutput: (fd, text) => {
        if (fd === 1) stdout += text; else stderr += text;
        if (mounted.current) append({ kind: fd === 1 ? 'out' : 'err', text });
      },
      onStdinRequest: () => { if (mounted.current) setPhase('waiting-input'); },
    });
    handle.current = h;
    const r = await h.done;
    handle.current = null;
    if (mounted.current) { setResult(r); setPhase('done'); }
    return { compile, result: r, stdout, stderr };
  }, [append]);

  const sendInput = useCallback((line: string) => {
    append({ kind: 'in', text: line + '\n' });
    setPhase('running');
    handle.current?.provideInput(line + '\n');
  }, [append]);

  const sendEOF = useCallback(() => {
    append({ kind: 'sys', text: '^D\n' });
    setPhase('running');
    handle.current?.sendEOF();
  }, [append]);

  const stop = useCallback(() => handle.current?.kill(), []);

  const reset = useCallback(() => { setSegments([]); setResult(null); setDiagnostics([]); setRawDiagnostics(''); setPhase('idle'); }, []);

  return { phase, segments, diagnostics, rawDiagnostics, result, run, sendInput, sendEOF, stop, reset };
}
