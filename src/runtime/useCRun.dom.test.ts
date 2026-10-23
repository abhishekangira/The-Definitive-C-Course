// @vitest-environment jsdom
// useCRun against a runtime whose compile promise the test resolves, and whose run handles record kill/done.
// Predict again calls stop() while phase is still `compiling`, before `handle` exists. A second run() can also
// start before the first compile returns, or while the first program is still going.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompileResult } from './CRuntime';
import type { RunResult } from './protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DoneResult = RunResult & { wallMs: number };

interface FakeHandle {
  done: Promise<DoneResult>;
  provideInput: () => void;
  sendEOF: () => void;
  kill: ReturnType<typeof vi.fn>;
  finish: (r: DoneResult) => void;
  emit: (fd: 1 | 2, text: string) => void;
  askInput: () => void;
}

const gate = vi.hoisted(() => {
  const compiles: Array<(r: CompileResult) => void> = [];
  const runs: FakeHandle[] = [];
  return {
    compiles,
    runs,
    compile: vi.fn(() => new Promise<CompileResult>(resolve => { compiles.push(resolve); })),
    run: vi.fn((_wasm: Uint8Array, opts: { onOutput: (fd: 1 | 2, text: string) => void; onStdinRequest?: () => void }) => {
      let resolveDone!: (r: DoneResult) => void;
      const done = new Promise<DoneResult>(r => { resolveDone = r; });
      let settled = false;
      const settle = (r: DoneResult) => { if (!settled) { settled = true; resolveDone(r); } };
      const killed: DoneResult = { kind: 'killed', exitCode: null, message: 'Stopped.', ms: 0, wallMs: 1 };
      const handle: FakeHandle = {
        done,
        provideInput: () => {},
        sendEOF: () => {},
        kill: vi.fn(() => settle(killed)),
        finish: settle,
        emit: opts.onOutput,
        askInput: () => opts.onStdinRequest?.(),
      };
      runs.push(handle);
      return handle;
    }),
  };
});

vi.mock('./CRuntime', () => ({
  getRuntime: () => gate,
  detectStdinMode: () => 'preset' as const,
}));

const { useCRun } = await import('./useCRun');
type CRun = ReturnType<typeof useCRun>;

const ready: CompileResult = {
  ok: true,
  wasm: new Uint8Array([1]),
  diagnostics: [{ file: 'main.c', line: 1, col: 1, severity: 'warning', message: 'noise' }],
  raw: 'warning: noise',
  ms: 3,
};
const req = { files: { 'main.c': 'int main(void) { return 0; }\n' }, stdin: '' };

function Probe({ slot }: { slot: { api: CRun | null } }) {
  const runner = useCRun();
  slot.api = runner;
  // Same rule as CodeSample's Run button.
  const disabled = runner.phase === 'compiling' || runner.phase === 'running';
  return createElement('button', { type: 'button', disabled }, 'Run');
}

