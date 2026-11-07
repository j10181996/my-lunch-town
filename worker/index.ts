import type { MoveInput, PlayerPresence } from "../shared/contracts";
import type { Ctx } from "../server/context";
import { PAYMENT_REMINDER_SCHEMA } from "../server/rooms/payment-schema";
import { requireMember } from "../server/rooms/rooms";
import { requireOwner } from "../server/stores/stores";
import { randomId } from "../server/util";
import { AppError, err, exportSnapshot, openSnapshot, type Db } from "./db";
import { dispatch } from "./router";
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
}
interface Stored { revision: number; bytes: number[] | ArrayBuffer }
const SID_RE = /^[a-z0-9]{24}$/;
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
    && (m.badge === undefined || ["visit", "order", "friend", "collect"].includes(m.badge))
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

async function synchronize(env: Env, db: Db, sid: string, path: string, body: unknown, revision: number) {
  const roomMatch = path.match(/^\/api\/rooms\/([\w-]+)\/live$/);
  if (roomMatch) {
    const roomId = roomMatch[1];
    const { room, me } = requireMember(db, roomId, sid);
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
      return { left: true };
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
    return { roomId, revision: room.revision, presence: { roomId, players: [...players.values()] }, bubbles, cursor };
  }
  const storeMatch = path.match(/^\/api\/stores\/([\w-]+)\/live$/);
  if (storeMatch) {
    requireOwner(db, sid, storeMatch[1]);
    return { storeId: storeMatch[1], revision };
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return servePageOrAsset(request, env.ASSETS);
    const headers = new Headers({ "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" });
    try {
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return new Response(null, { status: 405, headers });
      if (request.method !== "GET") {
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) throw err.notAllowed("請從本站操作");
      }
      const existing = request.headers.get("cookie")?.match(/(?:^|;\s*)lt_sid=([^;]+)/)?.[1];
      const sid = existing && SID_RE.test(existing) ? existing : randomId(24);
      if (sid !== existing) headers.set("set-cookie", `lt_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`);
      let body: unknown;
      if (request.method !== "GET") {
        if (Number(request.headers.get("content-length")) > 65536) throw err.invalid("請求內容過大");
        const text = await request.text();
        if (text.length > 65536) throw err.invalid("請求內容過大");
        try { body = text ? JSON.parse(text) : {}; } catch { throw err.invalid("請求格式錯誤"); }
      }
      if (url.pathname.endsWith("/live")) {
        if (request.method !== "POST") return new Response(null, { status: 405, headers });
        const snapshot = await liveSnapshot(env);
        const result = await synchronize(env, snapshot.db, sid, url.pathname, body, snapshot.revision);
        if (!result) throw err.invalid("找不到這個同步頻道");
        return new Response(JSON.stringify(result), { headers });
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await load(env);
        const { db, raw } = await openSnapshot(stored.bytes);
        try {
          // 舊快照沒有後來新增的資料表時在記憶體補建，寫入時一併保存。
          db.exec(PAYMENT_REMINDER_SCHEMA);
          db.prepare("INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)").run(sid, Date.now());
          const ctx: Ctx = { db, events: {
            roomChanged() {}, storeOrdersChanged() {},
            bubble(roomId, memberId, text) {
              db.prepare("INSERT INTO live_bubbles (room_id, member_id, text, created_at) VALUES (?, ?, ?, ?)").run(roomId, memberId, text, Date.now());
            },
          } };
          const { result, contentType } = await dispatch(ctx, sid, request.method, url.pathname, body, env.DEMO_KEY ?? "demo");
          if (request.method !== "GET") {
            db.prepare("DELETE FROM live_bubbles WHERE created_at < ?").run(Date.now() - 60_000);
            const bytes = exportSnapshot(raw);
            if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new AppError("RETRY_LATER", 503, "資料容量已達上限，請聯絡管理者擴充；本次操作未寫入");
            const committed = await env.DB.prepare("UPDATE app_state SET bytes = ?, revision = revision + 1 WHERE id = 1 AND revision = ?")
              .bind(bytes, stored.revision).run();
            if (committed.meta.changes !== 1) continue;
          }
          headers.set("content-type", contentType);
          return new Response(contentType.startsWith("text/") ? String(result) : JSON.stringify(result), { headers });
        } finally { raw.close(); }
      }
      throw err.retry();
    } catch (error) {
      if (error instanceof AppError) return new Response(JSON.stringify({ code: error.code, message: error.message }), { status: error.status, headers });
      console.error("Sites API failure", url.pathname, error);
      return new Response(JSON.stringify({ code: "RETRY_LATER", message: "伺服器暫時無法處理，請稍後重試" }), { status: 503, headers });
    }
  },
};
