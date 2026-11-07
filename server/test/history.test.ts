import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MyRoomSummary } from "../../shared/contracts";
import { buildApp } from "../app";
import { SAMPLE_SEED, openDb, type Db } from "../db";
import { noopEvents } from "../context";
import { MY_ROOMS_LIMIT } from "../rooms/history";
import { SAMPLE_STORE_IDS } from "./fixtures";

let app: FastifyInstance;
let db: Db;
let n = 0;
const rid = () => `req-${Date.now()}-${n++}-xxxx`;

beforeEach(async () => {
  db = openDb(":memory:", SAMPLE_SEED);
  app = await buildApp({ ctx: { db, events: noopEvents } });
});

/** 一個 client = 一個 Cookie 身分；傳入 cookie 模擬同一身分的另一台裝置。 */
function client(initial = "") {
  let cookie = initial;
  const call = async (method: "GET" | "POST", url: string, body?: unknown) => {
    const res = await app.inject({ method, url, payload: body as never, headers: cookie ? { cookie } : {} });
    const set = res.headers["set-cookie"];
    if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
    return { status: res.statusCode, body: res.json() };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, body: unknown = {}) => call("POST", url, body),
    cookie: () => cookie,
  };
}

async function open(c: ReturnType<typeof client>, title: string, extra: Record<string, unknown> = {}) {
  const r = await c.post("/api/rooms", { title, nickname: "阿凱", avatarId: "avatar-green", requestId: rid(), storeIds: SAMPLE_STORE_IDS, ...extra });
  expect(r.status).toBe(200);
  return r.body.snapshot.room.id as string;
}

const history = async (c: ReturnType<typeof client>) => (await c.get("/api/my/rooms")).body as MyRoomSummary[];

describe("我的團歷史", () => {
  it("新身分沒有歷史", async () => {
    expect(await history(client())).toEqual([]);
  });

  it("列出我開過與參加過的團，新到舊，只含自己的金額", async () => {
    const kai = client(), rain = client(), stranger = client();
    const first = await open(kai, "週一團", { deliveryPoint: { x: 0.3, y: 0.4 } });
    await rain.post(`/api/rooms/${first}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    await rain.post(`/api/rooms/${first}/order-delta`, { mealId: "meal-af-pork", delta: 1, requestId: rid() });
    await kai.post(`/api/rooms/${first}/close`, { requestId: rid() });
    db.prepare("UPDATE rooms SET created_at = created_at - 86400000 WHERE id = ?").run(first);
    const second = await open(rain, "週二團");

    const mine = await history(rain);
    expect(mine.map((r) => r.id)).toEqual([second, first]);
    expect(mine[1]).toMatchObject({
      title: "週一團", status: "closed", role: "participant", memberCount: 2, nickname: "小雨", avatarId: "avatar-pink",
      deliveryPoint: { x: 0.3, y: 0.4 }, stores: expect.arrayContaining([{ id: "store-af", name: expect.any(String) }]),
    });
    expect(mine[1].myTotalTwd).toBeGreaterThan(0);
    expect(mine[1].closedAt).not.toBeNull();
    expect(mine[0]).toMatchObject({ title: "週二團", status: "open", role: "owner", myTotalTwd: 0, deliveryPoint: null });

    const kais = await history(kai);
    expect(kais.map((r) => r.id)).toEqual([first]);
    expect(kais[0]).toMatchObject({ role: "owner", myTotalTwd: 0 });
    expect(await history(stranger)).toEqual([]);
  });

  it("同一身分換一台裝置看到同樣的歷史", async () => {
    const phone = client();
    await open(phone, "手機開的團");
    const laptop = client(phone.cookie());
    expect(await history(laptop)).toEqual(await history(phone));
    expect(await history(laptop)).toHaveLength(1);
  });

  it(`最多列出 ${MY_ROOMS_LIMIT} 團`, async () => {
    const kai = client();
    for (let i = 0; i < MY_ROOMS_LIMIT + 2; i++) await open(kai, `團 ${i}`);
    expect(await history(kai)).toHaveLength(MY_ROOMS_LIMIT);
  });
});

describe("再揪一次", () => {
  it("用歷史的設定開新團：套用當下菜單，不複製成員、訂單或付款", async () => {
    const kai = client(), rain = client();
    const old = await open(kai, "老地方", { deliveryPoint: { x: 0.6, y: 0.2 } });
    await rain.post(`/api/rooms/${old}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    await rain.post(`/api/rooms/${old}/order-delta`, { mealId: "meal-af-pork", delta: 1, requestId: rid() });
    await kai.post(`/api/rooms/${old}/close`, { requestId: rid() });
    db.prepare("UPDATE meals SET price_twd = price_twd + 10 WHERE id = 'meal-af-pork'").run();

    // 團員也能用自己參加過的團再揪一次，成為新團的揪團者
    const [h] = await history(rain);
    const again = await rain.post("/api/rooms", {
      title: h.title, nickname: h.nickname, avatarId: h.avatarId, requestId: rid(),
      storeIds: h.stores.map((s) => s.id), deliveryPoint: h.deliveryPoint,
    });
    expect(again.status).toBe(200);
    const snap = again.body.snapshot;
    expect(snap.room.id).not.toBe(old);
    expect(snap.room).toMatchObject({ title: "老地方", status: "open", deliveryPoint: { x: 0.6, y: 0.2 } });
    expect(snap.me).toMatchObject({ role: "owner", nickname: "小雨", avatarId: "avatar-pink" });
    expect(snap.members).toHaveLength(1);
    expect(snap.totalQuantity).toBe(0);
    expect(snap.payment).toBeNull();
    const oldPrice = (await kai.get(`/api/rooms/${old}/snapshot`)).body.catalog.meals.find((m: { id: string }) => m.id === "meal-af-pork").priceTwd;
    expect(snap.catalog.meals.find((m: { id: string }) => m.id === "meal-af-pork").priceTwd).toBe(oldPrice + 10);
    expect((await history(rain))[0].id).toBe(snap.room.id);
  });
});
