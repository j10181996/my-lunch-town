import type { RoomStoreOrder, StoreOrder, StoreOrderStatus, UpdateStoreOrderInput } from "../../shared/contracts";
import { evaluateStoreDelivery, fulfillmentOf, storeDistanceKm } from "../../shared/delivery";
import { computeStoreTotals, sortItemsByCatalog, sumItems } from "../../shared/pricing";
import { optionLabel } from "../../shared/meal-options";
import type { Ctx } from "../context";
import { AppError, err, withWriteTx, type Db } from "../db";
import { bumpRevision, getRoomRow, listMembers, loadCatalog, loadItems, toRoom } from "../rooms/rooms";
import { requireOwner } from "../stores/stores";
import { oneOf, randomId, text } from "../util";

interface OrderRow {
  id: string;
  room_id: string;
  store_id: string;
  store_name: string;
  room_title: string;
  owner_nickname: string;
  status: StoreOrderStatus;
  reject_reason: string | null;
  items_json: string;
  people_json: string;
  total_quantity: number;
  total_twd: number;
  created_at: number;
  updated_at: number;
  fulfillment: "delivery" | "pickup";
  distance_km: number | null;
  delivery_min_twd: number | null;
  delivery_address: string | null;
}

function toOrder(r: OrderRow): StoreOrder {
  return {
    id: r.id,
    roomId: r.room_id,
    storeId: r.store_id,
    storeName: r.store_name,
    roomTitle: r.room_title,
    ownerNickname: r.owner_nickname,
    status: r.status,
    rejectReason: r.reject_reason,
    items: JSON.parse(r.items_json),
    people: JSON.parse(r.people_json),
    totalQuantity: r.total_quantity,
    totalTwd: r.total_twd,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    fulfillment: r.fulfillment,
    distanceKm: r.distance_km,
    deliveryMinTwd: r.delivery_min_twd,
    deliveryAddress: r.delivery_address ?? null,
  };
}

/** 僅由 closeRoom 在 open → closed 的同一寫入交易內呼叫。 */
export async function createStoreOrders(db: Db, roomId: string, ownerNickname: string): Promise<string[]> {
  const room = await getRoomRow(db, roomId);
  const place = toRoom(room);
  const catalog = await loadCatalog(db, room);
  const items = await loadItems(db, roomId);
  const members = await listMembers(db, roomId);
  const totals = computeStoreTotals(catalog, items).filter((s) => s.totalQuantity > 0);
  const now = Date.now();
  const insert = db.prepare(`INSERT INTO store_orders
    (id, room_id, store_id, store_name, room_title, owner_nickname, status, items_json,
     people_json, total_quantity, total_twd, created_at, updated_at, fulfillment, distance_km, delivery_min_twd,
     delivery_address)
    VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const store of totals) {
    const frozen = catalog.stores.find((s) => s.id === store.storeId)!;
    const km = storeDistanceKm(place, frozen);
    const delivery = evaluateStoreDelivery(place, frozen, store.totalTwd);
    const mealIds = new Set(store.meals.map((m) => m.mealId));
    const people = members.flatMap((member) => {
      const mine = sortItemsByCatalog(
        catalog,
        items.filter((i) => i.memberId === member.id && mealIds.has(i.mealId)),
      );
      if (mine.length === 0) return [];
      return [
        {
          nickname: member.nickname,
          totalTwd: sumItems(mine).totalTwd,
          items: mine.map((i) => {
            const meal = catalog.meals.find((m) => m.id === i.mealId)!;
            const options = optionLabel(meal.options, i.choiceIds);
            // 選項與備註只在有值時寫入，沒有選項的快照與升級前相同。
            return {
              name: meal.name,
              quantity: i.quantity,
              ...(options ? { options } : {}),
              ...(i.note ? { note: i.note } : {}),
            };
          }),
        },
      ];
    });
    await insert.bind(
      `so_${randomId(10)}`,
      roomId,
      store.storeId,
      store.name,
      room.title,
      ownerNickname,
      JSON.stringify(store.meals),
      JSON.stringify(people),
      store.totalQuantity,
      store.totalTwd,
      now,
      now,
      fulfillmentOf(delivery),
      km,
      delivery.kind === "ok" || delivery.kind === "below-min" ? delivery.minTwd : null,
      // 地址屬個資：只交給要外送的店家，自取單不帶。
      fulfillmentOf(delivery) === "delivery" ? room.delivery_address ?? null : null,
    ).run();
  }
  return totals.map((s) => s.storeId);
}

export async function roomStoreOrders(db: Db, roomId: string): Promise<RoomStoreOrder[]> {
  const { results } = await db
    .prepare(
      `SELECT store_id AS storeId, store_name AS storeName, status,
    reject_reason AS rejectReason, total_quantity AS totalQuantity, total_twd AS totalTwd,
    updated_at AS updatedAt, fulfillment, distance_km AS distanceKm,
    delivery_min_twd AS deliveryMinTwd FROM store_orders WHERE room_id = ? ORDER BY rowid`,
    )
    .bind(roomId).all<RoomStoreOrder>();
  return results;
}

export async function listStoreOrders(db: Db, sessionId: string, storeId: string): Promise<StoreOrder[]> {
  await requireOwner(db, sessionId, storeId);
  const { results } = await db
    .prepare("SELECT * FROM store_orders WHERE store_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50")
    .bind(storeId).all<OrderRow>();
  return results.map(toOrder);
}

const transitions: Record<StoreOrderStatus, StoreOrderStatus[]> = {
  sent: ["accepted", "rejected"],
  accepted: ["preparing", "ready"],
  preparing: ["ready"],
  ready: [],
  rejected: [],
};
const labels: Record<StoreOrderStatus, string> = {
  sent: "已送出",
  accepted: "已接單",
  preparing: "製作中",
  ready: "可取餐",
  rejected: "已拒單",
};

export async function updateStoreOrderStatus(
  ctx: Ctx,
  sessionId: string,
  storeId: string,
  orderId: string,
  input: UpdateStoreOrderInput,
): Promise<StoreOrder> {
  const { db } = ctx;
  const { order, revision } = await withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    const row = await db.prepare("SELECT * FROM store_orders WHERE id = ? AND store_id = ?").bind(orderId, storeId).first<OrderRow>();
    if (!row) throw new AppError("INVALID_INPUT", 404, "找不到這筆訂單");
    const next = oneOf(input?.status, "訂單狀態", Object.keys(transitions) as StoreOrderStatus[]);
    if (next === row.status) return { order: toOrder(row), revision: null };
    if (!transitions[row.status].includes(next)) {
      throw err.invalid(`訂單狀態無法從 ${labels[row.status]} 變成 ${labels[next]}`);
    }
    const reason = next === "rejected" ? text(input?.reason, "拒單原因", 1, 40) : null;
    const now = Date.now();
    await db.prepare("UPDATE store_orders SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?")
      .bind(next, reason, now, orderId).run();
    const order = toOrder({ ...row, status: next, reject_reason: reason, updated_at: now });
    return { order, revision: await bumpRevision(db, row.room_id) };
  });
  if (revision !== null) {
    ctx.events.roomChanged(order.roomId, revision);
    ctx.events.storeOrdersChanged(storeId);
  }
  return order;
}
