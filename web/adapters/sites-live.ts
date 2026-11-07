import { request } from "../api";
import type { MoveInput, PlayerBubble, RoomGateway, PresenceSnapshot } from "../../shared/contracts";
import { POLL_MS, pollDelay } from "./poll-policy";

interface Connection { roomId: string; move?: MoveInput; onLocalMove(): void }
let current: Connection | null = null;
const listeners = new Set<(bubble: PlayerBubble) => void>();

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const presenceSignature = (presence: PresenceSnapshot) =>
  presence.players.map((p) => `${p.memberId}:${p.sceneId}:${p.x}:${p.y}:${p.direction}`).sort().join("|");

export function subscribeRoom(roomId: string, handlers: Parameters<RoomGateway["subscribe"]>[1]) {
  const clientId = crypto.randomUUID();
  const controller = new AbortController();
  let active = true;
  let online = false;
  let inFlight = false;
  let cursor: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = 0;
  let lastActivity = 0;
  let lastRevision = -1;
  let lastPresence = "";

  const schedule = (delay: number) => {
    clearTimeout(timer);
    dueAt = Date.now() + delay;
    timer = setTimeout(tick, delay);
  };
  /** Pull the next tick forward when the page is polling slowly but something just happened. */
  const wake = () => {
    if (!active || inFlight || dueAt - Date.now() <= POLL_MS.active) return;
    schedule(0);
  };
  const connection: Connection = {
    roomId,
    move: undefined,
    onLocalMove() {
      lastActivity = Date.now();
      wake();
    },
  };
  current = connection;
  const onVisibility = () => { if (!isHidden()) wake(); };
  document.addEventListener("visibilitychange", onVisibility);

  async function tick() {
    inFlight = true;
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
      const signature = presenceSignature(data.presence);
      if (data.revision !== lastRevision || signature !== lastPresence || data.bubbles.length) lastActivity = Date.now();
      lastRevision = data.revision;
      lastPresence = signature;
      handlers.onChanged({ roomId, revision: data.revision });
      handlers.onPresence(data.presence);
      for (const bubble of data.bubbles) listeners.forEach((handler) => handler(bubble));
      cursor = data.cursor;
    } catch {
      if (!active) return;
      if (online) online = false;
      handlers.onDisconnect();
    } finally {
      inFlight = false;
      if (active) schedule(pollDelay({ online, hidden: isHidden(), now: Date.now(), lastActivity }));
    }
  }
  void tick();
  return () => {
    active = false;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    controller.abort();
    if (current === connection) current = null;
    void fetch(`/api/rooms/${roomId}/live`, {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, leave: true }), keepalive: true,
    }).catch(() => {});
  };
}

export function move(roomId: string, input: MoveInput) {
  if (current?.roomId !== roomId) return;
  current.move = input;
  current.onLocalMove();
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
