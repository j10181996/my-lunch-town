import type { Catalog } from "../../shared/contracts";
import { storeOpening } from "../../shared/store-hours";
import { lotDoor } from "../../shared/town";
import type { Db } from "../db";

interface Row {
  id: string;
  name: string;
  style_key: string;
  lot_index: number;
  status: "open" | "resting";
  is_sample: number;
  hours_json: string | null;
}

/**
 * 散步模式用的即時菜單（#44）：不需登入、不寫入任何資料。
 * 收錄所有有供應中餐點的店；現在不收單的店（手動休息或不在營業時段）標成 resting，
 * 讓店家也能走到自己的店面預覽。只回傳開團時會公開的欄位，不含外送規則與擁有者資訊。
 */
export function getTownCatalog(db: Db, now = Date.now()): Catalog {
  const stores = db
    .prepare(
      "SELECT s.* FROM stores s WHERE EXISTS (SELECT 1 FROM meals m WHERE m.store_id = s.id AND m.available = 1) ORDER BY s.lot_index",
    )
    .all() as unknown as Row[];
  const ids = new Set(stores.map((s) => s.id));
  const meals = (db
    .prepare("SELECT * FROM meals WHERE available = 1 ORDER BY sort_order, id")
    .all() as Array<{ id: string; store_id: string; name: string; price_twd: number; image_key: string; tags_json: string }>)
    .filter((m) => ids.has(m.store_id));
  return {
    catalogVersion: "town:live",
    currency: "TWD",
    isSample: stores.length > 0 && stores.every((s) => s.is_sample === 1),
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      sceneId: `shop:${s.id}` as const,
      door: lotDoor(s.lot_index),
      interiorAssetKey: `interior-${s.style_key}`,
      styleKey: s.style_key,
      lotIndex: s.lot_index,
      resting: s.status !== "open" || !storeOpening(s.hours_json ? JSON.parse(s.hours_json) : null, now).open,
    })),
    meals: meals.map((m) => ({
      id: m.id,
      storeId: m.store_id,
      name: m.name,
      priceTwd: m.price_twd,
      imageAssetKey: m.image_key,
      available: true,
      tags: JSON.parse(m.tags_json) as string[],
    })),
  };
}
