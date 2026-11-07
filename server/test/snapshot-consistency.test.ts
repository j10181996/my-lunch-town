import { describe, expect, it } from "vitest";
import { noopEvents, type Ctx } from "../context";
import { asyncDb, openDb, SAMPLE_SEED } from "../db";
import { changeQuantity, closeRoom, getOwnerSummary } from "../orders/orders";
import { buildSnapshot, createRoom } from "../rooms/rooms";
import { SAMPLE_STORE_IDS } from "./fixtures";

async function openedRoom() {
  const ctx: Ctx = { db: asyncDb(openDb(":memory:", SAMPLE_SEED)), events: noopEvents };
  const { snapshot } = await createRoom(ctx, "owner", { title: "一致性", nickname: "團主", requestId: crypto.randomUUID(), storeIds: SAMPLE_STORE_IDS });
  const roomId = snapshot.room.id;
  await changeQuantity(ctx, "owner", roomId, { mealId: "meal-af-chicken", delta: 1, requestId: crypto.randomUUID() });
  return { ctx, roomId };
}

/** 快照與明細由多次查詢組成；並發的寫入交易在查詢之間提交時，回應仍必須屬於同一個 revision。 */
describe("讀取一致性", () => {
  it("快照與收單並發時，不會同時是收單中又有店家訂單", async () => {
    const { ctx, roomId } = await openedRoom();
    const [snap] = await Promise.all([
      buildSnapshot(ctx.db, roomId, "owner"),
      closeRoom(ctx, "owner", roomId, crypto.randomUUID()),
    ]);
    if (snap.room.status === "open") expect(snap.storeOrders).toEqual([]);
    else expect(snap.storeOrders?.length).toBeGreaterThan(0);
    const now = await buildSnapshot(ctx.db, roomId, "owner");
    expect(snap.room.revision === now.room.revision).toBe(snap.room.status === "closed");
  });

  it("每人明細與收單並發時，狀態與 revision 一致", async () => {
    const { ctx, roomId } = await openedRoom();
    const before = await buildSnapshot(ctx.db, roomId, "owner");
    const [summary] = await Promise.all([
      getOwnerSummary(ctx.db, "owner", roomId),
      closeRoom(ctx, "owner", roomId, crypto.randomUUID()),
    ]);
    expect(summary.revision === before.room.revision).toBe(summary.status === "open");
    // 收單後才需要付款：收單中的明細不會出現付款狀態。
    if (summary.status === "open") expect(summary.people.every((p) => p.paymentStatus === null)).toBe(true);
  });
});
