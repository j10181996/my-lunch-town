import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, SAMPLE_SEED } from "../db";
import { createRoom, buildSnapshot } from "../rooms/rooms";
import { setSocial, sendEmote } from "../rooms/social";
import { changeQuantity } from "../orders/orders";
import type { Ctx } from "../context";
import { createTownFriends, friendPose, lifeWalkable } from "../../web/game/town-life";
import { SAMPLE_STORE_IDS } from "./fixtures";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const db = openDb(":memory:", SAMPLE_SEED);
  db.prepare("INSERT INTO sessions VALUES (?, ?)").run("owner-session", Date.now());
  const bubble = vi.fn();
  const ctx: Ctx = { db, events: { bubble, roomChanged() {}, storeOrdersChanged() {} } };
  const snap = createRoom(ctx, "owner-session", { title: "社交測試", nickname: "阿凱", requestId: crypto.randomUUID(), storeIds: SAMPLE_STORE_IDS }).snapshot;
  return { db, ctx, snap, bubble };
}

describe("小鎮社交", () => {
  it("限定團員與固定表情，抑制連點且不改訂單 revision", () => {
    const { db, ctx, snap, bubble } = fixture();
    try {
      const room = snap.room.id;
      expect(() => sendEmote(ctx, "stranger", room, { emote: "wave" })).toThrow("請先加入");
      expect(() => sendEmote(ctx, "owner-session", room, { emote: "<script>" })).toThrow("不支援");
      const result = sendEmote(ctx, "owner-session", room, { emote: "wave", memberId: "other" });
      expect(bubble).toHaveBeenCalledWith(room, snap.me.id, result.text);
      expect(() => sendEmote(ctx, "owner-session", room, { emote: "heart" })).toThrow("慢一點");
      expect(buildSnapshot(db, room, "owner-session").room.revision).toBe(snap.room.revision);
    } finally { db.close(); }
  });

  it("關閉社交後清除泡泡、禁止送表情，點餐仍成功且不廣播餐點；重開可恢復", () => {
    const { db, ctx, snap, bubble } = fixture();
    try {
      const room = snap.room.id;
      setSocial(ctx, "owner-session", room, { enabled: false });
      expect(bubble).toHaveBeenLastCalledWith(room, snap.me.id, "");
      bubble.mockClear();
      expect(() => sendEmote(ctx, "owner-session", room, { emote: "heart" })).toThrow("請先開啟");
      changeQuantity(ctx, "owner-session", room, { mealId: snap.catalog.meals[0].id, delta: 1, requestId: crypto.randomUUID() });
      expect(bubble).not.toHaveBeenCalled();
      const saved = buildSnapshot(db, room, "owner-session");
      expect(saved.socialEnabled).toBe(false);
      expect(saved.myTotalQuantity).toBe(1);
      setSocial(ctx, "owner-session", room, { enabled: true });
      expect(sendEmote(ctx, "owner-session", room, { emote: "heart" }).text).toContain("❤️");
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
