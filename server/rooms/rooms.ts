import { socialEnabled } from "./social-schema";
import type {
  Catalog,
  CreateRoomInput,
  JoinInput,
  Member,
  OrderItem,
  Room,
  RoomPublicInfo,
  RoomSnapshot,
  PaymentInfo,
} from "../../shared/contracts";
import { computeStoreTotals, grandTotals, sortItemsByCatalog, sumItems } from "../../shared/pricing";
import { AVATAR_IDS, lotDoor } from "../../shared/town";
import type { Ctx } from "../context";
import { err, withWriteTx, type Db } from "../db";
import { randomId, requestId as checkRequestId, text } from "../util";
import { roomStoreOrders } from "../orders/storeOrders";

import { paymentStatus } from "./payments";

interface RoomRow {
  payment_json: string | null;
  payment_sent_at: number | null;
  id: string;
  title: string;
  status: "open" | "closed";
  catalog_version: string;
  is_sample: number;
  revision: number;
  delivery_x: number | null;
  delivery_y: number | null;
}
interface MemberRow {
  id: string;
  room_id: string;
  session_id: string;
  nickname: string;
  display_suffix: number;
  avatar_id: string;
  role: "owner" | "participant";
}

export function getRoomRow(db: Db, roomId: string): RoomRow {
  const row = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as RoomRow | undefined;
  if (!row) throw err.roomNotFound();
  return row;
}

export function toRoom(r: RoomRow): Room {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    catalogVersion: r.catalog_version,
    revision: r.revision,
    deliveryPoint: r.delivery_x === null ? null : { x: r.delivery_x, y: r.delivery_y! },
  };
}

function toMember(m: MemberRow): Member {
  return {
    id: m.id,
    roomId: m.room_id,
    nickname: m.display_suffix > 1 ? `${m.nickname}#${m.display_suffix}` : m.nickname,
    avatarId: m.avatar_id,
    role: m.role,
  };
}

export function findMember(db: Db, roomId: string, sessionId: string): Member | null {
  const m = db.prepare("SELECT * FROM members WHERE room_id = ? AND session_id = ?").get(roomId, sessionId) as
    | MemberRow
    | undefined;
  return m ? toMember(m) : null;
}

/** 房間存在且本工作階段是成員；否則 404 / 401。 */
export function requireMember(db: Db, roomId: string, sessionId: string): { room: RoomRow; me: Member } {
  const room = getRoomRow(db, roomId);
  const me = findMember(db, roomId, sessionId);
  if (!me) throw err.session();
  return { room, me };
}

export function listMembers(db: Db, roomId: string): Member[] {
  const rows = db.prepare("SELECT * FROM members WHERE room_id = ? ORDER BY joined_seq").all(roomId) as unknown as MemberRow[];
  return rows.map(toMember);
}

/** 讀取該團凍結的菜單。 */
export function loadCatalog(db: Db, room: RoomRow): Catalog {
  const stores = db
    .prepare("SELECT * FROM room_stores WHERE room_id = ? ORDER BY sort_order")
    .all(room.id) as Array<{
      store_id: string;
      name: string;
      style_key: string;
      lot_index: number;
      door_x: number;
      door_y: number;
      delivery_json: string | null;
    }>;
  const meals = db
    .prepare(
      "SELECT m.* FROM room_meals m JOIN room_stores s ON s.room_id = m.room_id AND s.store_id = m.store_id WHERE m.room_id = ? ORDER BY s.sort_order, m.sort_order",
    )
    .all(room.id) as Array<{ meal_id: string; store_id: string; name: string; price_twd: number; image_key: string; available: number; tags_json: string }>;
  return {
    catalogVersion: room.catalog_version,
    currency: "TWD",
    isSample: room.is_sample === 1,
    stores: stores.map((s) => ({
      id: s.store_id,
      name: s.name,
      sceneId: `shop:${s.store_id}` as const,
      door: { x: s.door_x, y: s.door_y },
      interiorAssetKey: `interior-${s.style_key}`,
      styleKey: s.style_key,
      lotIndex: s.lot_index,
      delivery: s.delivery_json === null ? null : JSON.parse(s.delivery_json),
    })),
    meals: meals.map((m) => ({
      id: m.meal_id,
      storeId: m.store_id,
      name: m.name,
      priceTwd: m.price_twd,
      imageAssetKey: m.image_key,
      available: m.available === 1,
      tags: JSON.parse(m.tags_json) as string[],
    })),
  };
}

