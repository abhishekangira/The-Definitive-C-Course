// @vitest-environment jsdom
// How the main thread reads the compiler worker's messages (#58).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRuntime } from './CRuntime';
import type { CompilerOut } from './protocol';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: MessageEvent<CompilerOut>) => void) | null = null;
  sent: unknown[] = [];
  constructor() { FakeWorker.last = this; }
  postMessage(m: unknown) { this.sent.push(m); }
  emit(m: CompilerOut) { this.onmessage?.({ data: m } as MessageEvent<CompilerOut>); }
}

describe('the toolchain state', () => {
  beforeEach(() => { vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('stays an error when a failed attempt reports progress late, and shows the progress of the next attempt', () => {
    const rt = new CRuntime();
    const worker = FakeWorker.last;
    rt.prefetch();
    expect(rt.state.status).toBe('loading');
    worker.emit({ type: 'load-error', kind: 'download', message: 'Network error' });
    expect(rt.state.status).toBe('error');
    // The sysroot fetch of the dead attempt is still reporting: the alert and its Retry button must stay.
    worker.emit({ type: 'progress', done: 5, total: 100 });
    expect(rt.state).toEqual({ status: 'error', kind: 'download', message: 'Network error' });
    rt.prefetch(); // Retry
    expect(rt.state.status).toBe('loading');
    worker.emit({ type: 'progress', done: 10, total: 100 });
    expect(rt.state).toMatchObject({ status: 'loading', done: 10, total: 100 });
  });
});
