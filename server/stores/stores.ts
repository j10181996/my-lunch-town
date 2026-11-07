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
import { parseOptionGroups, validateOptionGroups } from "../../shared/meal-options";
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

export async function getTown(db: Db): Promise<TownLot[]> {
  const { results: rows } = await db.prepare("SELECT * FROM stores").all<StoreRow>();
  return LOTS.map((lot) => {
    const s = rows.find((r) => r.lot_index === lot.index);
    return {
      index: lot.index,
      store: s ? { address: s.address ?? undefined, id: s.id, name: s.name, styleKey: s.style_key, status: s.status === "open" && !storeOpening(s.hours_json ? JSON.parse(s.hours_json) : null).open ? "resting" : s.status } : null,
    };
  });
}

async function loadProfile(db: Db, storeId: string): Promise<StoreProfile> {
  const s = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(storeId).first<StoreRow>();
  if (!s) throw storeNotFound();
  const { results: meals } = await db
    .prepare("SELECT * FROM meals WHERE store_id = ? ORDER BY sort_order, id")
    .bind(storeId).all<{ id: string; name: string; price_twd: number; image_key: string; available: number; tags_json: string; sort_order: number; options_json: string | null }>();
  const active = (await db
    .prepare("SELECT COUNT(*) AS n FROM room_stores rs JOIN rooms r ON r.id = rs.room_id WHERE rs.store_id = ? AND r.status = 'open'")
    .bind(storeId).first<{ n: number }>())!;
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
        options: parseOptionGroups(m.options_json),
      }),
    ),
  };
}

/** 店家寫入權限：僅限擁有該店的工作階段。 */
export async function requireOwner(db: Db, sessionId: string, storeId: string): Promise<StoreRow> {
  const s = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(storeId).first<StoreRow>();
  if (!s) throw storeNotFound();
  if (s.owner_session_id !== sessionId) throw err.notAllowed("這不是你的店；可用管理碼認領");
  return s;
}

/** 契約的 ErrorCode 沒有店家專用碼；以 INVALID_INPUT 搭配 HTTP 404 表示。 */
function storeNotFound() {
  return new AppError("INVALID_INPUT", 404, "找不到這家店");
}

async function lotTaken(db: Db, lotIndex: number, exceptStoreId?: string) {
  const row = await db.prepare("SELECT id FROM stores WHERE lot_index = ?").bind(lotIndex).first<{ id: string }>();
  return !!row && row.id !== exceptStoreId;
}

export async function createStore(db: Db, sessionId: string, input: CreateStoreInput): Promise<CreateStoreResult> {
  const name = text(input?.name, "店名", 1, 12);
  const styleKey = oneOf(input?.styleKey, "店面風格", STYLE_KEYS);
  const lotIndex = oneOf(String(input?.lotIndex), "地段", LOT_INDEXES.map(String));
  const reqId = checkRequestId(input?.requestId);
  const digest = `${name}|${styleKey}|${lotIndex}`;

  return withWriteTx(db, async () => {
    const prev = await db
      .prepare("SELECT payload_digest, result_json FROM processed_requests WHERE scope = 'create-store' AND actor_id = ? AND request_id = ?")
      .bind(sessionId, reqId).first<{ payload_digest: string; result_json: string }>();
    if (prev) {
      if (prev.payload_digest !== digest) throw err.conflict();
      const storeId = (JSON.parse(prev.result_json) as { storeId: string }).storeId;
      return { adminPath: `/shop/${storeId}`, profile: await loadProfile(db, storeId), manageKey: null };
    }
    if (await lotTaken(db, Number(lotIndex))) throw err.invalid("這個地段已經有店了，請換一格");

    const id = `store-${randomId(8)}`;
    const manageKey = `${randomId(4)}-${randomId(4)}-${randomId(4)}`;
    await db.prepare(
      "INSERT INTO stores (id, name, style_key, lot_index, status, owner_session_id, manage_key_hash, is_sample, updated_at) VALUES (?, ?, ?, ?, 'resting', ?, ?, 0, ?)",
    ).bind(id, name, styleKey, Number(lotIndex), sessionId, hashKey(manageKey), Date.now()).run();
    await db.prepare(
      "INSERT INTO processed_requests (scope, actor_id, request_id, payload_digest, result_json) VALUES ('create-store', ?, ?, ?, ?)",
    ).bind(sessionId, reqId, digest, JSON.stringify({ storeId: id })).run();
    return { adminPath: `/shop/${id}`, profile: await loadProfile(db, id), manageKey };
  });
}

export async function myStores(db: Db, sessionId: string): Promise<StoreProfile[]> {
  const { results: rows } = await db.prepare("SELECT id FROM stores WHERE owner_session_id = ? ORDER BY lot_index").bind(sessionId).all<{ id: string }>();
  const out: StoreProfile[] = [];
  for (const r of rows) out.push(await loadProfile(db, r.id));
  return out;
}

