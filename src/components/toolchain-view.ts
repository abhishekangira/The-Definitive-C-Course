import type { ToolchainState } from '../runtime/CRuntime';

export type ToolchainView = 'error' | 'ready-note' | 'progress' | null;

/**
 * What ToolchainProgress shows. `errorOnly` is for places that only need to explain a failed load (a compile error's terminal):
 * they must not show someone else's background download, so they show nothing until the learner has pressed Retry here.
 */
export function toolchainView(state: ToolchainState, o: { errorOnly: boolean; retried: boolean }): ToolchainView {
  if (state.status === 'error') return 'error';
  if (o.errorOnly && !o.retried) return null;
  if (state.status === 'ready') return o.retried ? 'ready-note' : null;
  return state.status === 'loading' ? 'progress' : null;
}
