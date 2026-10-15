import { describe, expect, it } from 'vitest';
import type { Diagnostic, RunOutcome, TargetId } from '../../src/content-model/types';
import { parseDiagnostics, normaliseFlag } from '../../src/runtime/compile-core';
import { checkSample, comparable, diagnosticDiff, diagnosticKey, outcomeOf, type CheckInput } from './checks';
import { parseFenceMeta } from './meta';
import type { VerifiedTargetResult } from './types';

const GCC: TargetId = 'linux-x86_64-gcc13';
const CLANG: TargetId = 'linux-x86_64-clang22';
const WASM: TargetId = 'wasm32-clang22';

const ok = (stdout: string, extra: Partial<RunOutcome> = {}): RunOutcome => ({ stdout, stderr: '', exit: 0, signal: null, ...extra });
const diag = (line: number, severity: Diagnostic['severity'], flag?: string): Diagnostic => ({ file: 'main.c', line, col: 1, severity, message: 'm', flag });

function target(t: TargetId, run?: RunOutcome, o: Partial<VerifiedTargetResult> = {}): VerifiedTargetResult {
  return { target: t, compiler: 'x', compile: { ok: true, diagnostics: [], raw: '' }, run, ...(t === WASM ? {} : { sanitizer: { ok: true } }), ...o };
}

function input(meta: string, results: Partial<Record<TargetId, VerifiedTargetResult>>, stored?: CheckInput['stored']): CheckInput {
  const p = parseFenceMeta(meta);
  return { id: p.meta!.id, code: 'int main(void) { return 0; }\n', meta: p.meta!, ext: p.ext, results, stored };
}

const same = (stdout: string) => ({ [GCC]: target(GCC, ok(stdout)), [CLANG]: target(CLANG, ok(stdout)), [WASM]: target(WASM, ok(stdout)) });

describe('flagging (browser vs 64-bit)', () => {
  it('identical output is not flagged and the answer is the browser output', () => {
    const r = checkSample(input('id=a', same('hi\n')));
    expect(r).toMatchObject({ problems: [], flagged: false, diffs: [], answer: { stdout: 'hi\n', outcome: 'runs', native: { stdout: 'hi\n', outcome: 'runs' } } });
  });

  it('a wasm vs gcc difference is flagged and fails without platform + predict64', () => {
    const res = { [GCC]: target(GCC, ok('8\n')), [CLANG]: target(CLANG, ok('8\n')), [WASM]: target(WASM, ok('4\n')) };
    const r = checkSample(input('id=a', res));
    expect(r.flagged).toBe(true);
    expect(r.diffs).toEqual([{ target: GCC, diff: '  outcome: runs\n- 4\n+ 8\n  ' }]);
    expect(r.problems).toEqual([expect.stringContaining('add `platform` and `predict64=')]);
    expect(r.answer).toMatchObject({ stdout: '4\n', native: { stdout: '8\n' } });
  });

  it('platform alone is not enough; platform + predict64 (or none + reason) is', () => {
    const res = { [GCC]: target(GCC, ok('8\n')), [CLANG]: target(CLANG, ok('8\n')), [WASM]: target(WASM, ok('4\n')) };
    expect(checkSample(input('id=a platform', res)).problems).toHaveLength(1);
    expect(checkSample(input('id=a platform predict64="How big is long on 64-bit?"', res)).problems).toEqual([]);
    expect(checkSample(input('id=a platform predict64=none reason="layout varies"', res)).problems).toEqual([]);
    const noReason = checkSample(input('id=a platform predict64=none', res)).problems;
    expect(noReason).toEqual([expect.stringContaining('add `platform`'), 'predict64=none needs reason="…"']);
  });

  it('a stored target (e.g. macOS) that differs flags the sample even when gcc agrees', () => {
    const stored = [{ target: 'macos-arm64-appleclang' as TargetId, result: target('macos-arm64-appleclang', ok('16\n')) }];
    const r = checkSample(input('id=ld', same('8\n'), stored));
    expect(r.flagged).toBe(true);
    expect(r.diffs.map(d => d.target)).toEqual(['macos-arm64-appleclang']);
  });

  it('outcome differences flag too (NULL deref: SIGSEGV natively, runs in wasm)', () => {
    const res = {
      [GCC]: target(GCC, ok('', { exit: null, signal: 'SIGSEGV' })),
      [CLANG]: target(CLANG, ok('', { exit: null, signal: 'SIGSEGV' })),
      [WASM]: target(WASM, ok('0\n')),
    };
    const r = checkSample(input('id=n predict=outcome expect=runtime-error expect.wasm=success platform predict64=none reason="crash"', res));
    expect(r.problems).toEqual([]);
    expect(r.flagged).toBe(true);
    expect(r.answer).toMatchObject({ outcome: 'runs', native: { outcome: 'runtime-error' } });
    // Without the per-target override the browser run violates expect=runtime-error.
    expect(checkSample(input('id=n predict=outcome expect=runtime-error platform predict64=none reason="crash"', res)).problems)
      .toEqual([expect.stringContaining('browser (wasm32): expected a runtime error')]);
  });

  it('UB samples compare outcome categories only, never garbage values', () => {
    const res = {
      [GCC]: target(GCC, ok('32767\n'), { observed: [ok('32767\n'), ok('32764\n')] }),
      [CLANG]: target(CLANG, ok('-1432952584\n'), { observed: [ok('-1432952584\n'), ok('866014808\n')] }),
      [WASM]: target(WASM, ok('0\n'), { observed: [ok('0\n')] }),
    };
    const r = checkSample(input('id=u expect=ub predict=outcome', res));
    expect(r).toMatchObject({ problems: [], flagged: false });
    expect(comparable(parseFenceMeta('id=u expect=ub').meta!, res[GCC])).toBe('outcomes: runs');
  });

  it('target=native samples use gcc as the base and have no browser result', () => {
    const res = { [GCC]: target(GCC, ok('child\n')), [CLANG]: target(CLANG, ok('child\n')) };
    const r = checkSample(input('id=f target=native', res));
    expect(r).toMatchObject({ problems: [], flagged: false, answer: { stdout: 'child\n' } });
  });
});

