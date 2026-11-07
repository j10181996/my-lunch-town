import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { SAMPLE_SEED, openDb, type Db } from "../db";
import type { Ctx } from "../context";
import { migrateMealOptions } from "../orders/options-schema";
import { lineKeyOf, resolveChoices, validateOptionGroups } from "../../shared/meal-options";
import { SAMPLE_STORE_IDS } from "./fixtures";

let app: FastifyInstance;
let db: Db;
let changes: number;
let n = 0;
const rid = () => `req-opt-${Date.now()}-${n++}-xxxx`;

beforeEach(async () => {
  changes = 0;
  db = openDb(":memory:", SAMPLE_SEED);
  const ctx: Ctx = { db, events: { roomChanged: () => void changes++, bubble() {}, storeOrdersChanged() {} } };
  app = await buildApp({ ctx });
});

function client() {
  let cookie = "";
  const call = async (method: "GET" | "POST" | "PATCH", url: string, body?: unknown) => {
    const res = await app.inject({ method, url, payload: body as never, headers: cookie ? { cookie } : {} });
    const set = res.headers["set-cookie"];
    if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
    const isJson = String(res.headers["content-type"] ?? "").includes("json");
    return { status: res.statusCode, body: isJson ? res.json() : res.body };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, body: unknown = {}) => call("POST", url, body),
    patch: (url: string, body: unknown) => call("PATCH", url, body),
  };
}
type Client = ReturnType<typeof client>;

/** 招牌雞腿飯 120 元：辣度必選單選；加點選填最多兩項。 */
const CHICKEN_OPTIONS = [
  { name: "辣度", min: 1, max: 1, choices: [{ name: "不辣" }, { name: "小辣" }, { name: "大辣" }] },
  { name: "加點", min: 0, max: 2, choices: [{ name: "加飯", priceTwd: 10 }, { name: "加蛋", priceTwd: 15 }, { name: "加菜", priceTwd: 5 }] },
];
const MILD = "g0c1";
const HOT = "g0c2";
const RICE = "g1c0";
const EGG = "g1c1";
const VEG = "g1c2";

async function setChickenOptions(options: unknown = CHICKEN_OPTIONS) {
  const shop = client();
  expect((await shop.post("/api/stores/claim", { manageKey: "demo-store-af" })).status).toBe(200);
  const r = await shop.patch("/api/stores/store-af/meals/meal-af-chicken", { options });
  return { shop, r };
}

async function openRoom(title = "今天午餐團") {
  const owner = client();
  const r = await owner.post("/api/rooms", { title, nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS });
  expect(r.status).toBe(200);
  return { owner, roomId: r.body.snapshot.room.id as string, snapshot: r.body.snapshot };
}

async function join(roomId: string, nickname: string) {
  const c = client();
  expect((await c.post(`/api/rooms/${roomId}/join`, { nickname, avatarId: "avatar-pink" })).status).toBe(200);
  return c;
}

