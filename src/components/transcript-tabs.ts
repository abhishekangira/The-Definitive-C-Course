// What <Transcript> shows from a stored native session (src/generated/sessions, docs/adr/0005-native-sessions.md):
// one tab per platform that stored the steps, the platforms with nothing stored (said on screen, never hidden), and the
// normaliser's placeholders, which are shown as placeholders and explained, never as realistic values.
import type { SessionPlatform, SessionResult, SessionStepResult } from '../content-model/types';

export const SESSION_PLATFORMS: SessionPlatform[] = ['linux-gcc', 'linux-clang', 'macos'];

export const SESSION_PLATFORM_LABEL: Record<SessionPlatform, string> = {
  'linux-gcc': 'Linux/WSL · gcc 13',
  'linux-clang': 'Linux/WSL · clang 22',
  macos: 'macOS · Apple clang',
};

export interface TranscriptTab {
  platform: SessionPlatform;
  /** The platform, plus the tool when every step shown is the same tool (`as:`), e.g. "Linux/WSL · gcc 13 · gdb". */
  label: string;
  steps: SessionStepResult[];
}

/** How a step's tool (`as:`) is named on a tab; any other tool keeps its own name ("gdb", "ld", "leaks"). */
const TOOL_LABEL: Record<string, string> = { valgrind: 'Valgrind', asan: 'ASan', ubsan: 'UBSan' };
const toolLabel = (as: string) => TOOL_LABEL[as] ?? as;

const COMPILER_OF: Record<SessionPlatform, string> = { 'linux-gcc': 'gcc 13', 'linux-clang': 'clang 22', macos: 'Apple clang' };

export interface TranscriptView {
  tabs: TranscriptTab[];
  /** Platforms the session has steps for but no stored run yet (macOS before the Targets workflow, or a stale run). */
  pending: SessionPlatform[];
  /** Said instead when Linux runs it with one compiler on purpose (`only:`), e.g. "On Linux/WSL, gdb runs on the gcc 13 build only." */
  linuxOnly?: string;
}

/**
 * The tabs for a session: every stored step, only the `step`-th (1-based) of each platform's own list, or its last step
 * (`'last'`, where a report usually is). A platform's
 * list is the session's `all` steps, then its own group, minus steps for the other compiler, so the step number counts
 * in that list. A platform with no run is `pending` only when the session has steps for it (`platforms`); one without
 * steps (gdb has no clang or macOS steps) is missing by design, and so is a step past the end of a shorter list.
 */
export function transcriptTabs(session: SessionResult, step?: number | 'last'): TranscriptView {
  const tabs: TranscriptTab[] = [];
  const pending: SessionPlatform[] = [];
  for (const platform of SESSION_PLATFORMS) {
    const run = session.runs[platform];
    if (!run) { if (session.platforms.includes(platform)) pending.push(platform); continue; }
    const steps = step === undefined ? run : step === 'last' ? run.slice(-1) : run.slice(step - 1, step);
    if (!steps.length) continue;
    const tools = [...new Set(steps.map(s => s.as))];
    const tool = tools.length === 1 ? tools[0] : undefined;
    tabs.push({ platform, label: tool ? `${SESSION_PLATFORM_LABEL[platform]} · ${toolLabel(tool)}` : SESSION_PLATFORM_LABEL[platform], steps });
  }
  const linux = session.platforms.filter(p => p !== 'macos');
  const tab = tabs.find(t => t.platform === linux[0]);
  const tool = tab && new Set(tab.steps.map(s => s.as)).size === 1 ? tab.steps[0].as : undefined;
  const linuxOnly = linux.length === 1 && tab ? `On Linux/WSL, ${tool ? toolLabel(tool) : 'this session'} runs on the ${COMPILER_OF[linux[0]]} build only.` : undefined;
  return { tabs, pending, linuxOnly };
}

export type PlaceholderKind = 'addr' | 'pid' | 'dir' | 'tmp' | 'id';

/** What each normaliser placeholder (tools/verify/session.ts, normaliseSession) stands for. */
export const PLACEHOLDER_HELP: Record<PlaceholderKind, { token: string; help: string }> = {
  addr: { token: '<addrN>', help: 'a memory address. Addresses change from run to run, so they are numbered instead: the same number is the same address.' },
  pid: { token: '<pid>, ==PID==', help: 'a process id, which changes every run.' },
  dir: { token: '<dir>', help: 'the folder the commands ran in.' },
  tmp: { token: '<tmpN>', help: 'a temporary file the compiler made and deleted.' },
  id: { token: '<id>', help: 'a build id, which changes with every build.' },
};

const PLACEHOLDER = /<addr\d+>|<tmp\d+>|<pid>|<dir>|<id>|==PID==|--PID--/g;

function kindOf(token: string): PlaceholderKind {
  if (token.startsWith('<addr')) return 'addr';
  if (token.startsWith('<tmp')) return 'tmp';
  if (token === '<dir>') return 'dir';
  if (token === '<id>') return 'id';
  return 'pid';
}

export interface TextPart { text: string; placeholder?: PlaceholderKind }

/** Splits stored output into plain text and placeholder tokens. */
export function splitPlaceholders(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: m[0], placeholder: kindOf(m[0]) });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** The placeholder kinds that occur in these steps, in PLACEHOLDER_HELP order (for the key under the transcript). */
export function placeholderKinds(steps: SessionStepResult[]): PlaceholderKind[] {
  const seen = new Set<PlaceholderKind>();
  for (const s of steps) for (const t of [s.cmd, s.stdout, s.stderr]) for (const p of splitPlaceholders(t)) if (p.placeholder) seen.add(p.placeholder);
  return (Object.keys(PLACEHOLDER_HELP) as PlaceholderKind[]).filter(k => seen.has(k));
}