describe('expectations', () => {
  it('success must be warning-free in the browser compile', () => {
    const res = same('x\n');
    res[WASM] = target(WASM, ok('x\n'), { compile: { ok: true, diagnostics: [diag(3, 'warning', '-Wformat')], raw: '' } });
    expect(checkSample(input('id=a', res)).problems).toEqual([expect.stringContaining('browser (wasm32): the browser compile must be warning-free')]);
  });

  it('warning needs a warning on every target, and warn= flags must be present', () => {
    const w = (flag: string) => ({ ok: true, diagnostics: [diag(4, 'warning', flag)], raw: '' });
    const res = { [GCC]: target(GCC, ok('x\n'), { compile: w('-Wunused-variable') }), [CLANG]: target(CLANG, ok('x\n'), { compile: w('-Wunused-variable') }), [WASM]: target(WASM, ok('x\n')) };
    const problems = checkSample(input('id=w expect=warning warn=-Wunused-variable', res)).problems;
    expect(problems).toEqual(['browser (wasm32): expected a warning, got none', 'browser (wasm32): expected warning -Wunused-variable, got []']);
  });

  it('compile-error must fail everywhere', () => {
    const failed = { ok: false, diagnostics: [diag(4, 'error')], raw: 'main.c:4:20: error: x' };
    const res = { [GCC]: target(GCC, undefined, { compile: failed }), [CLANG]: target(CLANG, undefined, { compile: failed }), [WASM]: target(WASM, ok('')) };
    const r = checkSample(input('id=e expect=compile-error', res));
    expect(r.problems).toEqual(['browser (wasm32): expected a compile error, but it compiled']);
    expect(outcomeOf(res[GCC])).toBe('compile-error');
  });

  it('exit:N, timeouts and the sanitizer', () => {
    const r1 = checkSample(input('id=x expect=exit:3', same('')));
    expect(r1.problems).toHaveLength(3);
    const res = same('');
    res[GCC] = target(GCC, ok(''), { sanitizer: { ok: false, kind: 'heap-buffer-overflow', line: 6, report: 'AddressSanitizer: heap-buffer-overflow main.c:6' } });
    expect(checkSample(input('id=x', res)).problems).toEqual([
      expect.stringContaining('gcc 13 (x86-64 Linux): ASan/UBSan is not clean'),
      'gcc and clang 22 sanitizer reports differ: ?:6:heap-buffer-overflow vs clean',
    ]);
    expect(checkSample(input('id=x sanitize=off', res)).problems).toEqual([]);
    res[WASM] = target(WASM, ok('', { exit: null, timedOut: true }));
    expect(checkSample(input('id=x sanitize=off', res)).problems).toEqual([expect.stringContaining('browser (wasm32): timed out')]);
  });

  it('gcc and clang must agree unless platform/ub/runtime-error', () => {
    const res = { [GCC]: target(GCC, ok('a\n')), [CLANG]: target(CLANG, ok('b\n')), [WASM]: target(WASM, ok('a\n')) };
    expect(checkSample(input('id=x', res)).problems).toEqual([expect.stringContaining('gcc and clang 22 disagree')]);
    expect(checkSample(input('id=x expect=ub', res)).problems).toEqual([]);
  });

  it('sanitizer reports are compared by (file, line, kind), not text', () => {
    const san = (line: number) => ({ ok: false, file: 'main.c', kind: 'null-pointer-use', line, report: `runtime error: col ${line * 7}` });
    const crash = ok('', { exit: null, signal: 'SIGSEGV' });
    const res = { [GCC]: target(GCC, crash, { sanitizer: san(6) }), [CLANG]: target(CLANG, crash, { sanitizer: san(6) }) };
    expect(checkSample(input('id=x expect=runtime-error target=native', res)).problems).toEqual([]);
    res[CLANG] = target(CLANG, crash, { sanitizer: san(7) });
    expect(checkSample(input('id=x expect=runtime-error target=native', res)).problems).toEqual(['gcc and clang 22 sanitizer reports differ: main.c:6:null-pointer-use vs main.c:7:null-pointer-use']);
  });

  it('the browser guardrail must report what native UBSan reports', () => {
    const crash = ok('', { exit: null, signal: 'SIGSEGV' });
    const san = { ok: false, file: 'main.c', kind: 'null-pointer-use', line: 6 };
    const res = {
      [GCC]: target(GCC, crash, { sanitizer: san }), [CLANG]: target(CLANG, crash, { sanitizer: san }),
      [WASM]: target(WASM, ok('0\n'), { guardrail: ok('', { exit: 1, stderr: "main.c:6:20: runtime error: load of null pointer of type 'int'\n" }) }),
    };
    const meta = 'id=n expect=runtime-error expect.wasm=success guardrail predict=outcome';
    const flaggedOk = ' platform predict64=none reason=x';
    expect(checkSample(input(meta + flaggedOk, res)).problems).toEqual([]);
    res[WASM] = target(WASM, ok('0\n'), { guardrail: ok('0\n') });
    expect(checkSample(input(meta, res)).problems).toContainEqual('browser guardrail report differs from native UBSan: clean vs main.c:6:null-pointer-use');
  });

  it('predict=choice: the output must match exactly one choice', () => {
    expect(checkSample(input('id=c choices="3|3.5|4"', same('3\n'))).problems).toEqual([]);
    expect(checkSample(input('id=c choices="1|2"', same('3\n'))).problems).toEqual([expect.stringContaining('matches 0')]);
    expect(checkSample(input('id=c choices="3|3"', same('3\n'))).problems).toEqual([expect.stringContaining('matches 2')]);
  });

  it('posix samples must start with the feature-test macro', () => {
    const res = { [GCC]: target(GCC, ok('')), [CLANG]: target(CLANG, ok('')) };
    const bad = { ...input('id=p posix target=native', res), code: '#include <unistd.h>\nint main(void) { return 0; }\n' };
    expect(checkSample(bad).problems).toEqual([expect.stringContaining('_POSIX_C_SOURCE 200809L')]);
    const good = { ...bad, code: '/* demo */\n#define _POSIX_C_SOURCE 200809L\n#include <unistd.h>\nint main(void) { return 0; }\n' };
    expect(checkSample(good).problems).toEqual([]);
  });
});

