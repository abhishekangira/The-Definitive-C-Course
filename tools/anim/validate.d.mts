// Types for validate.mjs (imported by the vitest tests in tools/anim).
import type { Step } from './lib.mjs';

export interface ValidationResult { errors: string[]; warnings: string[]; info: { steps?: Step[]; duration?: number } }
export function validateProject(id: string, opts?: { dir?: string }): ValidationResult;
export function stripBlocks(html: string): string;
export function visibleText(html: string): string;
export function inFontSubset(cp: number): boolean;
export function uncoveredGlyphs(html: string): Array<[string, string]>;
export function extractStyles(html: string): string[];
export function extractScripts(html: string): string[];
export function stripJsComments(js: string): string;
export function cssFontSizes(css: string): Array<{ px: number; decl: string }>;
export function objectKeys(obj: string): string[];
export const ANIMATABLE: Set<string>;
export const TWEEN_CONTROLS: Set<string>;
export interface TweenCall { method: string; owner: string; args: string[]; vars: string[]; keys: string[]; index: number; end: number }
export function tweenCalls(script: string): TweenCall[];
