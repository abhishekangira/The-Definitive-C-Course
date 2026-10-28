// Which stored steps V7's native panes show (issue #90): a session's views are labelled by `as:` in session.yaml
// (`asm`, `nm`, `objdump`), one platform tab per stored run, and the learner's "my machine" setting picks the default.
import type { SessionPlatform, SessionResult, SessionStepResult } from '../content-model/types';
import type { Platform } from '../progress/store';
import { SESSION_PLATFORM_LABEL, SESSION_PLATFORMS } from '../components/transcript-tabs';

export type NativeView = 'asm' | 'nm' | 'objdump';

export const NATIVE_VIEWS: ReadonlyArray<{ key: NativeView; label: string }> = [
  { key: 'asm', label: 'Assembly (-S -g)' },
  { key: 'nm', label: 'nm' },
  { key: 'objdump', label: 'objdump -d -l' },
];

export interface NativeTab {
  platform: SessionPlatform;
  label: string;
  step: SessionStepResult;
}

export interface NativeTabs {
  tabs: NativeTab[];
  /** Platforms the session has steps for but no stored run yet (macOS before the Targets workflow). */
  pending: SessionPlatform[];
  /** Platforms with a stored run, but no step for this view. */
  missingView: SessionPlatform[];
}

/** The platform tabs for one view: the last stored step labelled `as: <view>`, per platform. */
export function nativeTabs(session: SessionResult, view: NativeView): NativeTabs {
  const tabs: NativeTab[] = [];
  const pending: SessionPlatform[] = [];
  const missingView: SessionPlatform[] = [];
  for (const platform of SESSION_PLATFORMS) {
    const run = session.runs[platform];
    if (!run) {
      if (session.platforms.includes(platform)) pending.push(platform);
      continue;
    }
    const step = [...run].reverse().find(s => s.as === view);
    if (step) tabs.push({ platform, label: SESSION_PLATFORM_LABEL[platform], step });
    else missingView.push(platform);
  }
  return { tabs, pending, missingView };
}

/**
 * The command to show above a native view. The `asm` step only prints the assembly (`sed '/…/,$d' main.s`), so show
 * the compile that wrote main.s instead; nm and objdump show their own stored command. Display only.
 */
export function viewCommand(session: SessionResult, platform: SessionPlatform, view: NativeView): string | undefined {
  const run = session.runs[platform];
  if (!run) return undefined;
  let i = -1;
  for (let j = run.length - 1; j >= 0; j--) if (run[j].as === view) { i = j; break; }
  if (i < 0) return undefined;
  if (view === 'asm') {
    for (let j = i - 1; j >= 0; j--) if (/(^|\s)-S(\s|$)/.test(run[j].cmd)) return run[j].cmd;
  }
  return run[i].cmd;
}

/** The stored session platform the "my machine" setting refers to, when the course stores one. */
export function preferredSessionPlatform(platform: Platform | undefined): SessionPlatform | null {
  switch (platform) {
    case 'mac-arm':
    case 'mac-intel': return 'macos';
    case 'wsl':
    case 'linux-x86': return 'linux-gcc';
    // Linux arm64 has no stored panes (the course stores Linux x86-64 and macOS runs); unset is no preference.
    default: return null;
  }
}