describe('diagnostics comparison', () => {
  it('flags are normalised across gcc and clang spellings', () => {
    const d = parseDiagnostics([
      "a.c:4:9: error: unused variable 'u' [-Werror=unused-variable]",
      "b.c:5:20: warning: format specifies type 'int' [-Wformat]",
      "c.c:5:14: warning: format '%d' expects [-Wformat=]",
      "d.c:4:9: error: unused variable 'u' [-Werror,-Wunused-variable]",
    ].join('\n'));
    expect(d.map(x => x.flag)).toEqual(['-Wunused-variable', '-Wformat', '-Wformat', '-Wunused-variable']);
    expect(normaliseFlag('-Werror=format=')).toBe('-Wformat');
  });

  it('compares by (line, severity, flag); -Werror-promoted errors count as warnings', () => {
    const gccWerror = parseDiagnostics("main.c:4:9: error: unused variable 'u' [-Werror=unused-variable]\nmain.c: In function 'main':\n");
    const wasm = parseDiagnostics("main.c:4:9: warning: unused variable 'u' [-Wunused-variable]\nmain.c:3:5: note: declared here\n");
    expect(diagnosticKey(gccWerror[0])).toBe('4:warning:-Wunused-variable');
    expect(diagnosticDiff(gccWerror, wasm)).toEqual({ onlyA: [], onlyB: [] }); // notes are ignored
    expect(diagnosticDiff([diag(5, 'warning', '-Wformat')], wasm)).toEqual({ onlyA: ['5:warning:-Wformat'], onlyB: ['4:warning:-Wunused-variable'] });
    expect(diagnosticKey(diag(4, 'error'))).toBe('4:error:');
  });
});
