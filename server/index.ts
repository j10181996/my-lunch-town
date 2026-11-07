import { fileImageStorage } from "./images/files";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { buildApp } from "./app";
import type { Ctx, RoomEvents } from "./context";
import { TAICHUNG_SEED, asyncDb, openDb } from "./db";
import { attachRealtime } from "./realtime/realtime";
import { closeExpiredRooms } from "./rooms/deadline";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
/** 展示用後台碼：一次取得所有種子店家的後台。DEMO_KEY= （空字串）可停用。 */
const DEMO_KEY = process.env.DEMO_KEY ?? "demo";
const DATA_DIR = process.env.DATA_DIR ?? join(here, "../data");
mkdirSync(DATA_DIR, { recursive: true });

// SEED_FILE 可改用其他種子（例如規格的示範店家 shared/catalog/seed.json）；只在資料庫沒有店家時寫入
const db = asyncDb(openDb(join(DATA_DIR, "lunch-town.db"), process.env.SEED_FILE ?? TAICHUNG_SEED));

// realtime 需要 http server，app 需要 events：先用轉接物件，listen 前接上
let events: RoomEvents = { roomChanged() {}, bubble() {}, storeOrdersChanged() {} };
const ctx: Ctx = {
  db,
  images: fileImageStorage(join(DATA_DIR, "images")),
  events: {
    roomChanged: (r, v) => events.roomChanged(r, v),
    storeOrdersChanged: (s) => events.storeOrdersChanged(s),
    bubble: (r, m, t) => events.bubble(r, m, t),
  },
};

const app = buildApp({
  ctx,
  staticDir: process.env.NODE_ENV === "production" ? join(here, "../dist") : undefined,
  secureCookie: process.env.COOKIE_SECURE === "1",
  demoKey: DEMO_KEY,
});
// Socket.IO 掛在同一個 http server 上，自行處理 /socket.io/ 的請求，其餘交給 Hono。
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }) as Server;
events = attachRealtime(server, db);

// Node 為常駐行程：定期收掉已過截止的團。Sites 改由寫入請求與團員頁面觸發（見 rooms/deadline.ts）。
setInterval(() => {
  closeExpiredRooms(ctx).catch((e) => console.error("自動收單失敗，下一輪重試", e));
}, 5_000).unref();

console.log(`午餐小鎮伺服器：http://localhost:${PORT}`);
console.log("種子店家管理碼：demo-{storeId}，例如 demo-store-chingfan");
console.log(DEMO_KEY ? `展示用後台碼：${DEMO_KEY}（一次取得所有種子店家；設 DEMO_KEY= 可停用）` : "展示用後台碼：已停用");
