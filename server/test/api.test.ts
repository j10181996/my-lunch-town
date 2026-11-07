import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { DELIVERY_ADDRESS_MAX, type RoomSnapshot } from "../../shared/contracts";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { distanceKm } from "../../shared/delivery";
import { haversineKm } from "../../shared/geo";
import { lotDoor } from "../../shared/town";
import { createRoom } from "../rooms/rooms";
import { changeQuantity, closeRoom } from "../orders/orders";
import { SAMPLE_SEED, TAICHUNG_SEED, openDb } from "../db";
import { noopEvents, type Ctx } from "../context";
import { SAMPLE_STORE_IDS } from "./fixtures";

let app: FastifyInstance;
let changes: Array<{ roomId: string; revision: number }>;
let storeChanges: string[];
let n = 0;
const TAICHUNG_STORE_IDS = (JSON.parse(readFileSync(TAICHUNG_SEED, "utf8")) as { stores: Array<{ id: string }> }).stores.map((s) => s.id);
const rid = () => `req-${Date.now()}-${n++}-xxxx`;

beforeEach(async () => {
  changes = [];
  storeChanges = [];
  const ctx: Ctx = {
    db: openDb(":memory:", SAMPLE_SEED),
    events: {
      roomChanged: (roomId, revision) => changes.push({ roomId, revision }),
      bubble() {},
      storeOrdersChanged: (storeId) => storeChanges.push(storeId),
    },
  };
  app = await buildApp({ ctx });
});

/** 一個 client = 一個獨立的 Cookie 工作階段。 */
function client() {
  let cookie = "";
  const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) => {
    const res = await app.inject({ method, url, payload: body as never, headers: cookie ? { cookie } : {} });
    const set = res.headers["set-cookie"];
    if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
    const isJson = String(res.headers["content-type"] ?? "").includes("json");
    return { status: res.statusCode, body: isJson ? res.json() : res.body };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, body: unknown = {}) => call("POST", url, body),
    put: (url: string, body: unknown) => call("PUT", url, body),
    patch: (url: string, body: unknown) => call("PATCH", url, body),
    del: (url: string) => call("DELETE", url),
  };
}

async function openRoom(title = "今天午餐團", nickname = "阿凱", storeIds: string[] = SAMPLE_STORE_IDS) {
  const owner = client();
  const r = await owner.post("/api/rooms", { title, nickname, requestId: rid(), storeIds });
  expect(r.status).toBe(200);
  return { owner, roomId: r.body.snapshot.room.id as string, created: r.body };
}

const plus = (c: ReturnType<typeof client>, roomId: string, mealId: string, delta = 1, requestId = rid()) =>
  c.post(`/api/rooms/${roomId}/order-delta`, { mealId, delta, requestId });