const order = (c: Client, roomId: string, mealId: string, opts: { choiceIds?: unknown; note?: unknown; delta?: number; requestId?: string } = {}) =>
  c.post(`/api/rooms/${roomId}/order-delta`, {
    mealId,
    delta: opts.delta ?? 1,
    requestId: opts.requestId ?? rid(),
    ...(opts.choiceIds !== undefined ? { choiceIds: opts.choiceIds } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  });

describe("店家設定選項群組", () => {
  it("儲存後識別碼依位置產生；可選數量與加價驗證；清空選項", async () => {
    const { shop, r } = await setChickenOptions();
    expect(r.status).toBe(200);
    const meal = r.body.meals.find((m: { id: string }) => m.id === "meal-af-chicken");
    expect(meal.options[0]).toEqual({
      id: "g0", name: "辣度", min: 1, max: 1,
      choices: [{ id: "g0c0", name: "不辣", priceTwd: 0 }, { id: "g0c1", name: "小辣", priceTwd: 0 }, { id: "g0c2", name: "大辣", priceTwd: 0 }],
    });
    expect(meal.options[1].choices.map((c: { priceTwd: number }) => c.priceTwd)).toEqual([10, 15, 5]);

    const bad = [
      Array.from({ length: 5 }, (_, i) => ({ name: `組${i}`, choices: [{ name: "a" }] })),
      [{ name: "辣度", choices: [{ name: "a" }] }, { name: "辣度", choices: [{ name: "b" }] }],
      [{ name: "加點", choices: [{ name: "加飯", priceTwd: -5 }] }],
      [{ name: "加點", choices: [{ name: "加飯", priceTwd: 1.5 }] }],
      [{ name: "加點", min: 2, max: 1, choices: [{ name: "a" }, { name: "b" }] }],
      [{ name: "加點", max: 3, choices: [{ name: "a" }, { name: "b" }] }],
      [{ name: "加點", choices: [] }],
      [{ name: "加點", choices: [{ name: "a" }, { name: "a" }] }],
      "不是陣列",
    ];
    for (const options of bad) {
      const res = await shop.patch("/api/stores/store-af/meals/meal-af-chicken", { options });
      expect(res.status, JSON.stringify(options)).toBe(400);
      expect(res.body.code).toBe("INVALID_INPUT");
    }
    // 只改價格時保留既有選項
    const kept = await shop.patch("/api/stores/store-af/meals/meal-af-chicken", { priceTwd: 125 });
    expect(kept.body.meals.find((m: { id: string }) => m.id === "meal-af-chicken").options).toHaveLength(2);
    const cleared = await shop.patch("/api/stores/store-af/meals/meal-af-chicken", { options: [] });
    expect(cleared.body.meals.find((m: { id: string }) => m.id === "meal-af-chicken").options).toEqual([]);
  });

  it("開團凍結選項；之後改選項只影響新團", async () => {
    const { shop } = await setChickenOptions();
    const old = await openRoom();
    expect(old.snapshot.catalog.meals.find((m: { id: string }) => m.id === "meal-af-chicken").options).toHaveLength(2);
    await shop.patch("/api/stores/store-af/meals/meal-af-chicken", {
      options: [{ name: "辣度", min: 1, max: 1, choices: [{ name: "小辣", priceTwd: 50 }] }],
    });
    // 舊團仍用凍結的選項：g0c1 是小辣、加價 0，加飯仍可選
    const ack = await order(old.owner, old.roomId, "meal-af-chicken", { choiceIds: [MILD, RICE] });
    expect(ack.status).toBe(200);
    expect(ack.body.myTotalTwd).toBe(130);

    const next = await openRoom("明天午餐");
    expect((await order(next.owner, next.roomId, "meal-af-chicken", { choiceIds: [MILD] })).status).toBe(400); // 新菜單沒有 g0c1
    const ok = await order(next.owner, next.roomId, "meal-af-chicken", { choiceIds: ["g0c0"] });
    expect(ok.body.myTotalTwd).toBe(170);
  });
});

describe("點選項與備註", () => {
  it("計價含加價；彙總依選項分列、備註不分列；匯出與店家訂單快照帶選項與備註", async () => {
    await setChickenOptions();
    const { owner, roomId } = await openRoom();
    const rain = await join(roomId, "小雨");
    const lily = await join(roomId, "莉莉");
    // 選項送出順序不同也視為同一組合
    await order(owner, roomId, "meal-af-chicken", { choiceIds: [RICE, MILD] });
    await order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD, RICE] });
    await order(rain, roomId, "meal-af-chicken", { choiceIds: [HOT], note: "  不要  香菜 " });
    await order(rain, roomId, "meal-af-chicken", { choiceIds: [MILD, RICE] });
    await order(lily, roomId, "meal-tree-dry");

    const snap = (await rain.get(`/api/rooms/${roomId}/snapshot`)).body;
    expect(snap.myTotalTwd).toBe(250);
    expect(snap.myItems.map((i: { choiceIds: string[]; note: string; unitPriceTwd: number }) => [i.choiceIds, i.note, i.unitPriceTwd]))
      .toEqual([[[MILD, RICE], "", 130], [[HOT], "不要 香菜", 120]]);
    expect(snap.myItems[1].lineKey).toBe(lineKeyOf("meal-af-chicken", [HOT], "不要 香菜"));
    const af = snap.storeTotals[0];
    expect(af.meals.map((m: { optionLabel?: string; quantity: number; subtotalTwd: number }) => [m.optionLabel, m.quantity, m.subtotalTwd]))
      .toEqual([["小辣、加飯", 3, 390], ["大辣", 1, 120]]);
    expect(snap.totalTwd).toBe(570);

    const sum = (await owner.get(`/api/rooms/${roomId}/summary`)).body;
    expect(sum.people.map((p: { totalTwd: number }) => p.totalTwd)).toEqual([260, 250, 60]);

    await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() });
    const exp = await owner.get(`/api/rooms/${roomId}/export`);
    expect(exp.body).toBe([
      "今天午餐團 已收單",
      "",
      "阿福便當",
      "招牌雞腿飯（小辣、加飯） 3 份 × 130 元 = 390 元",
      "招牌雞腿飯（大辣） 1 份 × 120 元 = 120 元",
      "店家小計 510 元",
      "",
      "大樹麵店",
      "乾麵 1 份 × 60 元 = 60 元",
      "店家小計 60 元",
      "",
      "合計 5 份 570 元",
      "",
      "個人明細",
      "阿凱 招牌雞腿飯（小辣、加飯） × 2 共 260 元",
      "小雨 招牌雞腿飯（小辣、加飯） × 1 招牌雞腿飯（大辣）「不要 香菜」 × 1 共 250 元",
      "莉莉 乾麵 × 1 共 60 元",
    ].join("\n"));

    const shop = client();
    await shop.post("/api/stores/claim", { manageKey: "demo-store-af" });
    const [storeOrder] = (await shop.get("/api/stores/store-af/orders")).body;
    expect(storeOrder.totalTwd).toBe(510);
    expect(storeOrder.items.map((i: { optionLabel?: string; quantity: number }) => [i.optionLabel, i.quantity]))
      .toEqual([["小辣、加飯", 3], ["大辣", 1]]);
    expect(storeOrder.people).toEqual([
      { nickname: "阿凱", totalTwd: 260, items: [{ name: "招牌雞腿飯", quantity: 2, options: "小辣、加飯" }] },
      { nickname: "小雨", totalTwd: 250, items: [
        { name: "招牌雞腿飯", quantity: 1, options: "小辣、加飯" },
        { name: "招牌雞腿飯", quantity: 1, options: "大辣", note: "不要 香菜" },
      ] },
    ]);
  });

  it("沒有選項的餐點也能加備註；同餐點不同備註分列，−1 只動對應那一列", async () => {
    const { owner, roomId } = await openRoom();
    await order(owner, roomId, "meal-af-pork");
    await order(owner, roomId, "meal-af-pork", { note: "飯少" });
    await order(owner, roomId, "meal-af-pork", { note: "飯少" });
    const down = await order(owner, roomId, "meal-af-pork", { note: "飯少", delta: -1 });
    expect(down.body).toMatchObject({ quantity: 1, note: "飯少", lineKey: lineKeyOf("meal-af-pork", [], "飯少") });
    const snap = (await owner.get(`/api/rooms/${roomId}/snapshot`)).body;
    expect(snap.myItems.map((i: { note: string; quantity: number }) => [i.note, i.quantity])).toEqual([["", 1], ["飯少", 1]]);
    // 彙總不依備註分列
    expect(snap.storeTotals[0].meals).toEqual([
      { mealId: "meal-af-pork", name: "滷排骨飯", unitPriceTwd: 110, quantity: 2, subtotalTwd: 220 },
    ]);
    expect((await order(owner, roomId, "meal-af-pork", { note: "沒點過", delta: -1 })).status).toBe(400);
  });

  it("必選、單選、上限、未知選項與備註長度都在伺服器驗證", async () => {
    await setChickenOptions();
    const { owner, roomId } = await openRoom();
    const reject = async (opts: Parameters<typeof order>[3], message?: string) => {
      const r = await order(owner, roomId, "meal-af-chicken", opts);
      expect(r.status, JSON.stringify(opts)).toBe(400);
      expect(r.body.code).toBe("INVALID_INPUT");
      if (message) expect(r.body.message).toBe(message);
    };
    await reject({}, "請選擇「辣度」");
    await reject({ choiceIds: [MILD, HOT] }, "「辣度」只能選一項");
    await reject({ choiceIds: [MILD, RICE, EGG, VEG] }, "「加點」最多選 2 項");
    await reject({ choiceIds: [MILD, "g9c9"] }, "選項不在這道餐點的菜單上");
    await reject({ choiceIds: [MILD, MILD] });
    await reject({ choiceIds: "g0c1" });
    await reject({ choiceIds: [MILD], note: "字".repeat(31) }, "備註最多 30 個字");
    await reject({ choiceIds: [MILD], note: 42 });
    // 沒有選項的餐點不接受選項
    const plain = await order(owner, roomId, "meal-af-pork", { choiceIds: [MILD] });
    expect(plain.status).toBe(400);
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.myItems).toEqual([]);

    // 每人每道餐點 20 份的上限跨所有組合合計
    for (let i = 0; i < 10; i++) await order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD] });
    for (let i = 0; i < 10; i++) await order(owner, roomId, "meal-af-chicken", { choiceIds: [HOT] });
    await reject({ choiceIds: ["g0c0"] }, "同一餐點每人最多 20 份");
    expect((await order(owner, roomId, "meal-af-chicken", { choiceIds: [HOT], delta: -1 })).status).toBe(200);
    expect((await order(owner, roomId, "meal-af-chicken", { choiceIds: ["g0c0"] })).status).toBe(200);
  });
});

