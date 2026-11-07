import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inject } from "./inject";
import type { Hono } from "hono";
import { buildApp } from "../app";
import { SAMPLE_SEED, openDb, type Db } from "../db";
import type { Ctx } from "../context";
import { closeExpiredRooms, migrateDeadline } from "../rooms/deadline";
import { SAMPLE_STORE_IDS } from "./fixtures";

let app: Hono;
let ctx: Ctx;
let db: Db;
let storeChanges: string[];
let n = 0;
const rid = () => `req-${Date.now()}-${n++}-xxxx`;
const T0 = Date.UTC(2026, 10, 9, 3, 30); // 台灣時間 11:30
const MIN = 60_000;

beforeEach(async () => {
  // 只假造 Date：app.request 仍使用真的計時器。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  storeChanges = [];
  db = openDb(":memory:", SAMPLE_SEED);
  ctx = {
    db,
    events: { roomChanged() {}, bubble() {}, storeOrdersChanged: (id) => storeChanges.push(id) },
  };
  app = await buildApp({ ctx });
});
afterEach(() => vi.useRealTimers());

function client() {
  let cookie = "";
  const call = async (method: "GET" | "POST" | "PUT", url: string, body?: unknown) => {
    const res = await inject(app, { method, url, payload: body as never, headers: cookie ? { cookie } : {} });
    const set = res.headers["set-cookie"];
    if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
    return { status: res.statusCode, body: res.json() };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, body: unknown = {}) => call("POST", url, body),
    put: (url: string, body: unknown) => call("PUT", url, body),
  };
}

async function openRoom(deadlineAt?: number | null) {
  const owner = client();
  const r = await owner.post("/api/rooms", { title: "截止團", nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS, deadlineAt });
  expect(r.status).toBe(200);
  return { owner, roomId: r.body.snapshot.room.id as string, snapshot: r.body.snapshot };
}

async function joined(roomId: string, nickname: string) {
  const c = client();
  expect((await c.post(`/api/rooms/${roomId}/join`, { nickname, avatarId: "avatar-pink" })).status).toBe(200);
  return c;
}

const plus = (c: ReturnType<typeof client>, roomId: string, mealId: string) =>
  c.post(`/api/rooms/${roomId}/order-delta`, { mealId, delta: 1, requestId: rid() });

/** 店家訂單的可比較內容（不含 id 與時間）。 */
function storeOrders(roomId: string) {
  return (db.prepare("SELECT store_id, status, items_json, people_json, total_quantity, total_twd, fulfillment FROM store_orders WHERE room_id = ? ORDER BY store_id")
    .all(roomId) as Array<Record<string, unknown>>).map((r) => ({ ...r, people_json: JSON.parse(String(r.people_json)) }));
}

describe("開團截止時間", () => {
  it("開團時設定截止時間，快照帶出 deadlineAt；不設時為 null", async () => {
    const { snapshot } = await openRoom(T0 + 30 * MIN);
    expect(snapshot.room.deadlineAt).toBe(T0 + 30 * MIN);
    expect((await openRoom()).snapshot.room.deadlineAt).toBeNull();
  });

  it("拒絕過去、太近、超過 24 小時或格式錯誤的截止時間", async () => {
    for (const deadlineAt of [T0 - MIN, T0 + 30_000, T0 + 25 * 60 * MIN, "12:30", 1.5]) {
      const r = await client().post("/api/rooms", { title: "團", nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS, deadlineAt });
      expect(r.status, String(deadlineAt)).toBe(400);
      expect(r.body.code).toBe("INVALID_INPUT");
    }
  });

  it("同一 requestId 在截止範圍外重送仍取回原本的團", async () => {
    const owner = client();
    const body = { title: "團", nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS, deadlineAt: T0 + 2 * MIN };
    const first = await owner.post("/api/rooms", body);
    vi.setSystemTime(T0 + 5 * MIN);
    const retry = await owner.post("/api/rooms", body);
    expect(retry.status).toBe(200);
    expect(retry.body.snapshot.room.id).toBe(first.body.snapshot.room.id);
  });

  it("揪團者可延後或取消截止；團員不行", async () => {
    const { owner, roomId } = await openRoom(T0 + 10 * MIN);
    const rain = await joined(roomId, "小雨");
    expect((await rain.put(`/api/rooms/${roomId}/deadline`, { deadlineAt: T0 + 20 * MIN })).status).toBe(403);
    const later = await owner.put(`/api/rooms/${roomId}/deadline`, { deadlineAt: T0 + 20 * MIN });
    expect(later.body.room.deadlineAt).toBe(T0 + 20 * MIN);
    const cleared = await owner.put(`/api/rooms/${roomId}/deadline`, { deadlineAt: null });
    expect(cleared.body.room.deadlineAt).toBeNull();
    expect((await owner.put(`/api/rooms/${roomId}/deadline`, {})).status).toBe(400);
  });
});

