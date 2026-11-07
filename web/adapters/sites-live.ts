import { request } from "../api";
import type { MoveInput, PlayerBubble, RoomGateway, PresenceSnapshot } from "../../shared/contracts";

let current: { roomId: string; move?: MoveInput } | null = null;
const listeners = new Set<(bubble: PlayerBubble) => void>();

export function subscribeRoom(roomId: string, handlers: Parameters<RoomGateway["subscribe"]>[1]) {
  const connection = { roomId, move: undefined as MoveInput | undefined };
  current = connection;
  const clientId = crypto.randomUUID();
  const controller = new AbortController();
  let active = true;
  let online = false;
  let cursor: number | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/live`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, move: connection.move, after: cursor }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw new Error("同步暫時中斷");
      const data = await response.json() as { revision: number; presence: PresenceSnapshot; bubbles: PlayerBubble[]; cursor: number };
      if (!active) return;
      if (!online) { online = true; handlers.onReconnect(); }
      handlers.onChanged({ roomId, revision: data.revision });
      handlers.onPresence(data.presence);
      for (const bubble of data.bubbles) listeners.forEach((handler) => handler(bubble));
      cursor = data.cursor;
    } catch {
      if (!active) return;
      if (online) online = false;
      handlers.onDisconnect();
    } finally {
      if (active) timer = setTimeout(tick, online ? 250 : 1500);
    }
  };
  void tick();
  return () => {
    active = false;
    clearTimeout(timer);
    controller.abort();
    if (current === connection) current = null;
    void fetch(`/api/rooms/${roomId}/live`, {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, leave: true }), keepalive: true,
    }).catch(() => {});
  };
}

export function move(roomId: string, input: MoveInput) {
  if (current?.roomId === roomId) current.move = input;
}

export function onBubble(handler: (bubble: PlayerBubble) => void) {
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

export function subscribeOrders(storeId: string, onChanged: () => void) {
  let active = true;
  let revision = -1;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      const data = await request<{ revision: number }>("POST", `/api/stores/${storeId}/live`, {});
      if (active && revision !== data.revision) { revision = data.revision; onChanged(); }
    } catch { /* Retry after transient network failures; server rechecks ownership. */ }
    finally { if (active) timer = setTimeout(tick, 1000); }
  };
  void tick();
  return () => { active = false; clearTimeout(timer); };
}
