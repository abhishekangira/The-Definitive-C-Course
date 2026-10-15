// Learner progress: one versioned JSON document in localStorage (namespaced: all of a user's
// github.io project sites share one origin). Export/import as a file. React reads it through
// useProgress(), which re-renders on change (also across tabs via the storage event).
import { useSyncExternalStore } from 'react';

export const STORAGE_PREFIX = 'tdcc:v1:';
const KEY = `${STORAGE_PREFIX}progress`;

export type Platform = 'mac-arm' | 'mac-intel' | 'wsl' | 'linux-x86' | 'linux-arm';

export interface SampleProgress { prediction: string; correct: boolean; predict64?: string; predict64Correct?: boolean; at: string }
export interface ExerciseProgress {
  attempts: number;
  /** Compiled-and-tested runs whose code differed from the previous run. */
  substantive: number;
  lastCodeHash?: string;
  code?: string;
  activeMs: number;
  hintsViewed: number;
  passed: boolean;
  solutionViewed: boolean;
  /** Variant assigned after the solution was viewed; must be solved without a solution. */
  variant?: string;
  /** Variants already failed/abandoned, so a new one can be served. */
  variantsTried?: string[];
  mastered: boolean;
  /** LT progress codes pasted by the learner. */
  codes?: string[];
}
export interface QuizProgress { score: number; total: number; passed: boolean; at: string; answers: Record<string, unknown> }
export interface ProjectProgress { passed: boolean; at: string; token?: string }

export interface ProgressV1 {
  version: 1;
  seed: string;
  createdAt: string;
  lastExportedAt?: string;
  settings: { platform?: Platform; storedOutputMode?: boolean; stdinMode?: 'auto' | 'preset' };
  /** lessonId → completed card indices */
  cards: Record<string, number[]>;
  lessons: Record<string, { completedAt: string }>;
  samples: Record<string, SampleProgress>;
  exercises: Record<string, ExerciseProgress>;
  quizzes: Record<string, QuizProgress>;
  projects: Record<string, ProjectProgress>;
}