describe("時間到自動收單", () => {
  it("截止後尚未觸發收單，點餐、加入、改截止仍以伺服器時間拒絕", async () => {
    const { owner, roomId } = await openRoom(T0 + 10 * MIN);
    const rain = await joined(roomId, "小雨");
    expect((await plus(rain, roomId, "meal-af-pork")).status).toBe(200);

    vi.setSystemTime(T0 + 10 * MIN);
    const late = await plus(rain, roomId, "meal-af-pork");
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("ROOM_CLOSED");
    expect((await client().post(`/api/rooms/${roomId}/join`, { nickname: "遲到", avatarId: "avatar-blue" })).body.code).toBe("ROOM_CLOSED");
    expect((await owner.put(`/api/rooms/${roomId}/deadline`, { deadlineAt: T0 + 30 * MIN })).body.code).toBe("ROOM_CLOSED");
    // 訂單沒有被逾時的點餐改動
    expect((await owner.get(`/api/rooms/${roomId}/summary`)).body.totalQuantity).toBe(1);
  });

  it("截止前呼叫 expire 不做事；截止後任何團員都能觸發，並送單給店家", async () => {
    const { roomId } = await openRoom(T0 + 10 * MIN);
    const rain = await joined(roomId, "小雨");
    await plus(rain, roomId, "meal-af-pork");

    const early = await rain.post(`/api/rooms/${roomId}/expire`);
    expect(early.body.room.status).toBe("open");
    expect(storeOrders(roomId)).toHaveLength(0);

    vi.setSystemTime(T0 + 10 * MIN + 1);
    const expired = await rain.post(`/api/rooms/${roomId}/expire`);
    expect(expired.body.room.status).toBe("closed");
    expect(storeOrders(roomId)).toHaveLength(1);
    expect(storeChanges).toEqual(["store-af"]);
    // 重試不重複建單、不遞增 revision
    const again = await rain.post(`/api/rooms/${roomId}/expire`);
    expect(again.body.room.revision).toBe(expired.body.room.revision);
    expect(storeOrders(roomId)).toHaveLength(1);
  });

  it("沒設截止的團不會被自動收單", async () => {
    const { roomId } = await openRoom();
    vi.setSystemTime(T0 + 48 * 60 * MIN);
    expect(closeExpiredRooms(ctx)).toEqual([]);
    expect((db.prepare("SELECT status FROM rooms WHERE id = ?").get(roomId) as { status: string }).status).toBe("open");
  });

  it("自動收單與手動收單產生相同的店家訂單", async () => {
    const auto = await openRoom(T0 + 10 * MIN);
    const manual = await openRoom(T0 + 10 * MIN);
    for (const { owner, roomId } of [auto, manual]) {
      const rain = await joined(roomId, "小雨");
      await plus(owner, roomId, "meal-af-pork");
      await plus(rain, roomId, "meal-af-pork");
      await plus(rain, roomId, "meal-tree-dry");
    }
    await manual.owner.post(`/api/rooms/${manual.roomId}/close`, { requestId: rid() });
    vi.setSystemTime(T0 + 10 * MIN);
    expect(closeExpiredRooms(ctx)).toEqual([auto.roomId]);

    expect(storeOrders(auto.roomId)).toEqual(storeOrders(manual.roomId));
    expect(storeOrders(auto.roomId)).toHaveLength(2);
    const summary = (await auto.owner.get(`/api/rooms/${auto.roomId}/summary`)).body;
    expect(summary).toMatchObject({ status: "closed", totalQuantity: 3 });
  });

  it("手動收單、自動收單、expire 與點餐並發時只收一次，結果一致", async () => {
    const { owner, roomId } = await openRoom(T0 + 10 * MIN);
    const rain = await joined(roomId, "小雨");
    const bo = await joined(roomId, "阿波");
    await plus(rain, roomId, "meal-af-pork");

    vi.setSystemTime(T0 + 10 * MIN);
    const [close, expireA, order, expireB] = await Promise.all([
      owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() }),
      rain.post(`/api/rooms/${roomId}/expire`),
      plus(bo, roomId, "meal-tree-dry"),
      bo.post(`/api/rooms/${roomId}/expire`),
    ]);
    const swept = closeExpiredRooms(ctx);

    expect(order.status).toBe(409);
    expect(swept).toEqual([]);
    for (const r of [close, expireA, expireB]) {
      expect(r.status).toBe(200);
      expect(r.body.room.status).toBe("closed");
    }
    const orders = storeOrders(roomId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ store_id: "store-af", total_quantity: 1 });
    expect(storeChanges).toEqual(["store-af"]);
  });

  it("截止前的點餐與自動收單並發：點餐成功就一定進入店家訂單", async () => {
    const { roomId } = await openRoom(T0 + 10 * MIN);
    const rain = await joined(roomId, "小雨");
    vi.setSystemTime(T0 + 10 * MIN - 1);
    const order = await plus(rain, roomId, "meal-af-pork");
    expect(order.status).toBe(200);
    vi.setSystemTime(T0 + 10 * MIN);
    closeExpiredRooms(ctx);
    expect(storeOrders(roomId)).toEqual([expect.objectContaining({ store_id: "store-af", total_quantity: 1 })]);
  });
});

describe("遷移", () => {
  it("舊資料庫補上 deadline_at，重複執行不出錯", () => {
    const old = openDb(":memory:", SAMPLE_SEED);
    old.exec("ALTER TABLE rooms DROP COLUMN deadline_at");
    migrateDeadline(old);
    migrateDeadline(old);
    const cols = (old.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("deadline_at");
  });
});
