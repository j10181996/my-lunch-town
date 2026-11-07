import { lunchParty } from "./party";
import { storeOpening } from "../../shared/store-hours";
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
  StreetStore,
  PaymentInfo,
} from "../../shared/contracts";
import { DELIVERY_ADDRESS_MAX, type GeoPoint } from "../../shared/contracts";
import { validateGeoPoint } from "../../shared/geo";
import { computeStoreTotals, grandTotals, sortItemsByCatalog, sumItems } from "../../shared/pricing";
import { choiceIdsOf, lineKeyOf, parseOptionGroups } from "../../shared/meal-options";
import { AVATAR_IDS, LOTS, lotDoor } from "../../shared/town";
import type { Ctx } from "../context";
import { err, withWriteTx, type Db } from "../db";
import { randomId, requestId as checkRequestId, text } from "../util";
import { roomStoreOrders } from "../orders/storeOrders";
import { likedStoreIds } from "../stores/likes-schema";

import { paymentRemindedAt, paymentStatus } from "./payments";
import { deadlinePassed, parseDeadline } from "./deadline";

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
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_address: string | null;
  deadline_at?: number | null;
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

export async function getRoomRow(db: Db, roomId: string): Promise<RoomRow> {
  const row = await db.prepare("SELECT * FROM rooms WHERE id = ?").bind(roomId).first<RoomRow>();
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
    deliveryLocation: r.delivery_lat == null ? null : { lat: r.delivery_lat, lng: r.delivery_lng! },
    deliveryAddress: r.delivery_address ?? null,
    deadlineAt: r.deadline_at ?? null,
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

export async function findMember(db: Db, roomId: string, sessionId: string): Promise<Member | null> {
  const m = await db.prepare("SELECT * FROM members WHERE room_id = ? AND session_id = ?").bind(roomId, sessionId).first<MemberRow>();
  return m ? toMember(m) : null;
}

/** 房間存在且本工作階段是成員；否則 404 / 401。 */
export async function requireMember(db: Db, roomId: string, sessionId: string): Promise<{ room: RoomRow; me: Member }> {
  const room = await getRoomRow(db, roomId);
  const me = await findMember(db, roomId, sessionId);
  if (!me) throw err.session();
  return { room, me };
}

export async function listMembers(db: Db, roomId: string): Promise<Member[]> {
  const { results } = await db.prepare("SELECT * FROM members WHERE room_id = ? ORDER BY joined_seq").bind(roomId).all<MemberRow>();
  return results.map(toMember);
}

/** 讀取該團凍結的菜單。 */
export async function loadCatalog(db: Db, room: RoomRow): Promise<Catalog> {
  const { results: stores } = await db
    .prepare("SELECT rs.*, (SELECT address FROM stores WHERE id = rs.store_id) AS address FROM room_stores rs WHERE room_id = ? ORDER BY sort_order")
    .bind(room.id).all<{
      store_id: string;
      address: string | null;
      name: string;
      style_key: string;
      lot_index: number;
      door_x: number;
      door_y: number;
      delivery_json: string | null;
      lat: number | null;
      lng: number | null;
      hours_json?: string | null;
      order_deadline_at?: number | null;
    }>();
  const { results: meals } = await db
    .prepare(
      "SELECT m.* FROM room_meals m JOIN room_stores s ON s.room_id = m.room_id AND s.store_id = m.store_id WHERE m.room_id = ? ORDER BY s.sort_order, m.sort_order",
    )
    .bind(room.id).all<{ meal_id: string; store_id: string; name: string; price_twd: number; image_key: string; available: number; tags_json: string; options_json: string | null }>();
  return {
    catalogVersion: room.catalog_version,
    currency: "TWD",
    isSample: room.is_sample === 1,
    stores: stores.map((s) => ({
      id: s.store_id,
      address: s.address ?? undefined,
      name: s.name,
      sceneId: `shop:${s.store_id}` as const,
      door: { x: s.door_x, y: s.door_y },
      interiorAssetKey: `interior-${s.style_key}`,
      styleKey: s.style_key,
      lotIndex: s.lot_index,
      orderDeadlineAt: s.order_deadline_at ?? null,
      delivery: s.delivery_json === null ? null : JSON.parse(s.delivery_json),
      location: s.lat == null ? null : { lat: s.lat, lng: s.lng! },
    })),
    meals: meals.map((m) => ({
      id: m.meal_id,
      storeId: m.store_id,
      name: m.name,
      priceTwd: m.price_twd,
      imageAssetKey: m.image_key,
      available: m.available === 1,
      tags: JSON.parse(m.tags_json) as string[],
      options: parseOptionGroups(m.options_json),
    })),
  };
}

export async function loadItems(db: Db, roomId: string, memberId?: string): Promise<OrderItem[]> {
  type ItemRow = { room_id: string; member_id: string; meal_id: string; option_key: string; note: string; quantity: number; unit_price_twd: number };
  const { results: rows } = await (memberId
    ? db.prepare("SELECT * FROM order_items WHERE room_id = ? AND member_id = ?").bind(roomId, memberId)
    : db.prepare("SELECT * FROM order_items WHERE room_id = ?").bind(roomId)
  ).all<ItemRow>();
  return rows.map((r) => {
    const choiceIds = choiceIdsOf(r.option_key);
    return {
      roomId: r.room_id,
      memberId: r.member_id,
      mealId: r.meal_id,
      quantity: r.quantity,
      unitPriceTwd: r.unit_price_twd,
      choiceIds,
      note: r.note,
      lineKey: lineKeyOf(r.meal_id, choiceIds, r.note),
    };
  });
}

/** 街上目前其他店面與其供應中餐點；本團店家佔用的店面格以凍結資料為準。 */
async function streetStores(db: Db, catalog: Catalog): Promise<StreetStore[]> {
  const taken = new Set(catalog.stores.map((s) => s.lotIndex));
  const ids = new Set(catalog.stores.map((s) => s.id));
  const { results: rows } = await db.prepare("SELECT id, name, style_key, lot_index FROM stores ORDER BY lot_index")
    .all<{ id: string; name: string; style_key: string; lot_index: number }>();
  const others = rows.filter((r) => !ids.has(r.id) && !taken.has(r.lot_index));
  const shown = new Set(others.map((r) => r.id));
  const meals = (await db
    .prepare("SELECT id, store_id, name, price_twd, image_key, tags_json, options_json FROM meals WHERE available = 1 ORDER BY sort_order, id")
    .all<{ id: string; store_id: string; name: string; price_twd: number; image_key: string; tags_json: string; options_json: string | null }>())
    .results.filter((m) => shown.has(m.store_id));
  return others.map((r) => ({
    id: r.id,
    name: r.name,
    styleKey: r.style_key,
    lotIndex: r.lot_index,
    // 只供進店瀏覽，不在本團的餐點仍無法下單（order 只認 room_meals）。
    meals: meals.filter((m) => m.store_id === r.id).map((m) => ({
      id: m.id,
      storeId: m.store_id,
      name: m.name,
      priceTwd: m.price_twd,
      imageAssetKey: m.image_key,
      available: true,
      tags: JSON.parse(m.tags_json) as string[],
      options: parseOptionGroups(m.options_json),
    })),
  }));
}

async function myPayment(db: Db, roomId: string, memberId: string, amountTwd: number) {
  const status = await paymentStatus(db, roomId, memberId);
  return { amountTwd, status, remindedAt: status === "unpaid" ? await paymentRemindedAt(db, roomId) : null };
}

export async function buildSnapshot(db: Db, roomId: string, sessionId: string): Promise<RoomSnapshot> {
  const { room, me } = await requireMember(db, roomId, sessionId);
  const catalog = await loadCatalog(db, room);
  const all = await loadItems(db, roomId);
  const myItems = sortItemsByCatalog(
    catalog,
    all.filter((i) => i.memberId === me.id),
  );
  const mine = sumItems(myItems);
  const storeTotals = computeStoreTotals(catalog, all);
  const g = grandTotals(storeTotals);
  const members = await listMembers(db, roomId);
  return {
    payment: room.payment_json && (me.role === "owner" || room.payment_sent_at !== null) ? {
      info: JSON.parse(room.payment_json) as PaymentInfo,
      sentAt: room.payment_sent_at,
      ownerNickname: members.find((m) => m.role === "owner")!.nickname,
      ...(me.role === "owner" ? { remindedAt: await paymentRemindedAt(db, roomId) } : {}),
    } : null,
    myPayment: room.status === "closed" && me.role !== "owner" && mine.totalTwd > 0
      ? await myPayment(db, roomId, me.id, mine.totalTwd) : null,
    lunchParty: await lunchParty(db, roomId),
    socialEnabled: await socialEnabled(db, me.id),
    streetStores: await streetStores(db, catalog),
    room: toRoom(room),
    me,
    members: members.map((m) => ({ id: m.id, nickname: m.nickname, avatarId: m.avatarId, role: m.role })),
    catalog,
    myItems,
    myTotalTwd: mine.totalTwd,
    myTotalQuantity: mine.totalQuantity,
    storeTotals,
    storeOrders: await roomStoreOrders(db, roomId),
    likedStoreIds: await likedStoreIds(db, roomId, me.id),
    totalQuantity: g.totalQuantity,
    totalTwd: g.totalTwd,
  };
}

export async function bumpRevision(db: Db, roomId: string): Promise<number> {
  const row = await db.prepare("UPDATE rooms SET revision = revision + 1 WHERE id = ? RETURNING revision").bind(roomId).first<{ revision: number }>();
  return row!.revision;
}

async function insertMember(db: Db, roomId: string, sessionId: string, nickname: string, avatarId: string, role: Member["role"]) {
  const stats = (await db
    .prepare(
      "SELECT COUNT(*) AS total, COALESCE(MAX(CASE WHEN nickname = ? THEN display_suffix END), 0) AS maxSuffix FROM members WHERE room_id = ?",
    )
    .bind(nickname, roomId).first<{ total: number; maxSuffix: number }>())!;
  const id = `m_${randomId(10)}`;
  await db.prepare(
    "INSERT INTO members (id, room_id, session_id, nickname, display_suffix, avatar_id, role, joined_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, roomId, sessionId, nickname, stats.maxSuffix + 1, avatarId, role, stats.total + 1).run();
  return id;
}

async function pickAvatar(db: Db, roomId: string): Promise<string> {
  const { results: used } = await db.prepare("SELECT avatar_id FROM members WHERE room_id = ?").bind(roomId).all<{ avatar_id: string }>();
  const set = new Set(used.map((u) => u.avatar_id));
  return AVATAR_IDS.find((a) => !set.has(a)) ?? AVATAR_IDS[used.length % AVATAR_IDS.length];
}

/** 選店數依小鎮地段上限；排序後納入 digest，勾選順序不同視為同一請求。 */
const MAX_ROOM_STORES = LOTS.length;
function parseStoreIds(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) throw err.invalid("請至少選一家店");
  if (value.length > MAX_ROOM_STORES * 2 || value.some((v) => typeof v !== "string" || !/^[\w-]{1,40}$/.test(v))) {
    throw err.invalid("店家格式錯誤");
  }
  const ids = [...new Set(value as string[])].sort();
  if (ids.length > MAX_ROOM_STORES) throw err.invalid(`一團最多選 ${MAX_ROOM_STORES} 家店`);
  return ids;
}

/** 選填：去除前後空白，空字串視為未填。 */
function parseDeliveryAddress(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw err.invalid("送餐地址必須是文字");
  const v = value.trim();
  if ([...v].length > DELIVERY_ADDRESS_MAX) throw err.invalid(`送餐地址最多 ${DELIVERY_ADDRESS_MAX} 個字`);
  return v || null;
}

export async function createRoom(ctx: Ctx, sessionId: string, input: CreateRoomInput) {
  const title = text(input?.title, "團名", 1, 20);
  const nickname = text(input?.nickname, "暱稱", 1, 12);
  const reqId = checkRequestId(input?.requestId);
  const point = input?.deliveryPoint;
  if (point !== undefined && (!point || typeof point !== "object"
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    throw err.invalid("送餐地點座標須在 0 至 1 之間");
  }
  // 新版前端送真實經緯度；deliveryPoint 只為了讓舊版前端的請求與重試仍成立。
  let location: GeoPoint | null = null;
  if (input?.deliveryLocation !== undefined) {
    try { location = validateGeoPoint(input.deliveryLocation, "送餐位置"); } catch (e) { throw err.invalid((e as Error).message); }
  }
  if (location && point) throw err.invalid("送餐位置只能擇一提供");
  const address = parseDeliveryAddress(input?.deliveryAddress);
  if (address && !point && !location) throw err.invalid("請先設定送餐位置，再填送餐地址");
  // 沒選地點時保留上一版 digest，讓升級前的成功請求仍可重試。
  const avatarId = typeof input?.avatarId === "string" && AVATAR_IDS.includes(input.avatarId) ? input.avatarId : null;
  // 沒選角色時沿用舊 digest，讓舊版前端的重試請求仍然成立。經緯度用物件，與街區座標的陣列區隔。
  const pointDigest = location ? JSON.stringify([title, nickname, { lat: location.lat, lng: location.lng }])
    : point ? JSON.stringify([title, nickname, [point.x, point.y]]) : `${title}|${nickname}`;
  // 沒填地址時沿用舊 digest；物件格式避免與角色那層的陣列格式撞在一起。
  const baseDigest = address ? JSON.stringify({ base: pointDigest, address }) : pointDigest;
  const avatarDigest = avatarId ? JSON.stringify([baseDigest, avatarId]) : baseDigest;
  const storeIds = parseStoreIds(input?.storeIds);
  // 沒帶店家只可能是升級前的請求：沿用舊 digest，讓已成功的請求仍能重試，新請求在交易內拒絕。
  const storeDigest = storeIds ? JSON.stringify([avatarDigest, storeIds]) : avatarDigest;
  // 截止時間的範圍檢查在去重之後，讓逾時重送的成功請求仍能取回結果。
  const rawDeadline = input?.deadlineAt;
  if (rawDeadline !== undefined && rawDeadline !== null && !Number.isSafeInteger(rawDeadline)) throw err.invalid("截止時間格式錯誤");
  const digest = rawDeadline != null ? JSON.stringify([storeDigest, rawDeadline]) : storeDigest;
  const { db } = ctx;

  const roomId = await withWriteTx(db, async () => {
    const prev = await db
      .prepare("SELECT payload_digest, result_json FROM processed_requests WHERE scope = 'create-room' AND actor_id = ? AND request_id = ?")
      .bind(sessionId, reqId).first<{ payload_digest: string; result_json: string }>();
    if (prev) {
      if (prev.payload_digest !== digest) throw err.conflict();
      return (JSON.parse(prev.result_json) as { roomId: string }).roomId;
    }

    if (!storeIds) throw err.invalid("請先選擇要揪的店家");
    const openedAt = Date.now();
    const deadlineAt = parseDeadline(rawDeadline, openedAt) ?? null;
    // 只凍結團長選的店與其供應中餐點；任何一家不能接單就整團不開，避免默默少一家。
    const { results: stores } = await db
      .prepare(
        `SELECT s.*, EXISTS (SELECT 1 FROM meals m WHERE m.store_id = s.id AND m.available = 1) AS has_meals
         FROM stores s WHERE s.id IN (${storeIds.map(() => "?").join(", ")}) ORDER BY s.lot_index`,
      )
      .bind(...storeIds).all<{
        id: string;
        name: string;
        style_key: string;
        lot_index: number;
        is_sample: number;
        delivery_json: string | null;
        lat: number | null;
        lng: number | null;
        hours_json: string | null;
        status: string;
        has_meals: number;
      }>();
    if (stores.length !== storeIds.length) throw err.invalid("找不到選擇的店家，請重新整理後再選");
    for (const s of stores) {
      const open = s.status === "open" && s.has_meals === 1
        && storeOpening(s.hours_json ? JSON.parse(s.hours_json) : null, openedAt).open;
      if (!open) throw err.invalid(`「${s.name}」目前沒有營業，請重新選擇店家`);
    }

    const id = randomId(8);
    const isSample = stores.every((s) => s.is_sample === 1) ? 1 : 0;
    await db.prepare(
      `INSERT INTO rooms
        (id, title, status, catalog_version, is_sample, revision, created_at, delivery_x, delivery_y, deadline_at, delivery_address,
         delivery_lat, delivery_lng)
        VALUES (?, ?, 'open', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, title, `room:${id}`, isSample, Date.now(), point?.x ?? null, point?.y ?? null, deadlineAt, address,
      location?.lat ?? null, location?.lng ?? null).run();

    const insStore = db.prepare(
      `INSERT INTO room_stores
        (room_id, store_id, name, style_key, lot_index, door_x, door_y, sort_order, delivery_json, order_deadline_at, lat, lng)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [i, s] of stores.entries()) {
      const door = lotDoor(s.lot_index);
      await insStore.bind(id, s.id, s.name, s.style_key, s.lot_index, door.x, door.y, i, s.delivery_json,
        storeOpening(s.hours_json ? JSON.parse(s.hours_json) : null, openedAt).deadline, s.lat ?? null, s.lng ?? null).run();
    }
    await db.prepare(
      `INSERT INTO room_meals (room_id, meal_id, store_id, name, price_twd, image_key, available, tags_json, sort_order, options_json)
       SELECT ?, m.id, m.store_id, m.name, m.price_twd, m.image_key, 1, m.tags_json, m.sort_order, m.options_json
       FROM meals m JOIN room_stores s ON s.store_id = m.store_id AND s.room_id = ?
       WHERE m.available = 1`,
    ).bind(id, id).run();

    await insertMember(db, id, sessionId, nickname, avatarId ?? AVATAR_IDS[0], "owner");
    await db.prepare(
      "INSERT INTO processed_requests (scope, actor_id, request_id, payload_digest, result_json) VALUES ('create-room', ?, ?, ?, ?)",
    ).bind(sessionId, reqId, digest, JSON.stringify({ roomId: id })).run();
    return id;
  });

  return { invitePath: `/r/${roomId}`, snapshot: await buildSnapshot(db, roomId, sessionId) };
}

export async function joinRoom(ctx: Ctx, sessionId: string, roomId: string, input: JoinInput): Promise<RoomSnapshot> {
  const { db } = ctx;
  await getRoomRow(db, roomId);
  const existing = await findMember(db, roomId, sessionId);
  if (existing) return buildSnapshot(db, roomId, sessionId);

  const nickname = text(input?.nickname, "暱稱", 1, 12);
  const requested = typeof input?.avatarId === "string" && AVATAR_IDS.includes(input.avatarId) ? input.avatarId : null;

  const revision = await withWriteTx(db, async () => {
    const room = await getRoomRow(db, roomId);
    if (await findMember(db, roomId, sessionId)) return null; // 另一分頁剛加入
    if (room.status === "closed" || deadlinePassed(room)) throw err.closed();
    await insertMember(db, roomId, sessionId, nickname, requested ?? await pickAvatar(db, roomId), "participant");
    return bumpRevision(db, roomId);
  });
  if (revision !== null) ctx.events.roomChanged(roomId, revision);
  return buildSnapshot(db, roomId, sessionId);
}

export async function getPublicInfo(db: Db, roomId: string): Promise<RoomPublicInfo> {
  const room = await getRoomRow(db, roomId);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM members WHERE room_id = ?").bind(roomId).first<{ n: number }>();
  return { id: room.id, title: room.title, status: room.status, memberCount: n!.n };
}
