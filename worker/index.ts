import type { MoveInput, PlayerPresence } from "../shared/contracts";
import type { Ctx } from "../server/context";
import { isBadgeId } from "../shared/social";
import { closeExpiredRooms } from "../server/rooms/deadline";
import { api, errorResponse, readApiRequest, withSessionCookie } from "../server/api";
import { Hono } from "hono";
import { AppError, err, exportSnapshot, openSnapshot, type SyncDb } from "./db";
import { servePageOrAsset } from "./assets";

// These structural types keep the Node development server independent of Wrangler.
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface Env {
  DB: { prepare(sql: string): Statement };
  ASSETS: { fetch(request: Request): Promise<Response> };
  DEMO_KEY?: string;
  BUCKET?: {
    put(key: string, bytes: Uint8Array, options?: { httpMetadata: { contentType: string } }): Promise<unknown>;
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  };
}
interface Stored { revision: number; bytes: number[] | ArrayBuffer }
const MAX_SNAPSHOT_BYTES = 1_900_000; // D1's per-value limit is 2 MB.
const PRESENCE_TTL = 10_000;
const PRESENCE_SWEEP_RATE = 0.05;

function validMove(value: unknown): value is MoveInput {
  const m = value as MoveInput | null;
  return !!m && typeof m === "object" && typeof m.sceneId === "string"
    && (m.sceneId === "street" || /^shop:[\w-]{1,40}$/.test(m.sceneId))
    && Number.isFinite(m.x) && m.x >= 0 && m.x <= 1
    && Number.isFinite(m.y) && m.y >= 0 && m.y <= 1
    && (m.accessory === undefined || ["none", "flower", "leaf", "cap"].includes(m.accessory))
    && (m.badge === undefined || isBadgeId(m.badge))
    && ["up", "down", "left", "right"].includes(m.direction) && Number.isSafeInteger(m.seq);
}

async function load(env: Env): Promise<Stored> {
  const stored = await env.DB.prepare("SELECT revision, bytes FROM app_state WHERE id = 1").first<Stored>();
  if (stored) return stored;
  const { raw } = await openSnapshot();
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO app_state (id, revision, bytes) VALUES (1, 0, ?)").bind(exportSnapshot(raw)).run();
  } finally { raw.close(); }
  const initial = await env.DB.prepare("SELECT revision, bytes FROM app_state WHERE id = 1").first<Stored>();
  if (!initial) throw err.retry();
  return initial;
}

type Snapshot = Awaited<ReturnType<typeof openSnapshot>>;
interface LiveCache extends Snapshot { revision: number }
/**
 * Polling reuses one opened snapshot per isolate while D1's revision is unchanged,
 * so a sync tick costs a tiny revision read instead of a blob transfer plus decode.
 * The cache is read-only: write paths always open their own copy. Callers must
 * finish every read synchronously before their next await, because a concurrent
 * request may replace (and close) the cached database at any await point.
 */
let liveCache: LiveCache | null = null;

async function liveSnapshot(env: Env): Promise<LiveCache> {
  const cachedRevision = liveCache?.revision ?? -1;
  const row = await env.DB.prepare("SELECT revision, CASE WHEN revision = ? THEN NULL ELSE bytes END AS bytes FROM app_state WHERE id = 1")
    .bind(cachedRevision).first<{ revision: number; bytes: Stored["bytes"] | null }>();
  if (liveCache && row && row.revision <= liveCache.revision) return liveCache;
  const stored = row?.bytes ? { revision: row.revision, bytes: row.bytes } : await load(env);
  const opened = await openSnapshot(stored.bytes);
  // Another request may have cached an equal or newer revision while this one decoded.
  if (liveCache && liveCache.revision >= stored.revision) {
    opened.raw.close();
    return liveCache;
  }
  liveCache?.raw.close();
  liveCache = { ...opened, revision: stored.revision };
  return liveCache;
}

/**
 * Sites 專屬的即時同步：讀取唯讀的快照快取，角色位置直接寫 D1 的 live_presence，
 * 不進入快照交易。Node 改用 Socket.IO（server/realtime/realtime.ts）。
 */
const live = new Hono<{ Bindings: { env: Env; db: SyncDb; sid: string; body: unknown; revision: number } }>();

// 快取可能在任何 await 時被其他請求換掉並關閉，所以成員與店主檢查直接用同步查詢，
// 不呼叫非同步的領域函式；檢查規則與 rooms.ts 的 requireMember、stores.ts 的 requireOwner 相同。
function liveMember(db: SyncDb, roomId: string, sid: string) {
  const room = db.prepare("SELECT revision FROM rooms WHERE id = ?").get(roomId) as { revision: number } | undefined;
  if (!room) throw err.roomNotFound();
  const me = db.prepare("SELECT id FROM members WHERE room_id = ? AND session_id = ?").get(roomId, sid) as { id: string } | undefined;
  if (!me) throw err.session();
  return { room, me };
}