export function loadItems(db: Db, roomId: string, memberId?: string): OrderItem[] {
  const rows = (
    memberId
      ? db.prepare("SELECT * FROM order_items WHERE room_id = ? AND member_id = ?").all(roomId, memberId)
      : db.prepare("SELECT * FROM order_items WHERE room_id = ?").all(roomId)
  ) as Array<{ room_id: string; member_id: string; meal_id: string; quantity: number; unit_price_twd: number }>;
  return rows.map((r) => ({
    roomId: r.room_id,
    memberId: r.member_id,
    mealId: r.meal_id,
    quantity: r.quantity,
    unitPriceTwd: r.unit_price_twd,
  }));
}

export function buildSnapshot(db: Db, roomId: string, sessionId: string): RoomSnapshot {
  const { room, me } = requireMember(db, roomId, sessionId);
  const catalog = loadCatalog(db, room);
  const all = loadItems(db, roomId);
  const myItems = sortItemsByCatalog(
    catalog,
    all.filter((i) => i.memberId === me.id),
  );
  const mine = sumItems(myItems);
  const storeTotals = computeStoreTotals(catalog, all);
  const g = grandTotals(storeTotals);
  return {
    payment: room.payment_json && (me.role === "owner" || room.payment_sent_at !== null) ? {
      info: JSON.parse(room.payment_json) as PaymentInfo,
      sentAt: room.payment_sent_at,
      ownerNickname: listMembers(db, roomId).find((m) => m.role === "owner")!.nickname,
    } : null,
    myPayment: room.status === "closed" && me.role !== "owner" && mine.totalTwd > 0 ? {
      amountTwd: mine.totalTwd,
      status: paymentStatus(db, roomId, me.id),
    } : null,
    socialEnabled: socialEnabled(db, me.id),
    room: toRoom(room),
    me,
    members: listMembers(db, roomId).map((m) => ({ id: m.id, nickname: m.nickname, avatarId: m.avatarId })),
    catalog,
    myItems,
    myTotalTwd: mine.totalTwd,
    myTotalQuantity: mine.totalQuantity,
    storeTotals,
    storeOrders: roomStoreOrders(db, roomId),
    totalQuantity: g.totalQuantity,
    totalTwd: g.totalTwd,
  };
}

export function bumpRevision(db: Db, roomId: string): number {
  const row = db.prepare("UPDATE rooms SET revision = revision + 1 WHERE id = ? RETURNING revision").get(roomId) as {
    revision: number;
  };
  return row.revision;
}

