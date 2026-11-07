import { socialEnabled } from "../rooms/social-schema";
import type { OrderAck, OrderDeltaInput, OwnerSummary, RoomSnapshot } from "../../shared/contracts";
import { buildExportText, computeStoreTotals, grandTotals, sortItemsByCatalog, sumItems } from "../../shared/pricing";
import { MAX_QTY_PER_MEAL } from "../../shared/town";
import type { Ctx } from "../context";
import { err, withWriteTx, type Db } from "../db";
import { buildSnapshot, bumpRevision, getRoomRow, listMembers, loadCatalog, loadItems, requireMember } from "../rooms/rooms";
import { paymentStatus } from "../rooms/payments";
import { createStoreOrders } from "./storeOrders";
import { requestId as checkRequestId } from "../util";

/**
 * 規格第 10 節：一次 +1/-1 的交易。
 * 順序：身分 → 進入寫入交易 → 去重（早於收單檢查）→ 房間/餐點/delta 驗證 → 計算 → 寫入並遞增 revision → 提交後通知。
 */
export function changeQuantity(ctx: Ctx, sessionId: string, roomId: string, input: OrderDeltaInput): OrderAck {
  const { db } = ctx;
  const reqId = checkRequestId(input?.requestId);
  requireMember(db, roomId, sessionId);
  const digest = `${String(input?.mealId)}|${String(input?.delta)}`;

  let bubbleText: string | null = null;
  let memberId = "";
  const { ack, fresh } = withWriteTx(db, () => {
    const { room, me } = requireMember(db, roomId, sessionId);
    memberId = me.id;

    const prev = db
      .prepare("SELECT payload_digest, result_json FROM processed_requests WHERE scope = 'order' AND actor_id = ? AND request_id = ?")
      .get(me.id, reqId) as { payload_digest: string; result_json: string } | undefined;
    if (prev) {
      if (prev.payload_digest !== digest) throw err.conflict();
      return { ack: JSON.parse(prev.result_json) as OrderAck, fresh: false };
    }

    if (room.status !== "open") throw err.closed();
    if (typeof input.mealId !== "string") throw err.invalid("缺少餐點");
    if (input.delta !== 1 && input.delta !== -1) throw err.invalid("數量變化只能是 +1 或 -1");
    const meal = db
      .prepare("SELECT name, price_twd, available FROM room_meals WHERE room_id = ? AND meal_id = ?")
      .get(roomId, input.mealId) as { name: string; price_twd: number; available: number } | undefined;
    if (!meal) throw err.mealNotFound();

    const cur = db
      .prepare("SELECT quantity FROM order_items WHERE room_id = ? AND member_id = ? AND meal_id = ?")
      .get(roomId, me.id, input.mealId) as { quantity: number } | undefined;
    const before = cur?.quantity ?? 0;
    const after = before + input.delta;
    if (input.delta === 1 && meal.available !== 1) throw err.invalid("這個餐點目前不供應");
    if (after < 0) throw err.invalid("數量已經是零");
    if (after > MAX_QTY_PER_MEAL) throw err.invalid(`同一餐點每人最多 ${MAX_QTY_PER_MEAL} 份`);

    if (after === 0) {
      db.prepare("DELETE FROM order_items WHERE room_id = ? AND member_id = ? AND meal_id = ?").run(roomId, me.id, input.mealId);
    } else if (before === 0) {
      db.prepare(
        "INSERT INTO order_items (room_id, member_id, meal_id, quantity, unit_price_twd) VALUES (?, ?, ?, ?, ?)",
      ).run(roomId, me.id, input.mealId, after, meal.price_twd);
    } else {
      db.prepare("UPDATE order_items SET quantity = ? WHERE room_id = ? AND member_id = ? AND meal_id = ?").run(
        after,
        roomId,
        me.id,
        input.mealId,
      );
    }
    // 改餐後需要重新確認；相同 requestId 的重試已在上方返回。
    db.prepare("DELETE FROM member_ready WHERE member_id = ?").run(me.id);
    const revision = bumpRevision(db, roomId);
    const myTotalTwd = sumItems(loadItems(db, roomId, me.id)).totalTwd;
    const result: OrderAck = { requestId: reqId, mealId: input.mealId, quantity: after, myTotalTwd, revision };
    db.prepare(
      "INSERT INTO processed_requests (scope, actor_id, request_id, payload_digest, result_json) VALUES ('order', ?, ?, ?, ?)",
    ).run(me.id, reqId, digest, JSON.stringify(result));
    if (input.delta === 1) bubbleText = `${meal.name} +1！`;
    return { ack: result, fresh: true };
  });

  if (fresh) {
    ctx.events.roomChanged(roomId, ack.revision);
    if (bubbleText && socialEnabled(db, memberId)) ctx.events.bubble(roomId, memberId, bubbleText);
  }
  return ack;
}

