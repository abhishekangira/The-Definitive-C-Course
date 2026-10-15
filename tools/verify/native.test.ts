// Integration: real gcc + pty_run.py (skipped on Windows).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileNative, resolveToolchain, runNative, writeSources } from './native';

const dir = mkdtempSync(path.join(tmpdir(), 'tdcc-native-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(process.platform === 'win32')('native compile + pty run', () => {
  const gcc = resolveToolchain('linux-x86_64-gcc13', dir);

  async function build(name: string, code: string) {
    const d = path.join(dir, name);
    writeSources(d, { 'main.c': code });
    const c = await compileNative(gcc, { dir: d, sources: ['main.c'], exe: 'prog', werror: true });
    expect(c.raw).toBe('');
    expect(c.ok).toBe(true);
    return d;
  }

  it('stdout on a pty is line-buffered like the browser: output before a crash survives', async () => {
    const d = await build('crash', '#include <stdio.h>\nint main(void) { int *p = NULL; printf("before\\n"); return *p; }\n');
    const tty = await runNative({ dir: d, exe: 'prog', timeoutMs: 3000, stdoutMode: 'tty' });
    expect(tty).toMatchObject({ stdout: 'before\n', exit: null, signal: 'SIGSEGV', timedOut: false });
    const pipe = await runNative({ dir: d, exe: 'prog', timeoutMs: 3000, stdoutMode: 'pipe' });
    expect(pipe).toMatchObject({ stdout: '', signal: 'SIGSEGV' }); // fully buffered: lost
  });

  it('passes stdin through a pipe, keeps stderr separate, and does not add \\r', async () => {
    const d = await build('io', '#include <stdio.h>\nint main(void) { int a, b; if (scanf("%d %d", &a, &b) != 2) return 2; printf("%d\\r\\n", a + b); fprintf(stderr, "err\\n"); return 3; }\n');
    const r = await runNative({ dir: d, exe: 'prog', stdin: '3 4\n', timeoutMs: 3000, stdoutMode: 'tty' });
    expect(r).toMatchObject({ stdout: '7\r\n', stderr: 'err\n', exit: 3, signal: null });
  });

  it('isatty(stdout) is true in tty mode and false in pipe mode', async () => {
    const d = await build('isatty', '#define _POSIX_C_SOURCE 200809L\n#include <stdio.h>\n#include <unistd.h>\nint main(void) { printf("%d\\n", isatty(1)); return 0; }\n');
    expect((await runNative({ dir: d, exe: 'prog', timeoutMs: 3000, stdoutMode: 'tty' })).stdout).toBe('1\n');
    expect((await runNative({ dir: d, exe: 'prog', timeoutMs: 3000, stdoutMode: 'pipe' })).stdout).toBe('0\n');
  });

  it('kills runaway programs (timeout and output cap)', async () => {
    const loop = await build('loop', 'int main(void) { for (;;) {} }\n');
    expect(await runNative({ dir: loop, exe: 'prog', timeoutMs: 300, stdoutMode: 'tty' })).toMatchObject({ timedOut: true, exit: null });
    const spam = await build('spam', '#include <stdio.h>\nint main(void) { for (;;) puts("yyyyyyyy"); }\n');
    const r = await runNative({ dir: spam, exe: 'prog', timeoutMs: 3000, stdoutMode: 'tty', maxBytes: 1000 });
    expect(r.signal).toBe('output-limit');
    expect(r.stdout.length).toBeLessThanOrEqual(1000);
  });

  it('reports diagnostics with relative file names', async () => {
    const d = path.join(dir, 'warn');
    writeSources(d, { 'main.c': 'int main(void) { int unused = 1; return 0; }\n' });
    const c = await compileNative(gcc, { dir: d, sources: ['main.c'], exe: 'prog', werror: true });
    expect(c.ok).toBe(false);
    expect(c.diagnostics[0]).toMatchObject({ file: 'main.c', line: 1, severity: 'error', flag: '-Wunused-variable' });
    expect(c.raw).not.toContain(dir);
  });
});
