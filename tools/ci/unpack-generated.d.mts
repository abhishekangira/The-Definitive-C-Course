export const MAX_FILES: number;
export const MAX_BYTES: number;
export function pathProblem(name: string): string | null;
export function parseGeneratedTar(tar: Buffer): Array<{ name: string; data: Buffer }>;
export function unpackGenerated(tarPath: string, dest: string): string[];
