import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asyncDb, openDb, SAMPLE_SEED, type RawDb } from "../db";
import { type Ctx, noopEvents } from "../context";
import { buildSnapshot, createRoom, joinRoom } from "../rooms/rooms";
import { changeQuantity, closeRoom } from "../orders/orders";
import { setLunchReady } from "../rooms/party";
import { PARTY_SCHEMA } from "../rooms/party-schema";
import { SAMPLE_STORE_IDS } from "./fixtures";

let ctx: Ctx;
let raw: RawDb;
let roomId: string;
let mealId: string;
let changes: number[];
const order = (sid: string, delta: 1 | -1 = 1, requestId = crypto.randomUUID()) => changeQuantity(ctx, sid, roomId, { mealId, delta, requestId });
const snap = (sid = "owner") => buildSnapshot(ctx.db, roomId, sid);
beforeEach(async () => {
  changes = [];
  raw = openDb(":memory:", SAMPLE_SEED);
  ctx = { db: asyncDb(raw), events: { ...noopEvents, roomChanged: (_, r) => changes.push(r) } };
  const made = await createRoom(ctx, "owner", { title: "午休集合", nickname: "團長", requestId: crypto.randomUUID(), storeIds: SAMPLE_STORE_IDS });
  roomId = made.snapshot.room.id; mealId = made.snapshot.catalog.meals[0].id;
  await joinRoom(ctx, "guest", roomId, { nickname: "夥伴", avatarId: "avatar-pink" });
});
afterEach(() => raw.close());
describe("全團選餐進度", () => {
  it("只有成員可操作，只能確認自己的狀態，必須先有午餐", async () => {
    await expect(setLunchReady(ctx, "stranger", roomId, { ready: true })).rejects.toThrow();
    await expect(setLunchReady(ctx, "owner", roomId, { ready: "yes" })).rejects.toThrow();
    await expect(setLunchReady(ctx, "owner", roomId, { ready: true })).rejects.toThrow("先選一份午餐");
    await order("owner");
    const result = await setLunchReady(ctx, "owner", roomId, { ready: true, memberId: (await snap("guest")).me.id });
    expect(result.lunchParty?.readyMemberIds).toEqual([(await snap()).me.id]);
    expect(result.lunchParty?.celebration).toBeNull();
    expect((await snap("guest")).lunchParty).toEqual(result.lunchParty);
  });
  it("最後一人完成只慶祝一次；重試不增 revision 或重播，合照不含訂單", async () => {
    await order("owner"); await order("guest");
    await setLunchReady(ctx, "owner", roomId, { ready: true });
    const result = await setLunchReady(ctx, "guest", roomId, { ready: true });
    expect(result.lunchParty?.celebration?.id).toBe(1);
    expect(result.lunchParty?.celebration?.members).toHaveLength(2);
    expect(Object.keys(result.lunchParty!.celebration!.members[0]).sort()).toEqual(["avatarId", "id", "nickname"]);
    const count = changes.length;
    const retry = await setLunchReady(ctx, "guest", roomId, { ready: true });
    expect(retry.room.revision).toBe(result.room.revision);
    expect(changes).toHaveLength(count);
    expect(retry.room.status).toBe("open");
    expect(retry.storeOrders).toHaveLength(0);
    expect(retry.totalQuantity).toBe(2);
  });
  it("修改餐點取消完成；重試舊訂單不取消重新確認；再次全員完成產生新一輪", async () => {
    const requestId = crypto.randomUUID();
    await order("owner", 1, requestId); await order("guest");
    await setLunchReady(ctx, "owner", roomId, { ready: true }); await setLunchReady(ctx, "guest", roomId, { ready: true });
    await order("owner", 1, requestId);
    expect((await snap()).lunchParty?.readyMemberIds).toHaveLength(2);
    await order("guest");
    expect((await snap()).lunchParty?.readyMemberIds).toEqual([(await snap()).me.id]);
    expect((await snap()).lunchParty?.celebration?.id).toBe(1);
    await setLunchReady(ctx, "guest", roomId, { ready: true });
    expect((await snap()).lunchParty?.celebration?.id).toBe(2);
    await setLunchReady(ctx, "guest", roomId, { ready: false });
    await order("guest", -1); await order("guest", -1);
    await expect(setLunchReady(ctx, "guest", roomId, { ready: true })).rejects.toThrow();
  });
  it("新增團員重新計入分母，舊合照保留；收單後不能改完成狀態", async () => {
    await order("owner"); await order("guest");
    await setLunchReady(ctx, "owner", roomId, { ready: true }); await setLunchReady(ctx, "guest", roomId, { ready: true });
    await joinRoom(ctx, "new", roomId, { nickname: "新朋友", avatarId: "avatar-green" });
    expect((await snap()).members).toHaveLength(3);
    expect((await snap()).lunchParty?.readyMemberIds).toHaveLength(2);
    expect((await snap()).lunchParty?.celebration?.members).toHaveLength(2);
    await order("new"); await setLunchReady(ctx, "new", roomId, { ready: true });
    expect((await snap()).lunchParty?.celebration).toMatchObject({ id: 2, members: expect.any(Array) });
    expect((await snap()).lunchParty?.celebration?.members).toHaveLength(3);
    await closeRoom(ctx, "owner", roomId, crypto.randomUUID());
    await expect(setLunchReady(ctx, "guest", roomId, { ready: false })).rejects.toThrow();
  });
  it("舊資料庫補建 schema 可重跑，不改訂單或完成紀錄", async () => {
    await order("owner"); await setLunchReady(ctx, "owner", roomId, { ready: true });
    raw.exec(PARTY_SCHEMA); raw.exec(PARTY_SCHEMA);
    expect((await snap()).lunchParty?.readyMemberIds).toHaveLength(1);
    expect((await snap()).totalQuantity).toBe(1);
  });
});
