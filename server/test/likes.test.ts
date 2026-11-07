import { describe, expect, it } from "vitest";
import { openDb, SAMPLE_SEED } from "../db";
import { buildSnapshot, createRoom, joinRoom } from "../rooms/rooms";
import { changeQuantity, closeRoom } from "../orders/orders";
import { likeStore, storeLikes } from "../stores/likes";
import { STORE_LIKES_SCHEMA } from "../stores/likes-schema";
import type { Ctx } from "../context";
import { SAMPLE_STORE_IDS } from "./fixtures";

function fixture() {
  const db = openDb(":memory:", SAMPLE_SEED);
  for (const sid of ["owner-session", "guest-session", "stranger", "shop-session"]) {
    db.prepare("INSERT INTO sessions VALUES (?, ?)").run(sid, Date.now());
  }
  const ctx: Ctx = { db, events: { bubble() {}, roomChanged() {}, storeOrdersChanged() {} } };
  const snap = createRoom(ctx, "owner-session", { title: "按讚測試團", nickname: "團主", requestId: crypto.randomUUID(), storeIds: SAMPLE_STORE_IDS }).snapshot;
  joinRoom(ctx, "guest-session", snap.room.id, { nickname: "團員", avatarId: "avatar-pink" });
  const meal = snap.catalog.meals.find((m) => m.available)!;
  changeQuantity(ctx, "guest-session", snap.room.id, { mealId: meal.id, delta: 1, requestId: crypto.randomUUID() });
  db.prepare("UPDATE stores SET owner_session_id = ? WHERE id = ?").run("shop-session", meal.storeId);
  return { db, ctx, room: snap.room.id, storeId: meal.storeId, otherStoreId: SAMPLE_STORE_IDS.find((id) => id !== meal.storeId)! };
}

describe("給店家按讚", () => {
  it("收單後團員可按讚，重送不重複計數，店家後台看得到", () => {
    const { db, ctx, room, storeId } = fixture();
    try {
      expect(() => likeStore(ctx, "guest-session", room, { storeId })).toThrow("收單後");
      closeRoom(ctx, "owner-session", room, crypto.randomUUID());
      expect(() => likeStore(ctx, "stranger", room, { storeId })).toThrow("請先加入");
      expect(() => likeStore(ctx, "guest-session", room, {})).toThrow("請選擇");
      expect(likeStore(ctx, "guest-session", room, { storeId })).toEqual({ storeId, liked: true });
      likeStore(ctx, "guest-session", room, { storeId });
      likeStore(ctx, "owner-session", room, { storeId });
      expect(buildSnapshot(db, room, "guest-session").likedStoreIds).toEqual([storeId]);
      const likes = storeLikes(db, "shop-session", storeId);
      expect(likes.total).toBe(2);
      expect(likes.last7Days).toBe(2);
      expect(likes.recent).toHaveLength(2);
      expect(likes.recent[0].roomTitle).toBe("按讚測試團");
      expect(JSON.stringify(likes)).not.toMatch(/團員|guest|member/);
      expect(() => storeLikes(db, "guest-session", storeId)).toThrow("不是你的店");
    } finally { db.close(); }
  });

  it("沒接到這團的單或拒單的店不能按讚", () => {
    const { db, ctx, room, storeId, otherStoreId } = fixture();
    try {
      closeRoom(ctx, "owner-session", room, crypto.randomUUID());
      expect(() => likeStore(ctx, "guest-session", room, { storeId: otherStoreId })).toThrow("沒有接到");
      db.prepare("UPDATE store_orders SET status = 'rejected', reject_reason = '缺貨' WHERE room_id = ? AND store_id = ?").run(room, storeId);
      expect(() => likeStore(ctx, "guest-session", room, { storeId })).toThrow("拒單");
    } finally { db.close(); }
  });

  it("近 7 天只算最近一週的讚", () => {
    const { db, ctx, room, storeId } = fixture();
    try {
      closeRoom(ctx, "owner-session", room, crypto.randomUUID());
      likeStore(ctx, "guest-session", room, { storeId });
      db.prepare("UPDATE store_likes SET created_at = ?").run(Date.now() - 8 * 24 * 60 * 60 * 1000);
      expect(storeLikes(db, "shop-session", storeId)).toMatchObject({ total: 1, last7Days: 0 });
    } finally { db.close(); }
  });

  it("遷移可重複執行，不影響已有的讚", () => {
    const { db, ctx, room, storeId } = fixture();
    try {
      closeRoom(ctx, "owner-session", room, crypto.randomUUID());
      likeStore(ctx, "guest-session", room, { storeId });
      db.exec(STORE_LIKES_SCHEMA);
      db.exec(STORE_LIKES_SCHEMA);
      expect(storeLikes(db, "shop-session", storeId).total).toBe(1);
    } finally { db.close(); }
  });
});