/**
 * 用管理碼認領店家。demoKey（展示用後台碼）相符時，一次認領所有種子店家
 * （管理碼仍是 demo-{storeId} 的店；使用者自己開的店不受影響），回傳地段最前面的一家。
 */
export async function claimStore(db: Db, sessionId: string, manageKey: unknown, demoKey?: string): Promise<StoreProfile> {
  const key = text(manageKey, "管理碼", 4, 64);
  return withWriteTx(db, async () => {
    if (demoKey && key === demoKey) {
      const seeded = (
        await db.prepare("SELECT id, manage_key_hash FROM stores ORDER BY lot_index").all<{
          id: string;
          manage_key_hash: string | null;
        }>()
      ).results.filter((s) => s.manage_key_hash === hashKey(`demo-${s.id}`));
      if (seeded.length === 0) throw err.notAllowed("目前沒有可用展示碼認領的店家");
      const claim = db.prepare("UPDATE stores SET owner_session_id = ? WHERE id = ?");
      for (const s of seeded) await claim.bind(sessionId, s.id).run();
      return loadProfile(db, seeded[0].id);
    }
    const row = await db.prepare("SELECT id FROM stores WHERE manage_key_hash = ?").bind(hashKey(key)).first<{ id: string }>();
    if (!row) throw err.notAllowed("管理碼不正確");
    await db.prepare("UPDATE stores SET owner_session_id = ? WHERE id = ?").bind(sessionId, row.id).run();
    return loadProfile(db, row.id);
  });
}

export async function getStore(db: Db, sessionId: string, storeId: string): Promise<StoreProfile> {
  await requireOwner(db, sessionId, storeId);
  return loadProfile(db, storeId);
}

export async function updateStore(db: Db, sessionId: string, storeId: string, input: UpdateStoreInput): Promise<StoreProfile> {
  return withWriteTx(db, async () => {
    const s = await requireOwner(db, sessionId, storeId);
    const name = input?.name !== undefined ? text(input.name, "店名", 1, 12) : s.name;
    const styleKey = input?.styleKey !== undefined ? oneOf(input.styleKey, "店面風格", STYLE_KEYS) : s.style_key;
    const lotIndex =
      input?.lotIndex !== undefined ? Number(oneOf(String(input.lotIndex), "地段", LOT_INDEXES.map(String))) : s.lot_index;
    if (await lotTaken(db, lotIndex, storeId)) throw err.invalid("這個地段已經有店了，請換一格");
    await db.prepare("UPDATE stores SET name = ?, style_key = ?, lot_index = ?, updated_at = ? WHERE id = ?")
      .bind(name, styleKey, lotIndex, Date.now(), storeId).run();
    return loadProfile(db, storeId);
  });
}

async function countAvailable(db: Db, storeId: string) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM meals WHERE store_id = ? AND available = 1").bind(storeId).first<{ n: number }>())!.n;
}

/** 沒有供應中餐點時自動休息，避免空店出現在新開的團。 */
async function autoRestIfEmpty(db: Db, storeId: string) {
  if (await countAvailable(db, storeId) === 0) {
    await db.prepare("UPDATE stores SET status = 'resting' WHERE id = ?").bind(storeId).run();
  }
}

export async function setStatus(db: Db, sessionId: string, storeId: string, status: unknown): Promise<StoreProfile> {
  const next = oneOf(status, "營業狀態", ["open", "resting"] as const);
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    if (next === "open" && await countAvailable(db, storeId) === 0) throw err.invalid("至少要有一道供應中的餐點才能開門營業");
    await db.prepare("UPDATE stores SET status = ?, updated_at = ? WHERE id = ?").bind(next, Date.now(), storeId).run();
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
  let options = base?.options ?? [];
  if (input.options !== undefined) {
    try { options = validateOptionGroups(input.options); } catch (e) { throw err.invalid((e as Error).message); }
  }
  if (name === undefined || priceTwd === undefined) throw err.invalid("餐點需要名稱與價格");
  return { name, priceTwd, imageAssetKey, available, tags, options };
}

/** 沒有選項存 NULL，與遷移前的資料一致。 */
function optionsJson(options: MealInput["options"]): string | null {
  return options && options.length > 0 ? JSON.stringify(options) : null;
}

export async function addMeal(db: Db, sessionId: string, storeId: string, input: MealInput): Promise<StoreProfile> {
  const meal = parseMeal(input ?? {});
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    meal.imageAssetKey = await resolveMealImage(db, storeId, meal.imageAssetKey);
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM meals WHERE store_id = ?").bind(storeId).first<{ n: number }>())!.n;
    if (n >= 12) throw err.invalid("每家店最多 12 道餐點");
    const max = (await db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM meals WHERE store_id = ?").bind(storeId).first<{ m: number }>())!;
    await db.prepare(
      "INSERT INTO meals (id, store_id, name, price_twd, image_key, available, tags_json, sort_order, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(`meal-${randomId(8)}`, storeId, meal.name, meal.priceTwd, meal.imageAssetKey, meal.available ? 1 : 0, JSON.stringify(meal.tags), max.m + 1,
      optionsJson(meal.options)).run();
    await autoRestIfEmpty(db, storeId);
    return loadProfile(db, storeId);
  });
}

