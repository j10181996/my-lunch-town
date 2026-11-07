import { resolveMealImage } from "../images/images";
import { storeOpening, validateStoreHours } from "../../shared/store-hours";
import type {
  AdminMeal,
  CreateStoreInput,
  CreateStoreResult,
  MealInput,
  StoreProfile,
  StoreStatus,
  TownLot,
  UpdateStoreInput,
} from "../../shared/contracts";
import { validateDeliveryRules } from "../../shared/delivery";
import { validateGeoPoint } from "../../shared/geo";
import { DEFAULT_MEAL_ART, LOTS, STYLE_KEYS } from "../../shared/town";
import { AppError, err, withWriteTx, type Db } from "../db";
import { hashKey, intInRange, oneOf, randomId, requestId as checkRequestId, text } from "../util";

interface StoreRow {
  address: string | null;
  id: string;
  name: string;
  style_key: string;
  lot_index: number;
  status: StoreStatus;
  owner_session_id: string | null;
  is_sample: number;
  delivery_json: string | null;
  hours_json: string | null;
  lat: number | null;
  lng: number | null;
}

const LOT_INDEXES = LOTS.map((l) => l.index);

export function getTown(db: Db): TownLot[] {
  const rows = db.prepare("SELECT * FROM stores").all() as unknown as StoreRow[];
  return LOTS.map((lot) => {
    const s = rows.find((r) => r.lot_index === lot.index);
    return {
      index: lot.index,
      store: s ? { address: s.address ?? undefined, id: s.id, name: s.name, styleKey: s.style_key, status: s.status === "open" && !storeOpening(s.hours_json ? JSON.parse(s.hours_json) : null).open ? "resting" : s.status } : null,
    };
  });
}

function loadProfile(db: Db, storeId: string): StoreProfile {
  const s = db.prepare("SELECT * FROM stores WHERE id = ?").get(storeId) as StoreRow | undefined;
  if (!s) throw storeNotFound();
  const meals = db
    .prepare("SELECT * FROM meals WHERE store_id = ? ORDER BY sort_order, id")
    .all(storeId) as Array<{ id: string; name: string; price_twd: number; image_key: string; available: number; tags_json: string; sort_order: number }>;
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM room_stores rs JOIN rooms r ON r.id = rs.room_id WHERE rs.store_id = ? AND r.status = 'open'")
    .get(storeId) as { n: number };
  return {
    id: s.id,
    address: s.address ?? undefined,
    name: s.name,
    styleKey: s.style_key,
    lotIndex: s.lot_index,
    status: s.status,
    isSample: s.is_sample === 1,
    activeRoomCount: active.n,
    hours: s.hours_json ? JSON.parse(s.hours_json) : null,
    delivery: s.delivery_json === null ? null : JSON.parse(s.delivery_json),
    location: s.lat == null ? null : { lat: s.lat, lng: s.lng! },
    meals: meals.map(
      (m): AdminMeal => ({
        id: m.id,
        name: m.name,
        priceTwd: m.price_twd,
        imageAssetKey: m.image_key,
        available: m.available === 1,
        tags: JSON.parse(m.tags_json) as string[],
        sortOrder: m.sort_order,
      }),
    ),
  };
}

/** 店家寫入權限：僅限擁有該店的工作階段。 */
export function requireOwner(db: Db, sessionId: string, storeId: string): StoreRow {
  const s = db.prepare("SELECT * FROM stores WHERE id = ?").get(storeId) as StoreRow | undefined;
  if (!s) throw storeNotFound();
  if (s.owner_session_id !== sessionId) throw err.notAllowed("這不是你的店；可用管理碼認領");
  return s;
}

/** 契約的 ErrorCode 沒有店家專用碼；以 INVALID_INPUT 搭配 HTTP 404 表示。 */
function storeNotFound() {
  return new AppError("INVALID_INPUT", 404, "找不到這家店");
}

function lotTaken(db: Db, lotIndex: number, exceptStoreId?: string) {
  const row = db.prepare("SELECT id FROM stores WHERE lot_index = ?").get(lotIndex) as { id: string } | undefined;
  return !!row && row.id !== exceptStoreId;
}