live.post("/api/rooms/:id/live", async (c) => {
  const { env, db, sid, body } = c.env;
  const roomId = c.req.param("id");
  const { room, me } = liveMember(db, roomId, sid);
  const input = body as { clientId?: string; move?: unknown; leave?: boolean; after?: number } | null;
  if (!input || typeof input.clientId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(input.clientId)) throw err.invalid("連線識別碼無效");
  const now = Date.now();
  // Read everything needed from the shared snapshot before the first await.
  const cursor = (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM live_bubbles").get() as { n: number }).n;
  const after = Number.isSafeInteger(input.after) && input.after! >= 0 ? input.after! : cursor;
  const bubbles = db.prepare("SELECT id, member_id AS memberId, text FROM live_bubbles WHERE room_id = ? AND id > ? AND created_at > ? ORDER BY id LIMIT 100")
    .all(roomId, after, now - 30_000);
  if (input.leave) {
    await env.DB.prepare("DELETE FROM live_presence WHERE room_id = ? AND member_id = ? AND client_id = ?")
      .bind(roomId, me.id, input.clientId).run();
    return c.json({ left: true });
  }
  if (input.move !== undefined && !validMove(input.move)) throw err.invalid("角色位置無效");
  const move = input.move as MoveInput | undefined;
  // An idle heartbeat extends the last position without resetting it.
  await env.DB.prepare(`INSERT INTO live_presence (room_id, member_id, client_id, payload, seen_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, member_id, client_id)
    DO UPDATE SET payload = COALESCE(excluded.payload, live_presence.payload), seen_at = excluded.seen_at`)
    .bind(roomId, me.id, input.clientId, move ? JSON.stringify({ ...move, memberId: me.id }) : null, now).run();
  const rows = await env.DB.prepare("SELECT member_id, payload FROM live_presence WHERE room_id = ? AND seen_at > ? ORDER BY seen_at DESC")
    .bind(roomId, now - PRESENCE_TTL).all<{ member_id: string; payload: string | null }>();
  const players = new Map<string, PlayerPresence>();
  for (const row of rows.results) if (row.payload && !players.has(row.member_id)) players.set(row.member_id, JSON.parse(row.payload));
  // Bound ephemeral presence storage without involving order transactions. Reads already
  // filter by seen_at, so sweeping on a sample of ticks saves a D1 write per poll.
  if (Math.random() < PRESENCE_SWEEP_RATE) {
    await env.DB.prepare("DELETE FROM live_presence WHERE seen_at < ?").bind(now - PRESENCE_TTL).run();
  }
  return c.json({ roomId, revision: room.revision, presence: { roomId, players: [...players.values()] }, bubbles, cursor });
});

live.post("/api/stores/:storeId/live", (c) => {
  const storeId = c.req.param("storeId");
  const store = c.env.db.prepare("SELECT owner_session_id FROM stores WHERE id = ?").get(storeId) as { owner_session_id: string | null } | undefined;
  if (!store) throw new AppError("INVALID_INPUT", 404, "找不到這家店");
  if (store.owner_session_id !== c.env.sid) throw err.notAllowed("這不是你的店；可用管理碼認領");
  return c.json({ storeId, revision: c.env.revision });
});

live.onError((error) => errorResponse(error, SITES_FALLBACK));
live.notFound(() => errorResponse(err.invalid("找不到這個同步頻道")));

const SITES_FALLBACK = { status: 503, message: "伺服器暫時無法處理，請稍後重試" };
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * 在快照交易內執行共用的 api：每次嘗試都重新載入 image，寫入成功才以 revision 做 compare-and-swap 寫回；
 * 版本衝突時整筆重跑。api 回錯誤時不寫回。
 */
async function runInSnapshot(request: Request, env: Env, sid: string, body: unknown): Promise<Response> {
  const write = request.method !== "GET";
  for (let attempt = 0; attempt < 8; attempt++) {
    const stored = await load(env);
    const { db, sync, raw } = await openSnapshot(stored.bytes);
    try {
      const ctx: Ctx = { db, images: env.BUCKET ? {
        async put(key, bytes) { await env.BUCKET!.put(key, bytes, { httpMetadata: { contentType: "image/png" } }); },
        async get(key) { const object = await env.BUCKET!.get(key); return object ? new Uint8Array(await object.arrayBuffer()) : null; },
      } : undefined, events: {
        roomChanged() {}, storeOrdersChanged() {},
        bubble(roomId, memberId, text) {
          sync.prepare("INSERT INTO live_bubbles (room_id, member_id, text, created_at) VALUES (?, ?, ?, ?)").run(roomId, memberId, text, Date.now());
        },
      } };
      // Sites 沒有已驗證的排程：任何寫入請求順便收掉已過截止的團，與本次寫入一起提交。
      if (write) await closeExpiredRooms(ctx);
      const response = await api.fetch(request, { ctx, sid, body, demoKey: env.DEMO_KEY ?? "demo" });
      if (write && response.ok) {
        sync.prepare("DELETE FROM live_bubbles WHERE created_at < ?").run(Date.now() - 60_000);
        const bytes = exportSnapshot(raw);
        if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new AppError("RETRY_LATER", 503, "資料容量已達上限，請聯絡管理者擴充；本次操作未寫入");
        const committed = await env.DB.prepare("UPDATE app_state SET bytes = ?, revision = revision + 1 WHERE id = 1 AND revision = ?")
          .bind(bytes, stored.revision).run();
        if (committed.meta.changes !== 1) continue;
      }
      return response;
    } finally { raw.close(); }
  }
  throw err.retry();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return servePageOrAsset(request, env.ASSETS);
    try {
      if (!METHODS.includes(request.method)) return new Response(null, { status: 405 });
      const { sid, body, setCookie } = await readApiRequest(request, { secureCookie: true });
      if (url.pathname.endsWith("/live")) {
        if (request.method !== "POST") return new Response(null, { status: 405 });
        const snapshot = await liveSnapshot(env);
        return withSessionCookie(await live.fetch(request, { env, db: snapshot.sync, sid, body, revision: snapshot.revision }), setCookie);
      }
      return withSessionCookie(await runInSnapshot(request, env, sid, body), setCookie);
    } catch (error) {
      return errorResponse(error, SITES_FALLBACK);
    }
  },
};
