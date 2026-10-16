import { spawn } from 'node:child_process';

import type { Step } from './steps';

export type Status = 'PASS' | 'FAIL' | 'SKIPPED';
export interface StepResult {
  id: string;
  point: number;
  name: string;
  status: Status;
  /** Why a step was skipped. */
  reason?: string;
  durationMs: number;
  /** Last lines of output, only for FAIL. */
  tail?: string[];
}
export interface Report { module: string; fast: boolean; ok: boolean; steps: StepResult[] }

export interface ExecResult { code: number | null; output: string }
export type Exec = (step: Step) => Promise<ExecResult>;

export const TAIL_LINES = 15;
const STEP_TIMEOUT_MS = 30 * 60_000;

/** Runs the step's command with its output captured (never inherited, so `--json` stays clean JSON). */
export const spawnExec = (cwd: string): Exec => step =>
  new Promise(resolve => {
    const [cmd, ...args] = step.command;
    let output = '';
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...step.env }, timeout: STEP_TIMEOUT_MS });
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('error', e => resolve({ code: null, output: output + String(e) }));
    child.on('close', code => resolve({ code, output }));
  });

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

export function lastLines(output: string, n = TAIL_LINES): string[] {
  return stripAnsi(output).split(/\r?\n/).filter(l => l.trim()).slice(-n);
}

/** Runs every step in order, one at a time. A failing step does not stop the later ones: one run reports everything. */
export async function runSteps(steps: Step[], exec: Exec, meta: { module: string; fast: boolean }, onStep?: (r: StepResult) => void): Promise<Report> {
  const results: StepResult[] = [];
  for (const step of steps) {
    const base = { id: step.id, point: step.point, name: step.name };
    const started = Date.now();
    let r: StepResult;
    if (step.skip !== undefined) r = { ...base, status: 'SKIPPED', reason: step.skip, durationMs: 0 };
    else {
      const { code, output } = await exec(step);
      r = code === 0
        ? { ...base, status: 'PASS', durationMs: Date.now() - started }
        : { ...base, status: 'FAIL', durationMs: Date.now() - started, tail: lastLines(output) };
    }
    results.push(r);
    onStep?.(r);
  }
  return { ...meta, ok: results.every(r => r.status !== 'FAIL'), steps: results };
}

export function formatReport(report: Report): string {
  const rows = report.steps.map(r => [
    String(r.point), r.name, r.status === 'SKIPPED' ? `SKIPPED (${r.reason})` : r.status, r.durationMs ? `${(r.durationMs / 1000).toFixed(1)} s` : '',
  ]);
  const head = ['§3.6', 'step', 'result', 'time'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (c: string[]) => `| ${c.map((x, i) => x.padEnd(w[i])).join(' | ')} |`;
  const out = [line(head), `|${w.map(n => '-'.repeat(n + 2)).join('|')}|`, ...rows.map(line)];
  for (const r of report.steps.filter(s => s.status === 'FAIL')) {
    out.push('', `FAIL ${r.name} (§3.6 point ${r.point}), last ${r.tail?.length ?? 0} lines:`, ...(r.tail ?? []).map(l => `    ${l}`));
  }
  const failed = report.steps.filter(s => s.status === 'FAIL').map(s => s.name);
  out.push('', failed.length ? `dod ${report.module}: FAIL (${failed.join(', ')})` : `dod ${report.module}: PASS`);
  return out.join('\n');
}