export function createStore(db: Db, sessionId: string, input: CreateStoreInput): CreateStoreResult {
  const name = text(input?.name, "店名", 1, 12);
  const styleKey = oneOf(input?.styleKey, "店面風格", STYLE_KEYS);
  const lotIndex = oneOf(String(input?.lotIndex), "地段", LOT_INDEXES.map(String));
  const reqId = checkRequestId(input?.requestId);
  const digest = `${name}|${styleKey}|${lotIndex}`;

  return withWriteTx(db, () => {
    const prev = db
      .prepare("SELECT payload_digest, result_json FROM processed_requests WHERE scope = 'create-store' AND actor_id = ? AND request_id = ?")
      .get(sessionId, reqId) as { payload_digest: string; result_json: string } | undefined;
    if (prev) {
      if (prev.payload_digest !== digest) throw err.conflict();
      const storeId = (JSON.parse(prev.result_json) as { storeId: string }).storeId;
      return { adminPath: `/shop/${storeId}`, profile: loadProfile(db, storeId), manageKey: null };
    }
    if (lotTaken(db, Number(lotIndex))) throw err.invalid("這個地段已經有店了，請換一格");

    const id = `store-${randomId(8)}`;
    const manageKey = `${randomId(4)}-${randomId(4)}-${randomId(4)}`;
    db.prepare(
      "INSERT INTO stores (id, name, style_key, lot_index, status, owner_session_id, manage_key_hash, is_sample, updated_at) VALUES (?, ?, ?, ?, 'resting', ?, ?, 0, ?)",
    ).run(id, name, styleKey, Number(lotIndex), sessionId, hashKey(manageKey), Date.now());
    db.prepare(
      "INSERT INTO processed_requests (scope, actor_id, request_id, payload_digest, result_json) VALUES ('create-store', ?, ?, ?, ?)",
    ).run(sessionId, reqId, digest, JSON.stringify({ storeId: id }));
    return { adminPath: `/shop/${id}`, profile: loadProfile(db, id), manageKey };
  });
}

export function myStores(db: Db, sessionId: string): StoreProfile[] {
  const rows = db.prepare("SELECT id FROM stores WHERE owner_session_id = ? ORDER BY lot_index").all(sessionId) as Array<{ id: string }>;
  return rows.map((r) => loadProfile(db, r.id));
}

/**
 * 用管理碼認領店家。demoKey（展示用後台碼）相符時，一次認領所有種子店家
 * （管理碼仍是 demo-{storeId} 的店；使用者自己開的店不受影響），回傳地段最前面的一家。
 */
export function claimStore(db: Db, sessionId: string, manageKey: unknown, demoKey?: string): StoreProfile {
  const key = text(manageKey, "管理碼", 4, 64);
  return withWriteTx(db, () => {
    if (demoKey && key === demoKey) {
      const seeded = (
        db.prepare("SELECT id, manage_key_hash FROM stores ORDER BY lot_index").all() as Array<{
          id: string;
          manage_key_hash: string | null;
        }>
      ).filter((s) => s.manage_key_hash === hashKey(`demo-${s.id}`));
      if (seeded.length === 0) throw err.notAllowed("目前沒有可用展示碼認領的店家");
      const claim = db.prepare("UPDATE stores SET owner_session_id = ? WHERE id = ?");
      for (const s of seeded) claim.run(sessionId, s.id);
      return loadProfile(db, seeded[0].id);
    }
    const row = db.prepare("SELECT id FROM stores WHERE manage_key_hash = ?").get(hashKey(key)) as { id: string } | undefined;
    if (!row) throw err.notAllowed("管理碼不正確");
    db.prepare("UPDATE stores SET owner_session_id = ? WHERE id = ?").run(sessionId, row.id);
    return loadProfile(db, row.id);
  });
}

export function getStore(db: Db, sessionId: string, storeId: string): StoreProfile {
  requireOwner(db, sessionId, storeId);
  return loadProfile(db, storeId);
}