describe("去重與並發", () => {
  it("同 requestId 重送只加一次（選項順序不影響）；換選項或備註重用 ID 回 409；沒選項的回應維持舊格式", async () => {
    await setChickenOptions();
    const { owner, roomId } = await openRoom();
    const id = rid();
    const [a, b] = await Promise.all([
      order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD, RICE], requestId: id }),
      order(owner, roomId, "meal-af-chicken", { choiceIds: [RICE, MILD], requestId: id }),
    ]);
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(changes).toBe(1);
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.myTotalQuantity).toBe(1);
    expect((await order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD], requestId: id })).body.code).toBe("REQUEST_ID_CONFLICT");
    expect((await order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD, RICE], note: "加辣", requestId: id })).status).toBe(409);

    const plain = await order(owner, roomId, "meal-af-pork");
    expect(Object.keys(plain.body).sort()).toEqual(["mealId", "myTotalTwd", "quantity", "requestId", "revision"]);
    // 空陣列與空白備註等同沒帶，與舊版請求共用 digest
    const oldStyle = rid();
    await order(owner, roomId, "meal-af-pork", { requestId: oldStyle });
    expect((await order(owner, roomId, "meal-af-pork", { requestId: oldStyle, choiceIds: [], note: "  " })).status).toBe(200);
  });

  it("多人與同一人同時點不同組合：每筆都計入，不互相覆蓋", async () => {
    await setChickenOptions();
    const { owner, roomId } = await openRoom();
    const rain = await join(roomId, "小雨");
    await Promise.all([
      order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD] }),
      order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD] }),
      order(owner, roomId, "meal-af-chicken", { choiceIds: [HOT, EGG] }),
      order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD], note: "不要香菜" }),
      order(rain, roomId, "meal-af-chicken", { choiceIds: [MILD] }),
      order(rain, roomId, "meal-af-chicken", { choiceIds: [HOT, EGG] }),
    ]);
    const snap = (await owner.get(`/api/rooms/${roomId}/snapshot`)).body;
    expect(snap.myTotalQuantity).toBe(4);
    expect(snap.myTotalTwd).toBe(120 * 3 + 135);
    expect(snap.storeTotals[0].meals.map((m: { optionLabel?: string; quantity: number }) => [m.optionLabel, m.quantity]))
      .toEqual([["小辣", 4], ["大辣、加蛋", 2]]);
    expect(snap.totalTwd).toBe(120 * 4 + 135 * 2);
  });

  it("收單與選項點餐並發：收單後的點餐被拒，已成功的重送仍回原結果", async () => {
    await setChickenOptions();
    const { owner, roomId } = await openRoom();
    const id = rid();
    const first = await order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD, RICE], requestId: id });
    const [close, late] = await Promise.all([
      owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() }),
      order(owner, roomId, "meal-af-chicken", { choiceIds: [HOT] }),
    ]);
    expect(close.status).toBe(200);
    if (late.status !== 200) expect(late.body.code).toBe("ROOM_CLOSED");
    const retry = await order(owner, roomId, "meal-af-chicken", { choiceIds: [RICE, MILD], requestId: id });
    expect(retry.body).toEqual(first.body);
    expect((await order(owner, roomId, "meal-af-chicken", { choiceIds: [MILD] })).body.code).toBe("ROOM_CLOSED");
  });
});

