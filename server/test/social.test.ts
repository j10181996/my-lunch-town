import { afterEach, describe, expect, it, vi } from "vitest";
import { asyncDb, openDb, SAMPLE_SEED } from "../db";
import { createRoom, buildSnapshot } from "../rooms/rooms";
import { recommendMeal, setSocial, sendEmote } from "../rooms/social";
import { changeQuantity } from "../orders/orders";
import type { Ctx } from "../context";
import { createTownFriends, friendPose, lifeWalkable } from "../../web/game/town-life";
import { SAMPLE_STORE_IDS } from "./fixtures";

afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const db = openDb(":memory:", SAMPLE_SEED);
  db.prepare("INSERT INTO sessions VALUES (?, ?)").run("owner-session", Date.now());
  const bubble = vi.fn();
  const ctx: Ctx = { db: asyncDb(db), events: { bubble, roomChanged() {}, storeOrdersChanged() {} } };
  const snap = (await createRoom(ctx, "owner-session", { title: "社交測試", nickname: "阿凱", requestId: crypto.randomUUID(), storeIds: SAMPLE_STORE_IDS })).snapshot;
  return { db, ctx, snap, bubble };
}

describe("小鎮社交", () => {
  it("限定團員與固定表情，抑制連點且不改訂單 revision", async () => {
    const { db, ctx, snap, bubble } = await fixture();
    try {
      const room = snap.room.id;
      await expect(sendEmote(ctx, "stranger", room, { emote: "wave" })).rejects.toThrow("請先加入");
      await expect(sendEmote(ctx, "owner-session", room, { emote: "<script>" })).rejects.toThrow("不支援");
      const result = await sendEmote(ctx, "owner-session", room, { emote: "wave", memberId: "other" });
      expect(bubble).toHaveBeenCalledWith(room, snap.me.id, result.text);
      await expect(sendEmote(ctx, "owner-session", room, { emote: "heart" })).rejects.toThrow("慢一點");
      expect((await buildSnapshot(asyncDb(db), room, "owner-session")).room.revision).toBe(snap.room.revision);
    } finally { db.close(); }
  });

  it("關閉社交後清除泡泡、禁止送表情，點餐仍成功且不廣播餐點；重開可恢復", async () => {
    const { db, ctx, snap, bubble } = await fixture();
    try {
      const room = snap.room.id;
      await setSocial(ctx, "owner-session", room, { enabled: false });
      expect(bubble).toHaveBeenLastCalledWith(room, snap.me.id, "");
      bubble.mockClear();
      await expect(sendEmote(ctx, "owner-session", room, { emote: "heart" })).rejects.toThrow("請先開啟");
      await changeQuantity(ctx, "owner-session", room, { mealId: snap.catalog.meals[0].id, delta: 1, requestId: crypto.randomUUID() });
      expect(bubble).not.toHaveBeenCalled();
      const saved = await buildSnapshot(asyncDb(db), room, "owner-session");
      expect(saved.socialEnabled).toBe(false);
      expect(saved.myTotalQuantity).toBe(1);
      await setSocial(ctx, "owner-session", room, { enabled: true });
      expect((await sendEmote(ctx, "owner-session", room, { emote: "heart" })).text).toContain("❤️");
    } finally { db.close(); }
  });
});

describe("推薦給大家", () => {
  it("只能推薦本團菜單上的餐點，和表情共用頻率限制，不改訂單 revision", async () => {
    const { db, ctx, snap, bubble } = await fixture();
    try {
      const room = snap.room.id;
      const meal = snap.catalog.meals.find((m) => m.available)!;
      await expect(recommendMeal(ctx, "stranger", room, { mealId: meal.id })).rejects.toThrow("請先加入");
      await expect(recommendMeal(ctx, "owner-session", room, {})).rejects.toThrow("請選擇");
      await expect(recommendMeal(ctx, "owner-session", room, { mealId: "no-such-meal" })).rejects.toThrow("不在本團");
      const result = await recommendMeal(ctx, "owner-session", room, { mealId: meal.id, text: "任意文字" });
      expect(result.text).toBe(`👍 推薦「${meal.name}」！`);
      expect(bubble).toHaveBeenCalledWith(room, snap.me.id, result.text);
      await expect(sendEmote(ctx, "owner-session", room, { emote: "wave" })).rejects.toThrow("慢一點");
      await expect(recommendMeal(ctx, "owner-session", room, { mealId: meal.id })).rejects.toThrow("慢一點");
      expect((await buildSnapshot(asyncDb(db), room, "owner-session")).room.revision).toBe(snap.room.revision);
    } finally { db.close(); }
  });

  it("關閉社交或已收單時不能推薦", async () => {
    const { db, ctx, snap } = await fixture();
    try {
      const room = snap.room.id;
      const meal = snap.catalog.meals.find((m) => m.available)!;
      await setSocial(ctx, "owner-session", room, { enabled: false });
      await expect(recommendMeal(ctx, "owner-session", room, { mealId: meal.id })).rejects.toThrow("請先開啟");
      await setSocial(ctx, "owner-session", room, { enabled: true });
      db.prepare("UPDATE rooms SET status = 'closed' WHERE id = ?").run(room);
      await expect(recommendMeal(ctx, "owner-session", room, { mealId: meal.id })).rejects.toThrow("已收單");
    } finally { db.close(); }
  });
});

describe("街區散步", () => {
  it("同團不同分頁產生相同路線，整條迴圈避開碰撞、道路與門口", () => {
    const friends = createTownFriends("demo-room");
    expect(friends).toEqual(createTownFriends("demo-room"));
    expect(friends).toHaveLength(6);
    for (const friend of friends) {
      expect(friend.route.length).toBeGreaterThan(2);
      for (let ms = 0; ms < friend.route.length * 1600; ms += 200) {
        const p = friendPose(friend, 1_800_000_000_000 + ms);
        expect(lifeWalkable(p.x, p.y), `${friend.name}: ${p.x},${p.y}`).toBe(true);
        const later = friendPose(friend, 1_800_000_000_000 + ms + 250);
        expect(Math.hypot(p.x - later.x, p.y - later.y)).toBeLessThanOrEqual(8);
      }
    }
  });
});