export function updateStore(db: Db, sessionId: string, storeId: string, input: UpdateStoreInput): StoreProfile {
  return withWriteTx(db, () => {
    const s = requireOwner(db, sessionId, storeId);
    const name = input?.name !== undefined ? text(input.name, "店名", 1, 12) : s.name;
    const styleKey = input?.styleKey !== undefined ? oneOf(input.styleKey, "店面風格", STYLE_KEYS) : s.style_key;
    const lotIndex =
      input?.lotIndex !== undefined ? Number(oneOf(String(input.lotIndex), "地段", LOT_INDEXES.map(String))) : s.lot_index;
    if (lotTaken(db, lotIndex, storeId)) throw err.invalid("這個地段已經有店了，請換一格");
    db.prepare("UPDATE stores SET name = ?, style_key = ?, lot_index = ?, updated_at = ? WHERE id = ?").run(
      name,
      styleKey,
      lotIndex,
      Date.now(),
      storeId,
    );
    return loadProfile(db, storeId);
  });
}

function countAvailable(db: Db, storeId: string) {
  return (db.prepare("SELECT COUNT(*) AS n FROM meals WHERE store_id = ? AND available = 1").get(storeId) as { n: number }).n;
}

/** 沒有供應中餐點時自動休息，避免空店出現在新開的團。 */
function autoRestIfEmpty(db: Db, storeId: string) {
  if (countAvailable(db, storeId) === 0) {
    db.prepare("UPDATE stores SET status = 'resting' WHERE id = ?").run(storeId);
  }
}

export function setStatus(db: Db, sessionId: string, storeId: string, status: unknown): StoreProfile {
  const next = oneOf(status, "營業狀態", ["open", "resting"] as const);
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    if (next === "open" && countAvailable(db, storeId) === 0) throw err.invalid("至少要有一道供應中的餐點才能開門營業");
    db.prepare("UPDATE stores SET status = ?, updated_at = ? WHERE id = ?").run(next, Date.now(), storeId);
    return loadProfile(db, storeId);
  });
}

/** 飲食標籤（素食、辣、過敏原…）與店家自訂標籤共用欄位，上限因此放寬到 8 個。 */
const MAX_MEAL_TAGS = 8;

function parseMeal(input: Partial<MealInput>, base?: MealInput): MealInput {
  const name = input.name !== undefined ? text(input.name, "餐點名稱", 1, 16) : base?.name;
  const priceTwd = input.priceTwd !== undefined ? intInRange(input.priceTwd, "價格", 0, 9999) : base?.priceTwd;
  const imageAssetKey = input.imageAssetKey ?? base?.imageAssetKey ?? DEFAULT_MEAL_ART;
  const available = input.available !== undefined ? input.available === true : (base?.available ?? true);
  let tags = base?.tags ?? [];
  if (input.tags !== undefined) {
    // 先擋住過長陣列，再去除重複後計算數量上限。
    if (!Array.isArray(input.tags) || input.tags.length > MAX_MEAL_TAGS * 2) throw err.invalid(`標籤最多 ${MAX_MEAL_TAGS} 個`);
    tags = [...new Set(input.tags.map((t) => text(t, "標籤", 1, 8)))];
    if (tags.length > MAX_MEAL_TAGS) throw err.invalid(`標籤最多 ${MAX_MEAL_TAGS} 個`);
  }
  if (name === undefined || priceTwd === undefined) throw err.invalid("餐點需要名稱與價格");
  return { name, priceTwd, imageAssetKey, available, tags };
}

export function addMeal(db: Db, sessionId: string, storeId: string, input: MealInput): StoreProfile {
  const meal = parseMeal(input ?? {});
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    meal.imageAssetKey = resolveMealImage(db, storeId, meal.imageAssetKey);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM meals WHERE store_id = ?").get(storeId) as { n: number }).n;
    if (n >= 12) throw err.invalid("每家店最多 12 道餐點");
    const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM meals WHERE store_id = ?").get(storeId) as { m: number };
    db.prepare(
      "INSERT INTO meals (id, store_id, name, price_twd, image_key, available, tags_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(`meal-${randomId(8)}`, storeId, meal.name, meal.priceTwd, meal.imageAssetKey, meal.available ? 1 : 0, JSON.stringify(meal.tags), max.m + 1);
    autoRestIfEmpty(db, storeId);
    return loadProfile(db, storeId);
  });
}

