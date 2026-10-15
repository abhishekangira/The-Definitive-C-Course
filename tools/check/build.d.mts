// Types for build.mjs (imported by TypeScript tools such as tools/exercises).
import type { ProjectZipInput } from '../../src/testing/project-zip';

export const ROOT: string;
export const CHECK_OUT: string;
export const ZIP_TOOL_OUT: string;
export const LEARNC_H: string;

export function buildCheck(opts?: { outfile?: string }): Promise<{ outfile: string; bytes: number }>;
export function buildZipTool(opts?: { outfile?: string }): Promise<string>;

export interface ZipOptions {
  dir: string;
  out: string;
  solution?: boolean;
  seed?: string;
  checkMjsPath: string;
  learncPath: string;
}

export interface ZipTool {
  zipProject(o: ZipOptions): string[];
  zipInput(o: Omit<ZipOptions, 'out'>): ProjectZipInput;
  projectEntries(o: Omit<ZipOptions, 'out'>): { id: string; entries: Record<string, string | Uint8Array> };
}

export function loadZipTool(): Promise<ZipTool>;
