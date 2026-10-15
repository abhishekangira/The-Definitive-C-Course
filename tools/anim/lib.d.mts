// Types for lib.mjs (imported by the vitest tests in tools/anim).
export const ROOT: string;
export const ANIM_DIR: string;
export const SHARED_DIR: string;
export const PUBLIC_DIR: string;
export const MANIFEST_PATH: string;
export const HYPERFRAMES_VERSION: string;
export const PIPELINE_VERSION: number;
export const DEFAULT_BROWSER: string;
export const RENDER_FLAGS: readonly string[];
export const WEBM_CRF: number;
export const WEBM_ENCODER_ARGS: readonly string[];
export const PROJECT_ID_RE: RegExp;
export const SYNC_MAP: readonly { from: string; to: string }[];

export function hfEnv(extra?: Record<string, string>): NodeJS.ProcessEnv;
export function browserPath(): string;
export function browserVersion(): string | null;
export function ffmpegVersion(): string | null;
export interface Spawned { status: number; stdout: string; stderr: string; error?: Error }
export function runHf(args: string[], opts?: { cwd?: string; stdio?: 'pipe' | 'inherit'; env?: Record<string, string> }): Spawned;
export function run(cmd: string, args: string[], opts?: Record<string, unknown>): Spawned;

export function sha256(data: string | Uint8Array): string;
export function sha256File(file: string): string;
export function listFiles(dir: string, base?: string): string[];
export function sourceHash(projectDir: string, opts?: { hfVersion?: string; flags?: readonly string[]; pipeline?: number }): string;

export function listProjects(only?: string[]): string[];
export function projectDir(id: string): string;
export function syncShared(id: string, opts?: { dryRun?: boolean; prune?: boolean }): { copied: string[]; removed: string[]; upToDate: number };

export function readAttrs(tag: string): Record<string, string>;
export function findTags(html: string, attr: string): Array<Record<string, string> & { _tag: string }>;
export interface Step { key: string; label: string; time: number; end: number; scene: string }
export interface Scene { id: string; file: string; start: number; duration: number; root: Record<string, string> | null }
export interface ProjectInfo { id: string; compositionId: string; duration: number; width: number; height: number; fps: number; scenes: Scene[]; steps: Step[] }
export function readProject(id: string, dir?: string): ProjectInfo;
export const round3: (n: number) => number;
export interface AnimationMeta { id: string; title: string; lesson: string; platform: string; description: string; posterAt?: number }
export function readAnimationMeta(id: string, dir?: string): AnimationMeta;
export interface Cue { text: string; start: number; end: number; step?: string }
export function readCaptions(id: string, dir?: string): Cue[];
export function vttTime(sec: number): string;
export function toVtt(cues: Cue[]): string;
export function toTranscript(cues: Cue[], steps?: Array<{ key: string; label: string }>): string;

export interface ManifestEntry { sourceHash: string; browser: string | null; outputs: Record<string, string> }
export interface Manifest { version: number; renderer: Record<string, unknown>; animations: Record<string, ManifestEntry> }
export function readManifest(): Manifest;
export function writeManifest(manifest: Manifest): void;
export function outputHashes(id: string, outDir?: string): Record<string, string>;
export function checkFreshness(id: string, opts?: { manifest?: Manifest; dir?: string; outDir?: string }): { ok: boolean; problems: string[] };
export function fmtBytes(n: number): string;
