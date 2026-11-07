/**
 * Sites sync polls over HTTP (no cross-instance broadcast is verified, see #2/#39),
 * so the interval trades latency against request quota:
 * - active: someone in the room moved or the order revision changed recently,
 *   so movement stays smooth and order changes land within one fast tick;
 * - idle: a visible page with nothing happening still sees order changes within 1s;
 * - hidden: a background tab only keeps its presence alive (TTL is 10s);
 * - offline: retry steadily so a reconnect replays pending orders quickly.
 */
export const POLL_MS = { active: 250, idle: 1000, hidden: 5000, offline: 1500 } as const;
/** How long the room counts as active after the last observed change. */
export const ACTIVE_WINDOW_MS = 5000;

export function pollDelay(state: { online: boolean; hidden: boolean; now: number; lastActivity: number }): number {
  if (!state.online) return POLL_MS.offline;
  if (state.hidden) return POLL_MS.hidden;
  return state.now - state.lastActivity < ACTIVE_WINDOW_MS ? POLL_MS.active : POLL_MS.idle;
}
