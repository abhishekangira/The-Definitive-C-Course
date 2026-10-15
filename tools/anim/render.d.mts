// Types for render.mjs.
export interface ProbeResult { codec: string; pixFmt: string; width: number; height: number; rate: string; frames: number; duration: number }
export function probe(file: string): ProbeResult;
export function indexSnapshots(dir: string): Array<{ t: number; file: string }>;
export function renderProject(id: string, opts?: { force?: boolean; dryRun?: boolean }): { status: 'rendered' | 'cached' | 'dry-run'; bytes: number };
export function transcodeWebm(id: string, outRoot: string): string;