describe('useCRun cancellation', () => {
  let host: HTMLDivElement;
  let root: Root;
  const slot: { api: CRun | null } = { api: null };
  const button = () => host.querySelector('button') as HTMLButtonElement;

  beforeEach(() => {
    gate.compile.mockClear();
    gate.run.mockClear();
    gate.compiles.length = 0;
    gate.runs.length = 0;
    slot.api = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root.render(createElement(Probe, { slot })); });
  });

  afterEach(async () => {
    await act(async () => {
      for (const h of gate.runs) h.finish({ kind: 'killed', exitCode: null, ms: 0, wallMs: 0 });
      root.unmount();
    });
    host.remove();
  });

  async function start() {
    await act(async () => { void slot.api!.run(req); });
  }

  async function releaseCompile(index: number) {
    await act(async () => {
      gate.compiles[index](ready);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('a stop during compile starts no program and leaves Run usable', async () => {
    await start();
    expect(slot.api!.phase).toBe('compiling');
    expect(button().disabled).toBe(true);
    await act(async () => { slot.api!.stop(); });
    expect(slot.api!.phase).toBe('idle');
    expect(button().disabled).toBe(false);
    await releaseCompile(0);
    expect(gate.run).not.toHaveBeenCalled();
    expect(slot.api!.phase).toBe('idle');
    expect(slot.api!.diagnostics).toEqual([]);
    expect(slot.api!.rawDiagnostics).toBe('');
    expect(slot.api!.result).toBeNull();
    expect(slot.api!.segments).toEqual([]);
    expect(button().disabled).toBe(false);
  });

  it('a reset during compile starts no program', async () => {
    await start();
    await act(async () => { slot.api!.reset(); });
    expect(slot.api!.phase).toBe('idle');
    await releaseCompile(0);
    expect(gate.run).not.toHaveBeenCalled();
    expect(slot.api!.phase).toBe('idle');
    expect(slot.api!.diagnostics).toEqual([]);
    expect(slot.api!.result).toBeNull();
  });

  it('a second run before the first compile returns does not start the first program', async () => {
    await start();
    await start();
    expect(gate.run).not.toHaveBeenCalled();
    expect(slot.api!.phase).toBe('compiling');
    await releaseCompile(0);
    expect(gate.run).not.toHaveBeenCalled();
    expect(slot.api!.phase).toBe('compiling');
    expect(slot.api!.diagnostics).toEqual([]);
    await releaseCompile(1);
    expect(gate.run).toHaveBeenCalledTimes(1);
    expect(slot.api!.phase).toBe('running');
    expect(gate.runs[0].kill).not.toHaveBeenCalled();
  });

  it("an earlier program's completion does not overwrite the run that replaced it, and its handle is killed", async () => {
    await start();
    await releaseCompile(0);
    expect(slot.api!.phase).toBe('running');
    const first = gate.runs[0];

    await start();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // kill() resolved `done` as a microtask. That exit must not publish over the new run, which is still compiling.
    expect(first.kill).toHaveBeenCalledTimes(1);
    expect(slot.api!.phase).toBe('compiling');
    expect(slot.api!.result).toBeNull();
    await act(async () => { first.emit(1, 'stale'); first.askInput(); });
    expect(slot.api!.segments).toEqual([]);
    expect(slot.api!.phase).toBe('compiling');

    await releaseCompile(1);
    expect(gate.run).toHaveBeenCalledTimes(2);
    expect(slot.api!.phase).toBe('running');
    expect(slot.api!.result).toBeNull();
    const second = gate.runs[1];
    expect(second.kill).not.toHaveBeenCalled();
    await act(async () => {
      second.finish({ kind: 'exit', exitCode: 0, ms: 4, wallMs: 5 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(slot.api!.phase).toBe('done');
    expect(slot.api!.result).toMatchObject({ kind: 'exit', exitCode: 0, wallMs: 5 });
  });

  it('stop on a running program publishes the killed result', async () => {
    await start();
    await releaseCompile(0);
    expect(slot.api!.phase).toBe('running');
    await act(async () => {
      slot.api!.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gate.runs[0].kill).toHaveBeenCalledTimes(1);
    expect(slot.api!.phase).toBe('done');
    expect(slot.api!.result).toMatchObject({ kind: 'killed', message: 'Stopped.' });
    expect(button().disabled).toBe(false);
  });

  it('stop then reset while a program is running stays idle and drops the killed result', async () => {
    await start();
    await releaseCompile(0);
    await act(async () => {
      slot.api!.stop();
      slot.api!.reset();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gate.runs[0].kill).toHaveBeenCalled();
    expect(slot.api!.phase).toBe('idle');
    expect(slot.api!.result).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it('two stop() calls in the same task still end in the killed result, and Run is usable again', async () => {
    await start();
    await releaseCompile(0);
    expect(slot.api!.phase).toBe('running');
    await act(async () => {
      slot.api!.stop();
      slot.api!.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gate.runs[0].kill).toHaveBeenCalledTimes(1);
    expect(slot.api!.phase).toBe('done');
    expect(slot.api!.result).toMatchObject({ kind: 'killed', message: 'Stopped.' });
    expect(button().disabled).toBe(false);
    // And a stop with nothing to stop changes nothing.
    await act(async () => { slot.api!.stop(); await Promise.resolve(); });
    expect(slot.api!.phase).toBe('done');
  });

  it('two stop() calls during compile leave Run usable, and the next run still starts its program', async () => {
    await start();
    await act(async () => { slot.api!.stop(); slot.api!.stop(); });
    expect(slot.api!.phase).toBe('idle');
    await releaseCompile(0);
    expect(gate.run).not.toHaveBeenCalled();
    await start();
    await releaseCompile(1);
    expect(gate.run).toHaveBeenCalledTimes(1);
    expect(slot.api!.phase).toBe('running');
  });

  it('output the program flushes while stop() kills it still reaches the terminal', async () => {
    await start();
    await releaseCompile(0);
    const h = gate.runs[0];
    // The real worker's kill flushes the decoder's tail through onOutput before it resolves done.
    h.kill.mockImplementation(() => { h.emit(1, 'tail'); h.finish({ kind: 'killed', exitCode: null, message: 'Stopped.', ms: 0, wallMs: 1 }); });
    await act(async () => {
      slot.api!.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(slot.api!.segments).toEqual([{ kind: 'out', text: 'tail' }]);
    expect(slot.api!.phase).toBe('done');
  });
});