function requireMeal(db: Db, storeId: string, mealId: string) {
  const m = db.prepare("SELECT * FROM meals WHERE id = ? AND store_id = ?").get(mealId, storeId) as
    | { name: string; price_twd: number; image_key: string; available: number; tags_json: string; sort_order: number }
    | undefined;
  if (!m) throw err.mealNotFound();
  return m;
}

export function updateMeal(db: Db, sessionId: string, storeId: string, mealId: string, input: Partial<MealInput>): StoreProfile {
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    const cur = requireMeal(db, storeId, mealId);
    const next = parseMeal(input ?? {}, {
      name: cur.name,
      priceTwd: cur.price_twd,
      imageAssetKey: cur.image_key,
      available: cur.available === 1,
      tags: JSON.parse(cur.tags_json) as string[],
    });
    next.imageAssetKey = resolveMealImage(db, storeId, next.imageAssetKey);
    db.prepare("UPDATE meals SET name = ?, price_twd = ?, image_key = ?, available = ?, tags_json = ? WHERE id = ?").run(
      next.name,
      next.priceTwd,
      next.imageAssetKey,
      next.available ? 1 : 0,
      JSON.stringify(next.tags),
      mealId,
    );
    autoRestIfEmpty(db, storeId);
    return loadProfile(db, storeId);
  });
}

export function moveMeal(db: Db, sessionId: string, storeId: string, mealId: string, direction: unknown): StoreProfile {
  const dir = oneOf(direction, "方向", ["up", "down"] as const);
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    requireMeal(db, storeId, mealId);
    const ids = (db.prepare("SELECT id FROM meals WHERE store_id = ? ORDER BY sort_order, id").all(storeId) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    const i = ids.indexOf(mealId);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
    const upd = db.prepare("UPDATE meals SET sort_order = ? WHERE id = ?");
    ids.forEach((id, k) => upd.run(k, id));
    return loadProfile(db, storeId);
  });
}

export function deleteMeal(db: Db, sessionId: string, storeId: string, mealId: string): StoreProfile {
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    requireMeal(db, storeId, mealId);
    // 進行中的團使用 room_meals 凍結副本，刪除主檔不影響既有訂單
    db.prepare("DELETE FROM meals WHERE id = ?").run(mealId);
    autoRestIfEmpty(db, storeId);
    return loadProfile(db, storeId);
  });
}

export function setDelivery(db: Db, sessionId: string, storeId: string, input: unknown): StoreProfile {
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    let rules;
    try {
      rules = validateDeliveryRules(input);
    } catch (e) {
      throw err.invalid((e as Error).message);
    }
    db.prepare("UPDATE stores SET delivery_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(rules), Date.now(), storeId);
    return loadProfile(db, storeId);
  });
}

/**
 * body：{ location: { lat, lng } | null, address?: string }；null 清除位置。
 * 帶 address 時一併更新店家地址。修改只套用到之後開的團。
 */
export function setLocation(db: Db, sessionId: string, storeId: string, input: unknown): StoreProfile {
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    if (!input || typeof input !== "object" || !("location" in input)) throw err.invalid("請提供店家位置");
    const body = input as { location: unknown; address?: unknown };
    let location = null;
    if (body.location !== null) {
      try { location = validateGeoPoint(body.location, "店家位置"); } catch (e) { throw err.invalid((e as Error).message); }
    }
    const address = body.address === undefined ? undefined : text(body.address, "店家地址", 4, 100);
    db.prepare("UPDATE stores SET lat = ?, lng = ?, updated_at = ? WHERE id = ?")
      .run(location?.lat ?? null, location?.lng ?? null, Date.now(), storeId);
    if (address !== undefined) db.prepare("UPDATE stores SET address = ? WHERE id = ?").run(address, storeId);
    return loadProfile(db, storeId);
  });
}

export function setHours(db: Db, sessionId: string, storeId: string, input: unknown): StoreProfile {
  return withWriteTx(db, () => {
    requireOwner(db, sessionId, storeId);
    let hours;
    try { hours = validateStoreHours(input); } catch (e) { throw err.invalid((e as Error).message); }
    db.prepare("UPDATE stores SET hours_json = ?, updated_at = ? WHERE id = ?")
      .run(hours ? JSON.stringify(hours) : null, Date.now(), storeId);
    return loadProfile(db, storeId);
  });
}