function randomSeed(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function emptyProgress(): ProgressV1 {
  return { version: 1, seed: randomSeed(), createdAt: new Date().toISOString(), settings: {}, cards: {}, lessons: {}, samples: {}, exercises: {}, quizzes: {}, projects: {} };
}

/** Accepts unknown JSON, returns a valid ProgressV1 or throws with a readable message. */
export function migrate(raw: unknown): ProgressV1 {
  if (!raw || typeof raw !== 'object') throw new Error('Not a progress file.');
  const o = raw as Partial<ProgressV1> & { version?: number };
  if (o.version !== 1) throw new Error(`Unsupported progress version: ${String(o.version)}.`);
  if (typeof o.seed !== 'string' || !/^[0-9a-f]{16}$/.test(o.seed)) throw new Error('The progress file has no valid learner seed.');
  const base = emptyProgress();
  return {
    ...base,
    ...o,
    version: 1,
    settings: { ...base.settings, ...(o.settings ?? {}) },
    cards: o.cards ?? {},
    lessons: o.lessons ?? {},
    samples: o.samples ?? {},
    exercises: o.exercises ?? {},
    quizzes: o.quizzes ?? {},
    projects: o.projects ?? {},
  } as ProgressV1;
}

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

/** False when the browser blocks localStorage (private windows, blocked site data): progress then lives in memory only. */
export function storageWorks(): boolean {
  try {
    const probe = `${STORAGE_PREFIX}probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch { return false; }
}

let state: ProgressV1 = load();
const listeners = new Set<() => void>();

function load(): ProgressV1 {
  const raw = storageGet(KEY);
  if (raw) {
    try { return migrate(JSON.parse(raw)); } catch { /* fall through to a fresh document */ }
  }
  const fresh = emptyProgress();
  storageSet(KEY, JSON.stringify(fresh));
  return fresh;
}

function emit() { listeners.forEach(l => l()); }

/** Immutable update. The updater may mutate the draft (a structured clone). */
export function update(fn: (draft: ProgressV1) => void): void {
  const draft = structuredClone(state);
  fn(draft);
  const text = JSON.stringify(draft);
  // A no-op update must not produce a new state object: components re-render on every new object, so an
  // effect that "ensures" a value would otherwise loop forever (React error 185).
  if (text === JSON.stringify(state)) return;
  state = draft;
  storageSet(KEY, text);
  emit();
}

export function getProgress(): ProgressV1 { return state; }

export function replaceProgress(next: ProgressV1): void {
  state = next;
  storageSet(KEY, JSON.stringify(state));
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== KEY || !e.newValue) return;
    try { state = migrate(JSON.parse(e.newValue)); emit(); } catch { /* ignore foreign writes */ }
  });
}

function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }

export function useProgress(): ProgressV1 {
  return useSyncExternalStore(subscribe, getProgress, getProgress);
}

// ---------- export / import ----------

export function exportFileName(d = new Date()): string {
  return `c-course-progress-${d.toISOString().slice(0, 10)}.json`;
}

export function exportProgress(): Blob {
  update(p => { p.lastExportedAt = new Date().toISOString(); });
  return new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
}

export interface ImportSummary { lessons: number; modulesPassed: string[]; exercisesPassed: number; seedMatches: boolean }

export function summarise(p: ProgressV1): ImportSummary {
  return {
    lessons: Object.keys(p.lessons).length,
    modulesPassed: Object.entries(p.quizzes).filter(([k, v]) => k.endsWith(':checkpoint') && v.passed).map(([k]) => k.split(':')[0]),
    exercisesPassed: Object.values(p.exercises).filter(e => e.passed).length,
    seedMatches: p.seed === state.seed,
  };
}

/** Merge keeps the furthest progress from both documents; replace overwrites everything. */
export function mergeProgress(a: ProgressV1, b: ProgressV1): ProgressV1 {
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b.cards)) out.cards[k] = [...new Set([...(out.cards[k] ?? []), ...v])].sort((x, y) => x - y);
  for (const [k, v] of Object.entries(b.lessons)) out.lessons[k] ??= v;
  for (const [k, v] of Object.entries(b.samples)) out.samples[k] ??= v;
  for (const [k, v] of Object.entries(b.exercises)) {
    const cur = out.exercises[k];
    if (!cur) { out.exercises[k] = v; continue; }
    out.exercises[k] = {
      ...cur,
      attempts: Math.max(cur.attempts, v.attempts),
      substantive: Math.max(cur.substantive, v.substantive),
      activeMs: Math.max(cur.activeMs, v.activeMs),
      hintsViewed: Math.max(cur.hintsViewed, v.hintsViewed),
      passed: cur.passed || v.passed,
      solutionViewed: cur.solutionViewed || v.solutionViewed,
      mastered: cur.mastered || v.mastered,
      variant: cur.variant ?? v.variant,
      codes: [...new Set([...(cur.codes ?? []), ...(v.codes ?? [])])],
    };
  }
  for (const [k, v] of Object.entries(b.quizzes)) {
    const cur = out.quizzes[k];
    if (!cur || (v.passed && !cur.passed) || v.score > cur.score) out.quizzes[k] = { ...v, passed: v.passed || Boolean(cur?.passed) };
  }
  for (const [k, v] of Object.entries(b.projects)) if (!out.projects[k]?.passed) out.projects[k] = v;
  return out;
}

export function daysSinceExport(p: ProgressV1, now = Date.now()): number | null {
  if (!p.lastExportedAt) return null;
  return Math.floor((now - Date.parse(p.lastExportedAt)) / 86_400_000);
}

// ---------- small helpers used across components ----------

export function exerciseProgress(p: ProgressV1, id: string): ExerciseProgress {
  return p.exercises[id] ?? { attempts: 0, substantive: 0, activeMs: 0, hintsViewed: 0, passed: false, solutionViewed: false, mastered: false };
}

export function markCard(lessonId: string, index: number): void {
  update(p => {
    const list = p.cards[lessonId] ?? [];
    if (!list.includes(index)) p.cards[lessonId] = [...list, index].sort((a, b) => a - b);
  });
}

export function themeKey(): string { return `${STORAGE_PREFIX}theme`; }