function insertMember(db: Db, roomId: string, sessionId: string, nickname: string, avatarId: string, role: Member["role"]) {
  const stats = db
    .prepare(
      "SELECT COUNT(*) AS total, COALESCE(MAX(CASE WHEN nickname = ? THEN display_suffix END), 0) AS maxSuffix FROM members WHERE room_id = ?",
    )
    .get(nickname, roomId) as { total: number; maxSuffix: number };
  const id = `m_${randomId(10)}`;
  db.prepare(
    "INSERT INTO members (id, room_id, session_id, nickname, display_suffix, avatar_id, role, joined_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, roomId, sessionId, nickname, stats.maxSuffix + 1, avatarId, role, stats.total + 1);
  return id;
}

function pickAvatar(db: Db, roomId: string): string {
  const used = db.prepare("SELECT avatar_id FROM members WHERE room_id = ?").all(roomId) as Array<{ avatar_id: string }>;
  const set = new Set(used.map((u) => u.avatar_id));
  return AVATAR_IDS.find((a) => !set.has(a)) ?? AVATAR_IDS[used.length % AVATAR_IDS.length];
}

export function createRoom(ctx: Ctx, sessionId: string, input: CreateRoomInput) {
  const title = text(input?.title, "團名", 1, 20);
  const nickname = text(input?.nickname, "暱稱", 1, 12);
  const reqId = checkRequestId(input?.requestId);
  const point = input?.deliveryPoint;
  if (point !== undefined && (!point || typeof point !== "object"
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    throw err.invalid("送餐地點座標須在 0 至 1 之間");
  }
  // 沒選地點時保留上一版 digest，讓升級前的成功請求仍可重試。
  const avatarId = typeof input?.avatarId === "string" && AVATAR_IDS.includes(input.avatarId) ? input.avatarId : null;
  // 沒選角色時沿用舊 digest，讓舊版前端的重試請求仍然成立。
  const baseDigest = point ? JSON.stringify([title, nickname, [point.x, point.y]]) : `${title}|${nickname}`;
  const digest = avatarId ? JSON.stringify([baseDigest, avatarId]) : baseDigest;
  const { db } = ctx;

  const roomId = withWriteTx(db, () => {
    const prev = db
      .prepare("SELECT payload_digest, result_json FROM processed_requests WHERE scope = 'create-room' AND actor_id = ? AND request_id = ?")
      .get(sessionId, reqId) as { payload_digest: string; result_json: string } | undefined;
    if (prev) {
      if (prev.payload_digest !== digest) throw err.conflict();
      return (JSON.parse(prev.result_json) as { roomId: string }).roomId;
    }

    // 凍結當下所有營業中店家與其供應中餐點
    const stores = db
      .prepare(
        "SELECT s.* FROM stores s WHERE s.status = 'open' AND EXISTS (SELECT 1 FROM meals m WHERE m.store_id = s.id AND m.available = 1) ORDER BY s.lot_index",
      )
      .all() as Array<{
        id: string;
        name: string;
        style_key: string;
        lot_index: number;
        is_sample: number;
        delivery_json: string | null;
      }>;
    if (stores.length === 0) throw err.invalid("小鎮目前沒有營業中的店，請先開店");

    const id = randomId(8);
    const isSample = stores.every((s) => s.is_sample === 1) ? 1 : 0;
    db.prepare(
      `INSERT INTO rooms
        (id, title, status, catalog_version, is_sample, revision, created_at, delivery_x, delivery_y)
        VALUES (?, ?, 'open', ?, ?, 1, ?, ?, ?)`,
    ).run(id, title, `room:${id}`, isSample, Date.now(), point?.x ?? null, point?.y ?? null);

    const insStore = db.prepare(
      `INSERT INTO room_stores
        (room_id, store_id, name, style_key, lot_index, door_x, door_y, sort_order, delivery_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stores.forEach((s, i) => {
      const door = lotDoor(s.lot_index);
      insStore.run(id, s.id, s.name, s.style_key, s.lot_index, door.x, door.y, i, s.delivery_json);
    });
    db.prepare(
      `INSERT INTO room_meals (room_id, meal_id, store_id, name, price_twd, image_key, available, tags_json, sort_order)
       SELECT ?, m.id, m.store_id, m.name, m.price_twd, m.image_key, 1, m.tags_json, m.sort_order
       FROM meals m JOIN stores s ON s.id = m.store_id
       WHERE s.status = 'open' AND m.available = 1`,
    ).run(id);

    insertMember(db, id, sessionId, nickname, avatarId ?? AVATAR_IDS[0], "owner");
    db.prepare(
      "INSERT INTO processed_requests (scope, actor_id, request_id, payload_digest, result_json) VALUES ('create-room', ?, ?, ?, ?)",
    ).run(sessionId, reqId, digest, JSON.stringify({ roomId: id }));
    return id;
  });

  return { invitePath: `/r/${roomId}`, snapshot: buildSnapshot(db, roomId, sessionId) };
}

export function joinRoom(ctx: Ctx, sessionId: string, roomId: string, input: JoinInput): RoomSnapshot {
  const { db } = ctx;
  const existing = (() => {
    getRoomRow(db, roomId);
    return findMember(db, roomId, sessionId);
  })();
  if (existing) return buildSnapshot(db, roomId, sessionId);

  const nickname = text(input?.nickname, "暱稱", 1, 12);
  const requested = typeof input?.avatarId === "string" && AVATAR_IDS.includes(input.avatarId) ? input.avatarId : null;

  const revision = withWriteTx(db, () => {
    const room = getRoomRow(db, roomId);
    if (findMember(db, roomId, sessionId)) return null; // 另一分頁剛加入
    if (room.status === "closed") throw err.closed();
    insertMember(db, roomId, sessionId, nickname, requested ?? pickAvatar(db, roomId), "participant");
    return bumpRevision(db, roomId);
  });
  if (revision !== null) ctx.events.roomChanged(roomId, revision);
  return buildSnapshot(db, roomId, sessionId);
}

export function getPublicInfo(db: Db, roomId: string): RoomPublicInfo {
  const room = getRoomRow(db, roomId);
  const n = db.prepare("SELECT COUNT(*) AS n FROM members WHERE room_id = ?").get(roomId) as { n: number };
  return { id: room.id, title: room.title, status: room.status, memberCount: n.n };
}