async function requireMeal(db: Db, storeId: string, mealId: string) {
  const m = await db.prepare("SELECT * FROM meals WHERE id = ? AND store_id = ?").bind(mealId, storeId)
    .first<{ name: string; price_twd: number; image_key: string; available: number; tags_json: string; sort_order: number; options_json: string | null }>();
  if (!m) throw err.mealNotFound();
  return m;
}

export async function updateMeal(db: Db, sessionId: string, storeId: string, mealId: string, input: Partial<MealInput>): Promise<StoreProfile> {
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    const cur = await requireMeal(db, storeId, mealId);
    const next = parseMeal(input ?? {}, {
      name: cur.name,
      priceTwd: cur.price_twd,
      imageAssetKey: cur.image_key,
      available: cur.available === 1,
      tags: JSON.parse(cur.tags_json) as string[],
      options: parseOptionGroups(cur.options_json),
    });
    next.imageAssetKey = await resolveMealImage(db, storeId, next.imageAssetKey);
    await db.prepare("UPDATE meals SET name = ?, price_twd = ?, image_key = ?, available = ?, tags_json = ?, options_json = ? WHERE id = ?")
      .bind(next.name, next.priceTwd, next.imageAssetKey, next.available ? 1 : 0, JSON.stringify(next.tags), optionsJson(next.options), mealId)
      .run();
    await autoRestIfEmpty(db, storeId);
    return loadProfile(db, storeId);
  });
}

export async function moveMeal(db: Db, sessionId: string, storeId: string, mealId: string, direction: unknown): Promise<StoreProfile> {
  const dir = oneOf(direction, "方向", ["up", "down"] as const);
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    await requireMeal(db, storeId, mealId);
    const ids = (await db.prepare("SELECT id FROM meals WHERE store_id = ? ORDER BY sort_order, id").bind(storeId).all<{ id: string }>())
      .results.map((r) => r.id);
    const i = ids.indexOf(mealId);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
    const upd = db.prepare("UPDATE meals SET sort_order = ? WHERE id = ?");
    for (const [k, id] of ids.entries()) await upd.bind(k, id).run();
    return loadProfile(db, storeId);
  });
}

export async function deleteMeal(db: Db, sessionId: string, storeId: string, mealId: string): Promise<StoreProfile> {
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    await requireMeal(db, storeId, mealId);
    // 進行中的團使用 room_meals 凍結副本，刪除主檔不影響既有訂單
    await db.prepare("DELETE FROM meals WHERE id = ?").bind(mealId).run();
    await autoRestIfEmpty(db, storeId);
    return loadProfile(db, storeId);
  });
}

export async function setDelivery(db: Db, sessionId: string, storeId: string, input: unknown): Promise<StoreProfile> {
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    let rules;
    try {
      rules = validateDeliveryRules(input);
    } catch (e) {
      throw err.invalid((e as Error).message);
    }
    await db.prepare("UPDATE stores SET delivery_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(rules), Date.now(), storeId).run();
    return loadProfile(db, storeId);
  });
}

/**
 * body：{ location: { lat, lng } | null, address?: string }；null 清除位置。
 * 帶 address 時一併更新店家地址。修改只套用到之後開的團。
 */
export async function setLocation(db: Db, sessionId: string, storeId: string, input: unknown): Promise<StoreProfile> {
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    if (!input || typeof input !== "object" || !("location" in input)) throw err.invalid("請提供店家位置");
    const body = input as { location: unknown; address?: unknown };
    let location = null;
    if (body.location !== null) {
      try { location = validateGeoPoint(body.location, "店家位置"); } catch (e) { throw err.invalid((e as Error).message); }
    }
    const address = body.address === undefined ? undefined : text(body.address, "店家地址", 4, 100);
    await db.prepare("UPDATE stores SET lat = ?, lng = ?, updated_at = ? WHERE id = ?")
      .bind(location?.lat ?? null, location?.lng ?? null, Date.now(), storeId).run();
    if (address !== undefined) await db.prepare("UPDATE stores SET address = ? WHERE id = ?").bind(address, storeId).run();
    return loadProfile(db, storeId);
  });
}

export async function setHours(db: Db, sessionId: string, storeId: string, input: unknown): Promise<StoreProfile> {
  return withWriteTx(db, async () => {
    await requireOwner(db, sessionId, storeId);
    let hours;
    try { hours = validateStoreHours(input); } catch (e) { throw err.invalid((e as Error).message); }
    await db.prepare("UPDATE stores SET hours_json = ?, updated_at = ? WHERE id = ?")
      .bind(hours ? JSON.stringify(hours) : null, Date.now(), storeId).run();
    return loadProfile(db, storeId);
  });
}