describe("純函式", () => {
  it("resolveChoices 依菜單順序回傳並加總加價", () => {
    const groups = validateOptionGroups(CHICKEN_OPTIONS);
    expect(resolveChoices(groups, [VEG, HOT, RICE])).toEqual({ choiceIds: [HOT, RICE, VEG], surchargeTwd: 15 });
    expect(resolveChoices([], undefined)).toEqual({ choiceIds: [], surchargeTwd: 0 });
    expect(lineKeyOf("meal-a")).toBe("meal-a");
  });
});

describe("遷移", () => {
  it("舊庫的 order_items 重建為新主鍵，保留既有明細；重跑不重複套用", () => {
    const old = new DatabaseSync(":memory:");
    old.exec(`
      CREATE TABLE meals (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE room_meals (room_id TEXT NOT NULL, meal_id TEXT NOT NULL, PRIMARY KEY (room_id, meal_id));
      CREATE TABLE order_items (
        room_id TEXT NOT NULL, member_id TEXT NOT NULL, meal_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20), unit_price_twd INTEGER NOT NULL,
        PRIMARY KEY (room_id, member_id, meal_id)
      );
      INSERT INTO order_items VALUES ('r1', 'm1', 'meal-a', 3, 120);
    `);
    migrateMealOptions(old);
    migrateMealOptions(old);
    expect(old.prepare("SELECT * FROM order_items").all().map((r) => ({ ...r }))).toEqual([
      { room_id: "r1", member_id: "m1", meal_id: "meal-a", option_key: "", note: "", quantity: 3, unit_price_twd: 120 },
    ]);
    old.prepare("INSERT INTO order_items VALUES ('r1', 'm1', 'meal-a', 'g0c1', '', 1, 130)").run();
    old.prepare("INSERT INTO order_items VALUES ('r1', 'm1', 'meal-a', '', '少飯', 1, 120)").run();
    expect(() => old.prepare("INSERT INTO order_items VALUES ('r1', 'm1', 'meal-a', '', '', 1, 120)").run()).toThrow();
    expect(() => old.prepare("INSERT INTO order_items VALUES ('r1', 'm1', 'meal-b', '', '', 0, 120)").run()).toThrow();
    const cols = (t: string) => (old.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols("meals")).toContain("options_json");
    expect(cols("room_meals")).toContain("options_json");
  });
});
