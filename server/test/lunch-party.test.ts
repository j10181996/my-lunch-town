import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, SAMPLE_SEED } from "../db";
import { type Ctx, noopEvents } from "../context";
import { buildSnapshot, createRoom, joinRoom } from "../rooms/rooms";
import { changeQuantity, closeRoom } from "../orders/orders";
import { setLunchReady } from "../rooms/party";
import { PARTY_SCHEMA } from "../rooms/party-schema";

let ctx: Ctx;
let roomId: string;
let mealId: string;
let changes: number[];
const order = (sid: string, delta: 1 | -1 = 1, requestId = crypto.randomUUID()) => changeQuantity(ctx, sid, roomId, { mealId, delta, requestId });
const snap = (sid = "owner") => buildSnapshot(ctx.db, roomId, sid);
beforeEach(() => {
  changes = [];
  ctx = { db: openDb(":memory:", SAMPLE_SEED), events: { ...noopEvents, roomChanged: (_, r) => changes.push(r) } };
  const made = createRoom(ctx, "owner", { title: "午休集合", nickname: "團長", requestId: crypto.randomUUID() });
  roomId = made.snapshot.room.id; mealId = made.snapshot.catalog.meals[0].id;
  joinRoom(ctx, "guest", roomId, { nickname: "夥伴", avatarId: "avatar-pink" });
});
afterEach(() => ctx.db.close());
describe("全團選餐進度", () => {
  it("只有成員可操作，只能確認自己的狀態，必須先有午餐", () => {
    expect(() => setLunchReady(ctx, "stranger", roomId, { ready: true })).toThrow();
    expect(() => setLunchReady(ctx, "owner", roomId, { ready: "yes" })).toThrow();
    expect(() => setLunchReady(ctx, "owner", roomId, { ready: true })).toThrow("先選一份午餐");
    order("owner");
    const result = setLunchReady(ctx, "owner", roomId, { ready: true, memberId: snap("guest").me.id });
    expect(result.lunchParty?.readyMemberIds).toEqual([snap().me.id]);
    expect(result.lunchParty?.celebration).toBeNull();
    expect(snap("guest").lunchParty).toEqual(result.lunchParty);
  });
  it("最後一人完成只慶祝一次；重試不增 revision 或重播，合照不含訂單", () => {
    order("owner"); order("guest");
    setLunchReady(ctx, "owner", roomId, { ready: true });
    const result = setLunchReady(ctx, "guest", roomId, { ready: true });
    expect(result.lunchParty?.celebration?.id).toBe(1);
    expect(result.lunchParty?.celebration?.members).toHaveLength(2);
    expect(Object.keys(result.lunchParty!.celebration!.members[0]).sort()).toEqual(["avatarId", "id", "nickname"]);
    const count = changes.length;
    const retry = setLunchReady(ctx, "guest", roomId, { ready: true });
    expect(retry.room.revision).toBe(result.room.revision);
    expect(changes).toHaveLength(count);
    expect(retry.room.status).toBe("open");
    expect(retry.storeOrders).toHaveLength(0);
    expect(retry.totalQuantity).toBe(2);
  });
  it("修改餐點取消完成；重試舊訂單不取消重新確認；再次全員完成產生新一輪", () => {
    const requestId = crypto.randomUUID();
    order("owner", 1, requestId); order("guest");
    setLunchReady(ctx, "owner", roomId, { ready: true }); setLunchReady(ctx, "guest", roomId, { ready: true });
    order("owner", 1, requestId);
    expect(snap().lunchParty?.readyMemberIds).toHaveLength(2);
    order("guest");
    expect(snap().lunchParty?.readyMemberIds).toEqual([snap().me.id]);
    expect(snap().lunchParty?.celebration?.id).toBe(1);
    setLunchReady(ctx, "guest", roomId, { ready: true });
    expect(snap().lunchParty?.celebration?.id).toBe(2);
    setLunchReady(ctx, "guest", roomId, { ready: false });
    order("guest", -1); order("guest", -1);
    expect(() => setLunchReady(ctx, "guest", roomId, { ready: true })).toThrow();
  });
  it("新增團員重新計入分母，舊合照保留；收單後不能改完成狀態", () => {
    order("owner"); order("guest");
    setLunchReady(ctx, "owner", roomId, { ready: true }); setLunchReady(ctx, "guest", roomId, { ready: true });
    joinRoom(ctx, "new", roomId, { nickname: "新朋友", avatarId: "avatar-green" });
    expect(snap().members).toHaveLength(3);
    expect(snap().lunchParty?.readyMemberIds).toHaveLength(2);
    expect(snap().lunchParty?.celebration?.members).toHaveLength(2);
    order("new"); setLunchReady(ctx, "new", roomId, { ready: true });
    expect(snap().lunchParty?.celebration).toMatchObject({ id: 2, members: expect.any(Array) });
    expect(snap().lunchParty?.celebration?.members).toHaveLength(3);
    closeRoom(ctx, "owner", roomId, crypto.randomUUID());
    expect(() => setLunchReady(ctx, "guest", roomId, { ready: false })).toThrow();
  });
  it("舊資料庫補建 schema 可重跑，不改訂單或完成紀錄", () => {
    order("owner"); setLunchReady(ctx, "owner", roomId, { ready: true });
    ctx.db.exec(PARTY_SCHEMA); ctx.db.exec(PARTY_SCHEMA);
    expect(snap().lunchParty?.readyMemberIds).toHaveLength(1);
    expect(snap().totalQuantity).toBe(1);
  });
});