describe("開團與加入", () => {
  it("第二位使用者以網址加入，得到不同 memberId；同 Cookie 重新加入恢復原成員", async () => {
    const { owner, roomId, created } = await openRoom();
    expect(created.invitePath).toBe(`/r/${roomId}`);
    expect(created.snapshot.me.role).toBe("owner");
    expect(created.snapshot.catalog.stores).toHaveLength(3);
    expect(created.snapshot.catalog.meals).toHaveLength(9);

    const pub = await client().get(`/api/rooms/${roomId}/public`);
    expect(pub.body).toMatchObject({ title: "今天午餐團", status: "open", memberCount: 1 });

    const rain = client();
    expect((await rain.get(`/api/rooms/${roomId}/snapshot`)).status).toBe(401);
    const j1 = await rain.post(`/api/rooms/${roomId}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    expect(j1.status).toBe(200);
    expect(j1.body.me.id).not.toBe(created.snapshot.me.id);
    const j2 = await rain.post(`/api/rooms/${roomId}/join`, { nickname: "別的名字", avatarId: "avatar-blue" });
    expect(j2.body.me.id).toBe(j1.body.me.id);
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.members).toHaveLength(2);
  });

  it("開團重試同 requestId 不重複開團", async () => {
    const c = client();
    const body = { title: "午餐", nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS };
    const a = await c.post("/api/rooms", body);
    const b = await c.post("/api/rooms", body);
    expect(b.body.snapshot.room.id).toBe(a.body.snapshot.room.id);
  });

  it("團長開團時可選角色；未選或無效時用預設角色", async () => {
    const pick = await client().post("/api/rooms", { title: "午餐", nickname: "阿凱", avatarId: "avatar-green", requestId: rid(), storeIds: SAMPLE_STORE_IDS });
    expect(pick.body.snapshot.members[0].avatarId).toBe("avatar-green");
    const bad = await client().post("/api/rooms", { title: "午餐", nickname: "阿凱", avatarId: "nope", requestId: rid(), storeIds: SAMPLE_STORE_IDS });
    expect(bad.body.snapshot.members[0].avatarId).toBe("avatar-blue");
    const { created } = await openRoom();
    expect(created.snapshot.members[0].avatarId).toBe("avatar-blue");
  });

  it("重名以後綴區分；無效房間 404", async () => {
    const { roomId } = await openRoom();
    const dup = await client().post(`/api/rooms/${roomId}/join`, { nickname: "阿凱", avatarId: "avatar-pink" });
    expect(dup.body.me.nickname).toBe("阿凱#2");
    expect((await client().get("/api/rooms/nope/public")).status).toBe(404);
  });
});

describe("點餐與計價", () => {
  it("第 11 節 fixture：4 份 410 元，個人 120/230/60，匯出逐字相符", async () => {
    const { owner, roomId } = await openRoom();
    const rain = client();
    const lily = client();
    await rain.post(`/api/rooms/${roomId}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    await lily.post(`/api/rooms/${roomId}/join`, { nickname: "莉莉", avatarId: "avatar-purple" });
    await plus(owner, roomId, "meal-af-chicken");
    await plus(rain, roomId, "meal-af-chicken");
    await plus(rain, roomId, "meal-af-pork");
    await plus(lily, roomId, "meal-tree-dry");

    const sum = await owner.get(`/api/rooms/${roomId}/summary`);
    expect(sum.body.totalQuantity).toBe(4);
    expect(sum.body.totalTwd).toBe(410);
    expect(sum.body.stores.map((s: { totalTwd: number }) => s.totalTwd)).toEqual([350, 60]);
    expect(sum.body.people.map((p: { totalTwd: number }) => p.totalTwd)).toEqual([120, 230, 60]);

    const snap = await rain.get(`/api/rooms/${roomId}/snapshot`);
    expect(snap.body.myTotalTwd).toBe(230);
    expect(snap.body.totalTwd).toBe(410);
    expect(JSON.stringify(snap.body)).not.toContain("member-");

    expect((await owner.get(`/api/rooms/${roomId}/export`)).status).toBe(400); // 未收單
    await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() });
    const exp = await owner.get(`/api/rooms/${roomId}/export`);
    expect(exp.body).toBe(
      [
        "今天午餐團 已收單",
        "",
        "阿福便當",
        "招牌雞腿飯 2 份 × 120 元 = 240 元",
        "滷排骨飯 1 份 × 110 元 = 110 元",
        "店家小計 350 元",
        "",
        "大樹麵店",
        "乾麵 1 份 × 60 元 = 60 元",
        "店家小計 60 元",
        "",
        "合計 4 份 410 元",
        "",
        "個人明細",
        "阿凱 招牌雞腿飯 × 1 共 120 元",
        "小雨 招牌雞腿飯 × 1 滷排骨飯 × 1 共 230 元",
        "莉莉 乾麵 × 1 共 60 元",
      ].join("\n"),
    );
  });

  it("減到零刪列、從零減一被拒、超過 20 被拒、未知餐點 404", async () => {
    const { owner, roomId } = await openRoom();
    expect((await plus(owner, roomId, "meal-af-pork", -1)).status).toBe(400);
    await plus(owner, roomId, "meal-af-pork");
    const down = await plus(owner, roomId, "meal-af-pork", -1);
    expect(down.body.quantity).toBe(0);
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.myItems).toHaveLength(0);
    for (let i = 0; i < 20; i++) await plus(owner, roomId, "meal-tree-dry");
    expect((await plus(owner, roomId, "meal-tree-dry")).status).toBe(400);
    expect((await plus(owner, roomId, "meal-nope")).status).toBe(404);
    expect((await owner.post(`/api/rooms/${roomId}/order-delta`, { mealId: "meal-af-pork", delta: 2, requestId: rid() })).status).toBe(400);
  });

  it("兩人同時對同餐點 +1，總數增加二份", async () => {
    const { owner, roomId } = await openRoom();
    const rain = client();
    await rain.post(`/api/rooms/${roomId}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    await Promise.all([plus(owner, roomId, "meal-af-chicken"), plus(rain, roomId, "meal-af-chicken")]);
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.totalQuantity).toBe(2);
  });

  it("同 requestId 重送只加一次；不同內容重用 ID 回 409", async () => {
    const { owner, roomId } = await openRoom();
    const id = rid();
    const [a, b] = await Promise.all([plus(owner, roomId, "meal-af-chicken", 1, id), plus(owner, roomId, "meal-af-chicken", 1, id)]);
    expect(a.body).toEqual(b.body);
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.totalQuantity).toBe(1);
    const c = await plus(owner, roomId, "meal-af-pork", 1, id);
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("REQUEST_ID_CONFLICT");
  });

  it("每次持久化變更遞增 revision 並通知；去重重送不通知", async () => {
    const { owner, roomId } = await openRoom();
    const id = rid();
    const r1 = await plus(owner, roomId, "meal-af-chicken", 1, id);
    await plus(owner, roomId, "meal-af-chicken", 1, id);
    expect(changes).toEqual([{ roomId, revision: r1.body.revision }]);
  });
});

describe("收單", () => {
  it("收單與 +1 並發時遵守提交先後；收單後重送已成功請求仍回原結果", async () => {
    const { owner, roomId } = await openRoom();
    const rain = client();
    await rain.post(`/api/rooms/${roomId}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    const first = rid();
    const ok = await plus(rain, roomId, "meal-af-chicken", 1, first);
    const [a, close, b] = await Promise.all([
      plus(rain, roomId, "meal-af-pork"),
      owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() }),
      plus(rain, roomId, "meal-tree-dry"),
    ]);
    expect(close.body.room.status).toBe("closed");
    expect(a.status).toBe(200); // 先提交
    expect(b.status).toBe(409); // 收單後到
    expect(b.body.code).toBe("ROOM_CLOSED");
    const sum = await owner.get(`/api/rooms/${roomId}/summary`);
    expect(sum.body.totalQuantity).toBe(2);
    expect(sum.body.revision).toBe(close.body.room.revision);

    const replay = await plus(rain, roomId, "meal-af-chicken", 1, first);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(ok.body);

    const again = await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() });
    expect(again.body.room.revision).toBe(close.body.room.revision);
    expect((await client().post(`/api/rooms/${roomId}/join`, { nickname: "遲到", avatarId: "avatar-blue" })).status).toBe(409);
  });

  it("非 owner 不能收單、讀明細、匯出", async () => {
    const { roomId } = await openRoom();
    const rain = client();
    await rain.post(`/api/rooms/${roomId}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    expect((await rain.post(`/api/rooms/${roomId}/close`, { requestId: rid() })).status).toBe(403);
    expect((await rain.get(`/api/rooms/${roomId}/summary`)).status).toBe(403);
    expect((await rain.get(`/api/rooms/${roomId}/export`)).status).toBe(403);
  });
});

describe("店家端", () => {
  async function newStore(c = client(), lotIndex = 3) {
    const r = await c.post("/api/stores", { name: "咖哩小屋", styleKey: "curry", lotIndex, requestId: rid() });
    expect(r.status).toBe(200);
    return { c, storeId: r.body.profile.id as string, manageKey: r.body.manageKey as string };
  }

  it("開店、上架、營業後，新開的團看得到；無餐點不能營業", async () => {
    const { c, storeId } = await newStore();
    expect((await c.post(`/api/stores/${storeId}/status`, { status: "open" })).status).toBe(400);
    const add = await c.post(`/api/stores/${storeId}/meals`, {
      name: "咖哩飯",
      priceTwd: 130,
      imageAssetKey: "meal-curry-rice",
      available: true,
      tags: ["辣"],
    });
    expect(add.body.meals).toHaveLength(1);
    expect((await c.post(`/api/stores/${storeId}/status`, { status: "open" })).body.status).toBe("open");
    const { created } = await openRoom("今天午餐團", "阿凱", [...SAMPLE_STORE_IDS, storeId]);
    const store = created.snapshot.catalog.stores.find((s: { id: string }) => s.id === storeId);
    expect(store).toMatchObject({ name: "咖哩小屋", styleKey: "curry", lotIndex: 3 });
    expect(created.snapshot.catalog.meals.some((m: { name: string }) => m.name === "咖哩飯")).toBe(true);
  });

  it("飲食標籤：最多 8 個、去除重複，開團凍結菜單帶出標籤", async () => {
    const { c, storeId } = await newStore(client(), 4);
    const tags = ["素食", "全素", "含堅果", "招牌", "素食", "小辣", "限量", "新品", "外帶"];
    expect((await c.post(`/api/stores/${storeId}/meals`, {
      name: "素咖哩", priceTwd: 120, imageAssetKey: "meal-curry-rice", available: true, tags: [...tags, "第十個"],
    })).status).toBe(400);
    const add = await c.post(`/api/stores/${storeId}/meals`, {
      name: "素咖哩", priceTwd: 120, imageAssetKey: "meal-curry-rice", available: true, tags,
    });
    expect(add.status).toBe(200);
    const meal = add.body.meals.find((m: { name: string }) => m.name === "素咖哩");
    expect(meal.tags).toEqual(["素食", "全素", "含堅果", "招牌", "小辣", "限量", "新品", "外帶"]);
    await c.post(`/api/stores/${storeId}/status`, { status: "open" });
    const { created } = await openRoom("今天午餐團", "阿凱", [storeId]);
    expect(created.snapshot.catalog.meals.find((m: { id: string }) => m.id === meal.id).tags).toEqual(meal.tags);
  });

  it("改價只影響之後開的團；舊團照舊價計算與點餐", async () => {
    const shop = client();
    const claim = await shop.post("/api/stores/claim", { manageKey: "demo-store-af" });
    expect(claim.status).toBe(200);
    const { owner, roomId } = await openRoom();
    await shop.patch(`/api/stores/store-af/meals/meal-af-chicken`, { priceTwd: 150 });
    await plus(owner, roomId, "meal-af-chicken");
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.myTotalTwd).toBe(120);
    expect((await shop.get("/api/stores/store-af")).body.activeRoomCount).toBe(1);

    const next = await openRoom("明天午餐");
    await plus(next.owner, next.roomId, "meal-af-chicken");
    expect((await next.owner.get(`/api/rooms/${next.roomId}/snapshot`)).body.myTotalTwd).toBe(150);
  });

  it("休息中的店與下架餐點不出現在新團；舊團仍可點；刪除餐點不影響舊團", async () => {
    const shop = client();
    await shop.post("/api/stores/claim", { manageKey: "demo-store-tree" });
    const old = await openRoom();
    await shop.patch(`/api/stores/store-tree/meals/meal-tree-dry`, { available: false });
    await shop.del(`/api/stores/store-tree/meals/meal-tree-soup`);
    const mid = await openRoom("中");
    const midMeals = mid.created.snapshot.catalog.meals.map((m: { id: string }) => m.id);
    expect(midMeals).not.toContain("meal-tree-dry");
    expect(midMeals).not.toContain("meal-tree-soup");
    expect(midMeals).toContain("meal-tree-sesame");

    await shop.post(`/api/stores/store-tree/status`, { status: "resting" });
    expect(await client().post("/api/rooms", { title: "晚", nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS }))
      .toMatchObject({ status: 400, body: { message: "「大樹麵店」目前沒有營業，請重新選擇店家" } });
    const late = await openRoom("晚", "阿凱", ["store-af", "store-green"]);
    expect(late.created.snapshot.catalog.stores.map((s: { id: string }) => s.id)).not.toContain("store-tree");

    expect((await plus(old.owner, old.roomId, "meal-tree-soup")).status).toBe(200);
    expect((await plus(old.owner, old.roomId, "meal-tree-dry")).status).toBe(200);
  });

  it("下架最後一道供應中餐點時自動休息", async () => {
    const { c, storeId } = await newStore();
    const p = await c.post(`/api/stores/${storeId}/meals`, { name: "咖哩飯", priceTwd: 130, imageAssetKey: "meal-curry-rice", available: true, tags: [] });
    await c.post(`/api/stores/${storeId}/status`, { status: "open" });
    const r = await c.patch(`/api/stores/${storeId}/meals/${p.body.meals[0].id}`, { available: false });
    expect(r.body.status).toBe("resting");
  });

  it("權限與管理碼：他人 403；正確管理碼可認領；錯誤管理碼被拒", async () => {
    const { storeId, manageKey } = await newStore();
    const other = client();
    expect((await other.get(`/api/stores/${storeId}`)).status).toBe(403);
    expect((await other.patch(`/api/stores/${storeId}`, { name: "搶店" })).status).toBe(403);
    expect((await other.post("/api/stores/claim", { manageKey: "wrong-key" })).status).toBe(403);
    expect((await other.post("/api/stores/claim", { manageKey })).body.id).toBe(storeId);
    expect((await other.get("/api/my/stores")).body).toHaveLength(1);
    expect((await client().get("/api/stores/store-nope")).status).toBe(404);
  });

  it("地段重複被拒；價格非整數或負數被拒；開店重試不重複", async () => {
    const c = client();
    expect((await c.post("/api/stores", { name: "撞地段", styleKey: "cafe", lotIndex: 0, requestId: rid() })).status).toBe(400);
    const body = { name: "甜點", styleKey: "cafe", lotIndex: 4, requestId: rid() };
    const a = await c.post("/api/stores", body);
    const b = await c.post("/api/stores", body);
    expect(b.body.profile.id).toBe(a.body.profile.id);
    expect(b.body.manageKey).toBeNull();
    const id = a.body.profile.id;
    for (const priceTwd of [12.5, -1, "100"]) {
      expect((await c.post(`/api/stores/${id}/meals`, { name: "蛋糕", priceTwd, imageAssetKey: "meal-cake", available: true, tags: [] })).status).toBe(400);
    }
    const town = await c.get("/api/town");
    expect(town.body[4].store.name).toBe("甜點");
    expect(town.body[5].store).toBeNull();
  });

  it("小鎮沒有營業中的店時不能開團", async () => {
    const shop = client();
    for (const s of ["af", "tree", "green"]) {
      await shop.post("/api/stores/claim", { manageKey: `demo-store-${s}` });
      await shop.post(`/api/stores/store-${s}/status`, { status: "resting" });
    }
    const r = await client().post("/api/rooms", { title: "午餐", nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS });
    expect(r.status).toBe(400);
  });
});

describe("開團指定店家", () => {
  it("只凍結選到的店與其餐點，地圖、彙總只有這些店", async () => {
    const owner = client();
    const r = await owner.post("/api/rooms", { title: "大樹團", nickname: "阿凱", requestId: rid(), storeIds: ["store-tree"] });
    expect(r.status).toBe(200);
    const snap = r.body.snapshot;
    expect(snap.catalog.stores.map((s: { id: string }) => s.id)).toEqual(["store-tree"]);
    // 沒選的店仍畫在街上（不在本團），不是空地。
    expect(snap.streetStores.map((s: { id: string }) => s.id)).toEqual(["store-af", "store-green"]);
    // 不在本團的店可以進店看菜單（#78），但仍不能點。
    const af = snap.streetStores.find((s: { id: string }) => s.id === "store-af");
    expect(af.meals.map((m: { id: string }) => m.id)).toContain("meal-af-chicken");
    expect(af.meals.every((m: { storeId: string; available: boolean }) => m.storeId === "store-af" && m.available)).toBe(true);
    expect(snap.catalog.meals.length).toBeGreaterThan(0);
    expect(snap.catalog.meals.every((m: { storeId: string }) => m.storeId === "store-tree")).toBe(true);
    expect((await plus(owner, snap.room.id, "meal-af-chicken")).status).toBe(404);
    expect((await plus(owner, snap.room.id, "meal-tree-dry")).status).toBe(200);
  });

  it("沒選、空陣列、不存在、格式錯誤或休息中的店都拒絕，且不建立團", async () => {
    const shop = client();
    await shop.post("/api/stores/claim", { manageKey: "demo-store-green" });
    await shop.post("/api/stores/store-green/status", { status: "resting" });
    const c = client();
    const cases: Array<[unknown, string]> = [
      [undefined, "請先選擇要揪的店家"],
      [[], "請至少選一家店"],
      ["store-af", "請至少選一家店"],
      [["store-af", 3], "店家格式錯誤"],
      [["store-af", "store-nope"], "找不到選擇的店家"],
      [["store-af", "store-green"], "「綠芽素食」目前沒有營業"],
    ];
    for (const [storeIds, message] of cases) {
      const res = await c.post("/api/rooms", { title: "午餐", nickname: "阿凱", requestId: rid(), storeIds });
      expect(res).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
      expect(res.body.message).toContain(message);
    }
  });

  it("店家納入去重：重複與順序不影響，同 requestId 換店家視為衝突", async () => {
    const c = client();
    const body = { title: "午餐", nickname: "阿凱", requestId: rid(), storeIds: ["store-tree", "store-af", "store-af"] };
    const first = await c.post("/api/rooms", body);
    expect(first.body.snapshot.catalog.stores.map((s: { id: string }) => s.id)).toEqual(["store-af", "store-tree"]);
    expect((await c.post("/api/rooms", { ...body, storeIds: ["store-af", "store-tree"] })).body).toEqual(first.body);
    expect(await c.post("/api/rooms", { ...body, storeIds: ["store-af"] }))
      .toMatchObject({ status: 409, body: { code: "REQUEST_ID_CONFLICT" } });
  });
});

describe("台中店家種子資料", () => {
  it("十四家店都能開成團，名稱、價格、數量都符合店家端的驗證規則", async () => {
    const ctx: Ctx = {
      db: openDb(":memory:", TAICHUNG_SEED),
      events: { roomChanged() {}, bubble() {}, storeOrdersChanged() {} },
    };
    const local = await buildApp({ ctx });
    const res = await local.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { title: "午餐", nickname: "阿凱", requestId: "req-taichung-seed-1", storeIds: TAICHUNG_STORE_IDS },
    });
    expect(res.statusCode).toBe(200);
    const { catalog } = res.json().snapshot;
    expect(catalog.isSample).toBe(false);
    expect(catalog.stores.map((s: { lotIndex: number }) => s.lotIndex).sort((a: number, b: number) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19]);
    for (const store of catalog.stores as Array<{ id: string; name: string }>) {
      expect([...store.name].length).toBeLessThanOrEqual(12);
      const meals = catalog.meals.filter((m: { storeId: string }) => m.storeId === store.id);
      expect(meals.length).toBeGreaterThan(0);
      expect(meals.length).toBeLessThanOrEqual(12);
      for (const m of meals) {
        expect([...m.name].length).toBeLessThanOrEqual(16);
        expect(Number.isInteger(m.priceTwd) && m.priceTwd >= 0).toBe(true);
      }
    }
  });
});

describe("收單送到店家與接單流程", () => {
  async function fixture() {
    const { owner, roomId, created } = await openRoom();
    expect(created.snapshot.storeOrders).toEqual([]);
    const rain = client();
    const lily = client();
    await rain.post(`/api/rooms/${roomId}/join`, { nickname: "小雨", avatarId: "avatar-pink" });
    await lily.post(`/api/rooms/${roomId}/join`, { nickname: "莉莉", avatarId: "avatar-purple" });
    await plus(owner, roomId, "meal-af-chicken");
    await plus(rain, roomId, "meal-af-chicken");
    await plus(rain, roomId, "meal-af-pork");
    await plus(lily, roomId, "meal-tree-dry");
    expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.storeOrders).toEqual([]);
    const af = client();
    const tree = client();
    const green = client();
    await af.post("/api/stores/claim", { manageKey: "demo-store-af" });
    await tree.post("/api/stores/claim", { manageKey: "demo-store-tree" });
    await green.post("/api/stores/claim", { manageKey: "demo-store-green" });
    expect((await af.get("/api/stores/store-af/orders")).body).toEqual([]);
    storeChanges = [];
    const closed = (await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() })).body;
    const afOrder = (await af.get("/api/stores/store-af/orders")).body[0];
    const treeOrder = (await tree.get("/api/stores/store-tree/orders")).body[0];
    return { owner, roomId, af, tree, green, afOrder, treeOrder, closed, rain };
  }

  it("fixture 依店建立固定快照，收單重試不重建也不通知", async () => {
    const { owner, roomId, af, tree, green, afOrder, treeOrder, closed } = await fixture();
    expect(afOrder).toMatchObject({ storeName: "阿福便當", totalQuantity: 3, totalTwd: 350,
      roomTitle: "今天午餐團", ownerNickname: "阿凱", status: "sent", rejectReason: null });
    expect(afOrder.id).toMatch(/^so_.{10}$/);
    expect(afOrder.items).toEqual([
      { mealId: "meal-af-chicken", name: "招牌雞腿飯", quantity: 2, unitPriceTwd: 120, subtotalTwd: 240 },
      { mealId: "meal-af-pork", name: "滷排骨飯", quantity: 1, unitPriceTwd: 110, subtotalTwd: 110 },
    ]);
    expect(afOrder.people).toEqual([
      { nickname: "阿凱", items: [{ name: "招牌雞腿飯", quantity: 1 }], totalTwd: 120 },
      { nickname: "小雨", items: [{ name: "招牌雞腿飯", quantity: 1 },
        { name: "滷排骨飯", quantity: 1 }], totalTwd: 230 },
    ]);
    expect(treeOrder).toMatchObject({ totalQuantity: 1, totalTwd: 60 });
    expect(treeOrder.people).toEqual([
      { nickname: "莉莉", items: [{ name: "乾麵", quantity: 1 }], totalTwd: 60 },
    ]);
    expect((await green.get("/api/stores/store-green/orders")).body).toEqual([]);
    expect(storeChanges).toEqual(["store-af", "store-tree"]);
    const before = changes.length;
    const retry = await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() });
    expect(retry.body).toEqual(closed);
    expect(changes).toHaveLength(before);
    expect(storeChanges).toHaveLength(2);
    expect((await af.get("/api/stores/store-af/orders")).body).toEqual([afOrder]);
    expect((await tree.get("/api/stores/store-tree/orders")).body).toEqual([treeOrder]);
    // 店家主檔變更不影響收單時的名稱與明細。
    await af.patch("/api/stores/store-af", { name: "新的店名" });
    expect((await af.get("/api/stores/store-af/orders")).body).toEqual([afOrder]);
  });

  it("讀寫都驗證目前店家擁有者，跨店訂單 404，重新認領可讀舊單", async () => {
    const { owner, af, afOrder, treeOrder } = await fixture();
    const path = `/api/stores/store-af/orders/${afOrder.id}/status`;
    for (const outsider of [owner, client()]) {
      expect(await outsider.get("/api/stores/store-af/orders")).toMatchObject({
        status: 403, body: { code: "NOT_ALLOWED" },
      });
      expect(await outsider.post(path, { status: "accepted" })).toMatchObject({
        status: 403, body: { code: "NOT_ALLOWED" },
      });
    }
    expect((await af.get("/api/stores/store-tree/orders")).status).toBe(403);
    expect(await af.post(`/api/stores/store-af/orders/${treeOrder.id}/status`, { status: "accepted" }))
      .toMatchObject({ status: 404, body: { message: "找不到這筆訂單" } });
    const newOwner = client();
    await newOwner.post("/api/stores/claim", { manageKey: "demo-store-af" });
    expect((await newOwner.get("/api/stores/store-af/orders")).body).toEqual([afOrder]);
    expect((await af.get("/api/stores/store-af/orders")).status).toBe(403);
    expect((await af.post(path, { status: "accepted" })).status).toBe(403);
    expect((await newOwner.post(path, { status: "accepted" })).status).toBe(200);
  });

  it("狀態依序前進、終點鎖定、同狀態重試不寫入或通知，revision 與通知一致", async () => {
    const { owner, rain, roomId, af, afOrder, closed } = await fixture();
    const path = `/api/stores/store-af/orders/${afOrder.id}/status`;
    expect((await af.post(path, { status: "preparing" })).status).toBe(400);
    let revision = closed.room.revision;
    for (const status of ["sent", "accepted", "preparing", "ready"]) {
      const beforeChanges = changes.length;
      const beforeStoreChanges = storeChanges.length;
      const result = await af.post(path, { status, reason: { ignored: true } });
      expect(result.status).toBe(200);
      if (status !== "sent") revision++;
      const snap = (await rain.get(`/api/rooms/${roomId}/snapshot`)).body;
      expect(snap.room.revision).toBe(revision);
      expect(snap.storeOrders.find((o: { storeId: string }) => o.storeId === "store-af").status).toBe(status);
      expect(changes).toHaveLength(beforeChanges + (status === "sent" ? 0 : 1));
      expect(storeChanges).toHaveLength(beforeStoreChanges + (status === "sent" ? 0 : 1));
      if (status !== "sent") {
        expect(changes.at(-1)).toEqual({ roomId, revision });
        expect(storeChanges.at(-1)).toBe("store-af");
      }
      const retry = await af.post(path, { status });
      expect(retry.body).toEqual(result.body);
      expect((await owner.get(`/api/rooms/${roomId}/snapshot`)).body.room.revision).toBe(revision);
      expect(changes).toHaveLength(beforeChanges + (status === "sent" ? 0 : 1));
      expect(storeChanges).toHaveLength(beforeStoreChanges + (status === "sent" ? 0 : 1));
    }
    expect((await af.post(path, { status: "accepted" })).status).toBe(400);
  });

  it("拒單需 trim 後 1–40 字，終點重試保留原原因，accepted 可直接 ready", async () => {
    const { owner, roomId, af, tree, afOrder, treeOrder, closed } = await fixture();
    const path = `/api/stores/store-af/orders/${afOrder.id}/status`;
    const before = changes.length;
    for (const reason of [undefined, "   ", "字".repeat(41)]) {
      expect((await af.post(path, { status: "rejected", reason })).status).toBe(400);
    }
    expect(changes).toHaveLength(before);
    expect((await af.post(path, { status: "rejected", reason: " 已售完 " })).body.rejectReason).toBe("已售完");
    const snap = (await owner.get(`/api/rooms/${roomId}/snapshot`)).body;
    expect(snap.room.revision).toBe(closed.room.revision + 1);
    expect(snap.storeOrders[0]).toMatchObject({ status: "rejected", rejectReason: "已售完" });
    expect((await af.post(path, { status: "rejected" })).body.rejectReason).toBe("已售完");
    expect((await af.post(path, { status: "accepted" })).status).toBe(400);
    const treePath = `/api/stores/store-tree/orders/${treeOrder.id}/status`;
    expect((await tree.post(treePath, { status: "accepted" })).status).toBe(200);
    expect((await tree.post(treePath, { status: "ready" })).status).toBe(200);
  });
});


it("送單失敗回滾整筆收單，成功通知時已可讀取提交後資料", () => {
  const db = openDb(":memory:", SAMPLE_SEED);
  const notified: string[] = [];
  let closing = false;
  const ctx: Ctx = { db, events: {
    roomChanged(roomId, revision) {
      if (!closing) return;
      expect(db.isTransaction).toBe(false);
      expect(db.prepare("SELECT status, revision FROM rooms WHERE id = ?").get(roomId))
        .toMatchObject({ status: "closed", revision });
      expect(db.prepare("SELECT COUNT(*) AS n FROM store_orders WHERE room_id = ?").get(roomId))
        .toMatchObject({ n: 2 });
      notified.push("room");
    },
    storeOrdersChanged(storeId) {
      expect(db.isTransaction).toBe(false);
      expect(db.prepare("SELECT status FROM store_orders WHERE store_id = ?").get(storeId))
        .toMatchObject({ status: "sent" });
      notified.push(storeId);
    },
    bubble() {},
  } };
  try {
    const { snapshot } = createRoom(ctx, "test-session", { title: "原子送單", nickname: "阿凱", requestId: rid(), storeIds: SAMPLE_STORE_IDS });
    const roomId = snapshot.room.id;
    changeQuantity(ctx, "test-session", roomId, { mealId: "meal-af-chicken", delta: 1, requestId: rid() });
    changeQuantity(ctx, "test-session", roomId, { mealId: "meal-tree-dry", delta: 1, requestId: rid() });
    const before = db.prepare("SELECT status, revision, closed_at FROM rooms WHERE id = ?").get(roomId);
    // 第二家店寫入失敗，第一家快照及收單狀態也必須一同回滾。
    db.exec(`CREATE TRIGGER fail_store_order BEFORE INSERT ON store_orders
      WHEN NEW.store_id = 'store-tree' BEGIN SELECT RAISE(ABORT, 'test send failure'); END;`);
    closing = true;
    expect(() => closeRoom(ctx, "test-session", roomId, rid())).toThrow("test send failure");
    expect(db.prepare("SELECT status, revision, closed_at FROM rooms WHERE id = ?").get(roomId)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM store_orders").get()).toMatchObject({ n: 0 });
    expect(notified).toEqual([]);
    db.exec("DROP TRIGGER fail_store_order");
    closeRoom(ctx, "test-session", roomId, rid());
    expect(notified).toEqual(["room", "store-af", "store-tree"]);
  } finally {
    db.close();
  }
});

describe("外送設定、凍結與收單", () => {
  const rules = { enabled: true, tiers: [{ maxKm: 2, minTwd: 120 }, { maxKm: 5, minTwd: 500 }] };
  const point = lotDoor(0);

  it("擁有者可設定規則，其他人 403，非法設定回中央錯誤", async () => {
    const shop = client();
    await shop.post("/api/stores/claim", { manageKey: "demo-store-af" });
    expect(await client().put("/api/stores/store-af/delivery", rules)).toMatchObject({
      status: 403, body: { code: "NOT_ALLOWED" },
    });
    expect(await shop.put("/api/stores/store-af/delivery", rules)).toMatchObject({
      status: 200, body: { delivery: rules },
    });
    expect((await shop.get("/api/stores/store-af")).body.delivery).toEqual(rules);
    expect(await shop.put("/api/stores/store-af/delivery", { enabled: true, tiers: [] }))
      .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
    expect((await shop.get("/api/stores/store-af")).body.delivery).toEqual(rules);
    expect((await shop.put("/api/stores/store-af/delivery", { enabled: false, tiers: [] })).body.delivery)
      .toEqual({ enabled: false, tiers: [] });
  });

  it("開團凍結規則、snapshot 帶地點與規則；達標外送，未達標自取並保存距離與門檻", async () => {
    const shop = client();
    for (const id of ["af", "tree"]) {
      await shop.post("/api/stores/claim", { manageKey: `demo-store-${id}` });
      await shop.put(`/api/stores/store-${id}/delivery`, rules);
    }
    const owner = client();
    const created = await owner.post("/api/rooms", {
      title: "外送測試", nickname: "阿凱", requestId: rid(), deliveryPoint: point, storeIds: SAMPLE_STORE_IDS,
    });
    const snap = created.body.snapshot;
    const roomId = snap.room.id;
    expect(snap.room.deliveryPoint).toEqual(point);
    expect(snap.catalog.stores.find((s: { id: string }) => s.id === "store-af").delivery).toEqual(rules);
    expect(snap.catalog.stores.find((s: { id: string }) => s.id === "store-green").delivery).toBeNull();
    await shop.put("/api/stores/store-af/delivery", { enabled: false, tiers: [] });
    const frozen = (await owner.get(`/api/rooms/${roomId}/snapshot`)).body;
    expect(frozen.catalog.stores.find((s: { id: string }) => s.id === "store-af").delivery).toEqual(rules);
    const next = await openRoom();
    expect(next.created.snapshot.catalog.stores.find((s: { id: string }) => s.id === "store-af").delivery)
      .toEqual({ enabled: false, tiers: [] });
    await plus(owner, roomId, "meal-af-chicken");
    await plus(owner, roomId, "meal-tree-dry");
    const closed = (await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() })).body;
    const expected = [
      { storeId: "store-af", fulfillment: "delivery", distanceKm: 0, deliveryMinTwd: 120 },
      { storeId: "store-tree", fulfillment: "pickup", distanceKm: distanceKm(point, lotDoor(1)), deliveryMinTwd: 120 },
    ];
    expect(closed.storeOrders).toMatchObject(expected);
    for (const order of expected) {
      expect((await shop.get(`/api/stores/${order.storeId}/orders`)).body[0]).toMatchObject(order);
    }
    const retry = (await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() })).body;
    expect(retry).toEqual(closed);
  });

  it("未選地點全部自取；超出距離與未設定規則不保存門檻", async () => {
    const shop = client();
    await shop.post("/api/stores/claim", { manageKey: "demo-store-af" });
    await shop.put("/api/stores/store-af/delivery", rules);
    const noPoint = await openRoom();
    await plus(noPoint.owner, noPoint.roomId, "meal-af-chicken");
    await plus(noPoint.owner, noPoint.roomId, "meal-tree-dry");
    const closed = await noPoint.owner.post(`/api/rooms/${noPoint.roomId}/close`, { requestId: rid() });
    expect(closed.body.room.deliveryPoint).toBeNull();
    expect(closed.body.storeOrders).toHaveLength(2);
    for (const order of closed.body.storeOrders) {
      expect(order).toMatchObject({ fulfillment: "pickup", distanceKm: null, deliveryMinTwd: null });
    }
    await shop.put("/api/stores/store-af/delivery", { enabled: true, tiers: [{ maxKm: 0.1, minTwd: 0 }] });
    const owner = client();
    const { snapshot } = (await owner.post("/api/rooms", {
      title: "太遠", nickname: "阿凱", requestId: rid(), deliveryPoint: { x: 0, y: 0 }, storeIds: SAMPLE_STORE_IDS,
    })).body;
    await plus(owner, snapshot.room.id, "meal-af-chicken");
    await plus(owner, snapshot.room.id, "meal-tree-dry");
    const far = (await owner.post(`/api/rooms/${snapshot.room.id}/close`, { requestId: rid() })).body;
    expect(far.storeOrders).toMatchObject([
      { fulfillment: "pickup", distanceKm: distanceKm({ x: 0, y: 0 }, lotDoor(0)), deliveryMinTwd: null },
      { fulfillment: "pickup", distanceKm: distanceKm({ x: 0, y: 0 }, lotDoor(1)), deliveryMinTwd: null },
    ]);
  });

  it("開團去重包含地點，非法座標拒絕", async () => {
    const owner = client();
    const body = { title: "午餐", nickname: "阿凱", requestId: rid(), deliveryPoint: point, storeIds: SAMPLE_STORE_IDS };
    const first = await owner.post("/api/rooms", body);
    expect((await owner.post("/api/rooms", body)).body).toEqual(first.body);
    expect(await owner.post("/api/rooms", { ...body, deliveryPoint: { x: 0, y: 0 } }))
      .toMatchObject({ status: 409, body: { code: "REQUEST_ID_CONFLICT" } });
    expect(await owner.post("/api/rooms", { ...body, deliveryPoint: undefined }))
      .toMatchObject({ status: 409, body: { code: "REQUEST_ID_CONFLICT" } });
    for (const deliveryPoint of [null, { x: -0.1, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: 1.1 }, { x: "0", y: 0 }, {}]) {
      expect(await owner.post("/api/rooms", { ...body, requestId: rid(), deliveryPoint }))
        .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
    }
  });

  it("送餐地址：團員可見，只交給外送單的店家，自取單不帶", async () => {
    const shop = client();
    for (const id of ["af", "tree"]) {
      await shop.post("/api/stores/claim", { manageKey: `demo-store-${id}` });
      await shop.put(`/api/stores/store-${id}/delivery`, rules);
    }
    const owner = client();
    const address = "台中市西屯區市政北二路 100 號 8 樓";
    const { snapshot } = (await owner.post("/api/rooms", {
      title: "地址測試", nickname: "阿凱", requestId: rid(), deliveryPoint: point,
      deliveryAddress: `  ${address}  `, storeIds: SAMPLE_STORE_IDS,
    })).body;
    const roomId = snapshot.room.id;
    expect(snapshot.room.deliveryAddress).toBe(address);
    const member = client();
    expect((await member.post(`/api/rooms/${roomId}/join`, { nickname: "小美" })).body.room.deliveryAddress).toBe(address);
    await plus(owner, roomId, "meal-af-chicken");
    await plus(owner, roomId, "meal-tree-dry");
    const closed = (await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() })).body;
    expect(closed.room.deliveryAddress).toBe(address);
    for (const order of closed.storeOrders) expect(order).not.toHaveProperty("deliveryAddress");
    expect((await shop.get("/api/stores/store-af/orders")).body[0])
      .toMatchObject({ fulfillment: "delivery", deliveryAddress: address });
    expect((await shop.get("/api/stores/store-tree/orders")).body[0])
      .toMatchObject({ fulfillment: "pickup", deliveryAddress: null });
  });

  it("送餐地址選填、空白視為未填；過長、非文字或沒選地點則拒絕；去重包含地址", async () => {
    const owner = client();
    const base = { title: "午餐", nickname: "阿凱", deliveryPoint: point, storeIds: SAMPLE_STORE_IDS };
    const blank = await owner.post("/api/rooms", { ...base, requestId: rid(), deliveryAddress: "   " });
    expect(blank.body.snapshot.room.deliveryAddress).toBeNull();
    const max = "址".repeat(DELIVERY_ADDRESS_MAX);
    expect((await owner.post("/api/rooms", { ...base, requestId: rid(), deliveryAddress: max })).body.snapshot.room.deliveryAddress)
      .toBe(max);
    for (const deliveryAddress of [max + "址", 123, ["a"]]) {
      expect(await owner.post("/api/rooms", { ...base, requestId: rid(), deliveryAddress }))
        .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
    }
    expect(await owner.post("/api/rooms", { ...base, requestId: rid(), deliveryPoint: undefined, deliveryAddress: "某處" }))
      .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
    const body = { ...base, requestId: rid(), deliveryAddress: "A 棟" };
    const first = await owner.post("/api/rooms", body);
    expect((await owner.post("/api/rooms", body)).body).toEqual(first.body);
    for (const deliveryAddress of ["B 棟", undefined]) {
      expect(await owner.post("/api/rooms", { ...body, deliveryAddress }))
        .toMatchObject({ status: 409, body: { code: "REQUEST_ID_CONFLICT" } });
    }
  });
});

describe("真實經緯度外送", () => {
  const rules = { enabled: true, tiers: [{ maxKm: 1, minTwd: 0 }] };
  // 虛構種子：阿福 24.15,120.65；大樹 24.155,120.66；綠芽 24.16,120.67
  const af = { lat: 24.15, lng: 120.65 };
  const tree = { lat: 24.155, lng: 120.66 };

  it("店家位置：擁有者可設定與清除，其他人 403，非法座標 400", async () => {
    const shop = client();
    await shop.post("/api/stores/claim", { manageKey: "demo-store-af" });
    expect((await shop.get("/api/stores/store-af")).body.location).toEqual(af);
    expect(await client().put("/api/stores/store-af/location", { location: af }))
      .toMatchObject({ status: 403, body: { code: "NOT_ALLOWED" } });
    for (const body of [{}, { location: { lat: 91, lng: 0 } }, { location: "24,120" }]) {
      expect(await shop.put("/api/stores/store-af/location", body))
        .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
    }
    expect((await shop.put("/api/stores/store-af/location", { location: { lat: 24.1234567, lng: 120.7 } })).body.location)
      .toEqual({ lat: 24.123457, lng: 120.7 });
    expect((await shop.put("/api/stores/store-af/location", { location: null })).body.location).toBeNull();
  });

  it("開團凍結店家位置；收單依真實距離，店家未設位置則自取", async () => {
    const shop = client();
    for (const id of ["af", "tree", "green"]) {
      await shop.post("/api/stores/claim", { manageKey: `demo-store-${id}` });
      await shop.put(`/api/stores/store-${id}/delivery`, rules);
    }
    await shop.put("/api/stores/store-green/location", { location: null });
    const owner = client();
    const { snapshot } = (await owner.post("/api/rooms", {
      title: "經緯度", nickname: "阿凱", requestId: rid(), deliveryLocation: af, deliveryAddress: "A 棟",
      storeIds: SAMPLE_STORE_IDS,
    })).body;
    const roomId = snapshot.room.id;
    expect(snapshot.room).toMatchObject({ deliveryLocation: af, deliveryPoint: null, deliveryAddress: "A 棟" });
    expect(snapshot.catalog.stores.map((s: { location: unknown }) => s.location)).toEqual([af, tree, null]);
    // 開團後店家搬家不影響這團
    await shop.put("/api/stores/store-af/location", { location: { lat: 25, lng: 121 } });
    for (const meal of ["meal-af-chicken", "meal-tree-dry", "meal-green-tofu"]) await plus(owner, roomId, meal);
    const closed = (await owner.post(`/api/rooms/${roomId}/close`, { requestId: rid() })).body;
    expect(closed.storeOrders).toMatchObject([
      { storeId: "store-af", fulfillment: "delivery", distanceKm: 0, deliveryMinTwd: 0 },
      { storeId: "store-tree", fulfillment: "pickup", distanceKm: haversineKm(af, tree), deliveryMinTwd: null },
      { storeId: "store-green", fulfillment: "pickup", distanceKm: null, deliveryMinTwd: null },
    ]);
    expect(haversineKm(af, tree)).toBeGreaterThan(1);
    expect((await shop.get("/api/stores/store-af/orders")).body[0]).toMatchObject({ deliveryAddress: "A 棟" });
  });

  it("開團驗證位置、不可同時帶街區座標；去重包含位置", async () => {
    const owner = client();
    const body = { title: "午餐", nickname: "阿凱", requestId: rid(), deliveryLocation: af, storeIds: SAMPLE_STORE_IDS };
    const first = await owner.post("/api/rooms", body);
    expect(first.status).toBe(200);
    expect((await owner.post("/api/rooms", body)).body).toEqual(first.body);
    for (const changed of [{ deliveryLocation: tree }, { deliveryLocation: undefined }, { deliveryLocation: undefined, deliveryPoint: { x: 0, y: 0 } }]) {
      expect(await owner.post("/api/rooms", { ...body, ...changed }))
        .toMatchObject({ status: 409, body: { code: "REQUEST_ID_CONFLICT" } });
    }
    for (const bad of [{ deliveryLocation: { lat: 100, lng: 0 } }, { deliveryLocation: null }, { deliveryPoint: { x: 0, y: 0 } }]) {
      expect(await owner.post("/api/rooms", { ...body, requestId: rid(), ...bad }))
        .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
    }
  });
});

describe("展示用後台碼", () => {
  async function appWith(demoKey?: string) {
    const ctx: Ctx = { db: openDb(":memory:", SAMPLE_SEED), events: noopEvents };
    return buildApp({ ctx, demoKey });
  }
  async function call(local: FastifyInstance, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) {
    const res = await local.inject({ method, url, payload: payload as never, headers: cookie ? { cookie } : {} });
    const set = res.headers["set-cookie"];
    const next = set ? String(Array.isArray(set) ? set[0] : set).split(";")[0] : cookie;
    return { status: res.statusCode, body: res.json(), cookie: next };
  }

  it("一次認領所有種子店家，但不包含使用者自己開的店", async () => {
    const local = await appWith("demo");
    const maker = await call(local, "", "POST", "/api/stores", {
      name: "自己的店",
      styleKey: "cafe",
      lotIndex: 9,
      requestId: "req-demo-key-store-1",
    });
    expect(maker.status).toBe(200);
    const demo = await call(local, "", "POST", "/api/stores/claim", { manageKey: "demo" });
    expect(demo.status).toBe(200);
    expect(demo.body.id).toBe("store-af");
    const mine = await call(local, demo.cookie, "GET", "/api/my/stores");
    expect(mine.body.map((s: { id: string }) => s.id).sort()).toEqual(["store-af", "store-green", "store-tree"]);
    const stillOwner = await call(local, maker.cookie, "GET", `/api/stores/${maker.body.profile.id}`);
    expect(stillOwner.status).toBe(200);
  });

  it("未設定或設為空字串時停用", async () => {
    for (const key of [undefined, ""]) {
      const local = await appWith(key);
      const r = await call(local, "", "POST", "/api/stores/claim", { manageKey: "demo" });
      expect(r.status).toBe(403);
    }
  });
});

describe("團主收款資料與人工確認", () => {
  const info = {
    methods: [{ type: "bank", bankCode: "812", account: "1234-5678-9012", holder: "王阿凱" },
      { type: "linepay", id: "kai" }],
    note: "下午三點前付清",
  };
  async function setup() {
    const { owner, roomId, created } = await openRoom();
    const rain = client();
    const lily = client();
    const empty = client();
    const rainId = (await rain.post(`/api/rooms/${roomId}/join`, { nickname: "小雨" })).body.me.id;
    const lilyId = (await lily.post(`/api/rooms/${roomId}/join`, { nickname: "莉莉" })).body.me.id;
    const emptyId = (await empty.post(`/api/rooms/${roomId}/join`, { nickname: "沒點餐" })).body.me.id;
    await plus(owner, roomId, "meal-af-chicken");
    await plus(rain, roomId, "meal-af-chicken");
    await plus(rain, roomId, "meal-af-pork");
    await plus(lily, roomId, "meal-tree-dry");
    return { owner, roomId, rain, lily, empty, rainId, lilyId, emptyId, ownerId: created.snapshot.me.id };
  }
  it("草稿僅團主可見、收單後才可傳送；傳送及修改的時間與 revision", async () => {
    const { owner, roomId, rain, lily, empty } = await setup();
    const base = `/api/rooms/${roomId}`;
    const draft = await owner.put(`${base}/payment-info`, info);
    expect(draft.status).toBe(200);
    expect(draft.body.payment).toEqual({ info, sentAt: null, ownerNickname: "阿凱", remindedAt: null });
    expect((await rain.get(`${base}/snapshot`)).body.payment).toBeNull();
    expect((await rain.get(`${base}/snapshot`)).body.myPayment).toBeNull();
    expect(await owner.post(`${base}/payment-info/send`)).toMatchObject({
      status: 400, body: { code: "INVALID_INPUT", message: "請先收單再傳送收款資訊" },
    });
    expect((await owner.put(`${base}/payment-info`, { ...info, methods: [] })).status).toBe(400);
    await owner.post(`${base}/close`, { requestId: rid() });
    const before = (await owner.get(`${base}/snapshot`)).body.room.revision;
    const sent = (await owner.post(`${base}/payment-info/send`)).body;
    expect(sent.room.revision).toBe(before + 1);
    expect(sent.payment.sentAt).toEqual(expect.any(Number));
    const { remindedAt: _ownerOnly, ...memberView } = sent.payment;
    expect((await rain.get(`${base}/snapshot`)).body).toMatchObject({
      payment: memberView, myPayment: { amountTwd: 230, status: "unpaid", remindedAt: null },
    });
    expect((await rain.get(`${base}/snapshot`)).body.payment).not.toHaveProperty("remindedAt");
    expect((await lily.get(`${base}/snapshot`)).body.myPayment)
      .toEqual({ amountTwd: 60, status: "unpaid", remindedAt: null });
    expect(sent.myPayment).toBeNull();
    expect((await empty.get(`${base}/snapshot`)).body.myPayment).toBeNull();
    const events = changes.length;
    expect((await owner.post(`${base}/payment-info/send`)).body).toEqual(sent);
    expect((await owner.put(`${base}/payment-info`, info)).body).toEqual(sent);
    expect(changes).toHaveLength(events);
    const updated = { ...info, note: "改成下午四點" };
    const saved = (await owner.put(`${base}/payment-info`, updated)).body;
    expect(saved.room.revision).toBe(sent.room.revision + 1);
    expect(saved.payment).toEqual({ ...sent.payment, info: updated });
    const { remindedAt: _savedOwnerOnly, ...savedMemberView } = saved.payment;
    expect((await rain.get(`${base}/snapshot`)).body.payment).toEqual(savedMemberView);
  });
  it("回報、確認、取消與直接確認；重試不遞增也不發通知；彙總僅計 confirmed", async () => {
    const { owner, roomId, rain, lily, rainId, lilyId } = await setup();
    const base = `/api/rooms/${roomId}`;
    await owner.post(`${base}/close`, { requestId: rid() });
    expect((await rain.post(`${base}/payment/report`)).status).toBe(400);
    await owner.put(`${base}/payment-info`, info);
    await owner.post(`${base}/payment-info/send`);
    let revision = (await rain.get(`${base}/snapshot`)).body.room.revision;
    async function change(action: () => Promise<{ status: number; body: RoomSnapshot }>, fresh: boolean) {
      const count = changes.length;
      const result = await action();
      expect(result.status).toBe(200);
      revision += fresh ? 1 : 0;
      expect(result.body.room.revision).toBe(revision);
      expect(changes.length).toBe(count + (fresh ? 1 : 0));
      if (fresh) expect(changes.at(-1)).toEqual({ roomId, revision });
      return result.body;
    }
    const report = () => rain.post(`${base}/payment/report`);
    const confirm = (id: string, confirmed: boolean) => owner.post(`${base}/payment/${id}/confirm`, { confirmed });
    expect((await change(report, true)).myPayment!.status).toBe("reported");
    await change(report, false);
    await change(() => confirm(rainId, true), true);
    await change(() => confirm(rainId, true), false);
    expect((await change(report, false)).myPayment!.status).toBe("confirmed");
    let summary = (await owner.get(`${base}/summary`)).body;
    expect(summary.people.map((p: { paymentStatus: unknown }) => p.paymentStatus))
      .toEqual([null, "confirmed", "unpaid", null]);
    expect(summary.paymentProgress).toEqual({ paidCount: 1, totalCount: 2, paidTwd: 230, totalTwd: 290 });
    await change(() => confirm(rainId, false), true);
    expect((await rain.get(`${base}/snapshot`)).body.myPayment.status).toBe("reported");
    await change(() => confirm(rainId, false), false);
    await change(() => confirm(lilyId, true), true);
    expect((await lily.get(`${base}/snapshot`)).body.myPayment.status).toBe("confirmed");
    await change(() => confirm(lilyId, false), true);
    expect((await lily.get(`${base}/snapshot`)).body.myPayment.status).toBe("unpaid");
    await change(() => confirm(lilyId, false), false);
    summary = (await owner.get(`${base}/summary`)).body;
    expect(summary.paymentProgress).toEqual({ paidCount: 0, totalCount: 2, paidTwd: 0, totalTwd: 290 });
  });
  it("所有權限與不存在成員錯誤；尚未設定不可傳送", async () => {
    const { owner, roomId, rain, empty, rainId, emptyId, ownerId } = await setup();
    const base = `/api/rooms/${roomId}`;
    await owner.post(`${base}/close`, { requestId: rid() });
    expect((await owner.post(`${base}/payment-info/send`)).body.code).toBe("INVALID_INPUT");
    const revision = (await owner.get(`${base}/snapshot`)).body.room.revision;
    for (const action of [
      () => rain.put(`${base}/payment-info`, info),
      () => rain.post(`${base}/payment-info/send`),
      () => rain.post(`${base}/payment/${rainId}/confirm`, { confirmed: true }),
      () => rain.post(`${base}/payment/${ownerId}/confirm`, { confirmed: true }),
      () => owner.post(`${base}/payment/report`),
      () => empty.post(`${base}/payment/report`),
      () => owner.post(`${base}/payment/${ownerId}/confirm`, { confirmed: true }),
      () => owner.post(`${base}/payment/${emptyId}/confirm`, { confirmed: true }),
    ]) expect(await action()).toMatchObject({ status: 403, body: { code: "NOT_ALLOWED" } });
    expect(await owner.post(`${base}/payment/missing/confirm`, { confirmed: true })).toMatchObject({
      status: 404, body: { code: "INVALID_INPUT", message: "找不到這位成員" },
    });
    expect((await owner.post(`${base}/payment/${rainId}/confirm`, { confirmed: "true" })).status).toBe(400);
    expect((await owner.get(`${base}/snapshot`)).body.room.revision).toBe(revision);
  });
});
