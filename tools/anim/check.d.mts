// Types for check.mjs.
import type { Step } from './lib.mjs';

export function sampleTimes(steps: Array<Pick<Step, 'time' | 'end'>>): number[];
export function checkProject(id: string, opts?: { staticOnly?: boolean }): { id: string; problems: string[]; notes: string[] };