export function closeRoom(ctx: Ctx, sessionId: string, roomId: string, rawRequestId: unknown): RoomSnapshot {
  const { db } = ctx;
  checkRequestId(rawRequestId);
  let sentStoreIds: string[] = [];
  const revision = withWriteTx(db, () => {
    const { room, me } = requireMember(db, roomId, sessionId);
    if (me.role !== "owner") throw err.notAllowed("只有揪團者可以收單");
    if (room.status === "closed") return null; // 已收單重試：回目前結果
    db.prepare("UPDATE rooms SET status = 'closed', closed_at = ? WHERE id = ?").run(Date.now(), roomId);
    sentStoreIds = createStoreOrders(db, roomId, me.nickname);
    return bumpRevision(db, roomId);
  });
  if (revision !== null) {
    ctx.events.roomChanged(roomId, revision);
    sentStoreIds.forEach((id) => ctx.events.storeOrdersChanged(id));
  }
  return buildSnapshot(db, roomId, sessionId);
}

export function getOwnerSummary(db: Db, sessionId: string, roomId: string): OwnerSummary {
  const { me } = requireMember(db, roomId, sessionId);
  if (me.role !== "owner") throw err.notAllowed("只有揪團者可以查看每人明細");
  return buildSummary(db, roomId);
}

function buildSummary(db: Db, roomId: string): OwnerSummary {
  const room = getRoomRow(db, roomId);
  const catalog = loadCatalog(db, room);
  const items = loadItems(db, roomId);
  const stores = computeStoreTotals(catalog, items);
  const people = listMembers(db, roomId).map((m) => {
    const mine = sortItemsByCatalog(
      catalog,
      items.filter((i) => i.memberId === m.id),
    );
    const totals = sumItems(mine);
    return {
      memberId: m.id,
      nickname: m.nickname,
      items: mine,
      ...totals,
      paymentStatus: room.status === "closed" && m.role !== "owner" && totals.totalTwd > 0
        ? paymentStatus(db, roomId, m.id) : null,
    };
  });
  const payable = people.filter((p) => p.paymentStatus !== null);
  const paid = payable.filter((p) => p.paymentStatus === "confirmed");
  const paymentProgress = {
    paidCount: paid.length,
    totalCount: payable.length,
    paidTwd: paid.reduce((sum, p) => sum + p.totalTwd, 0),
    totalTwd: payable.reduce((sum, p) => sum + p.totalTwd, 0),
  };
  return {
    roomId,
    status: room.status,
    revision: room.revision,
    stores,
    people,
    paymentProgress,
    ...grandTotals(stores),
  };
}

/** 僅收單後輸出；讀取已鎖定的資料庫內容，不使用畫面暫存。 */
export function exportOrder(db: Db, sessionId: string, roomId: string): string {
  const { room, me } = requireMember(db, roomId, sessionId);
  if (me.role !== "owner") throw err.notAllowed("只有揪團者可以匯出");
  if (room.status !== "closed") throw err.invalid("請先收單再匯出");
  const summary = buildSummary(db, roomId);
  return buildExportText(room.title, loadCatalog(db, room), summary.stores, summary.people);
}
