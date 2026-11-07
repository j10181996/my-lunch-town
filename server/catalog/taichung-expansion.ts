import seed from "../../shared/catalog/stores.taichung.json";
import { LOTS } from "../../shared/town";
import type { Db } from "../db";
import { hashKey, withWriteTx } from "../db-shared";

const ORIGINAL_IDS = ["store-chingfan", "store-shanliang", "store-yiriyiwei", "store-potato", "store-haritts", "store-zhuangzhuang"];
export const EXPANSION_IDS = ["store-youfan", "store-picnicday", "store-zhuyi", "store-musi", "store-steal-flavor", "store-roasted-time", "store-healthy-daily", "store-meetzen"];

/** stores.address 與 catalog_imports；可重複執行。舊庫升級（schema/legacy.ts）與下方匯入共用。 */
export function migrateTaichungExpansionSchema(db: Pick<Db, "prepare" | "exec">) {
  const columns = db.prepare("PRAGMA table_info(stores)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "address")) db.exec("ALTER TABLE stores ADD COLUMN address TEXT");
  db.exec("CREATE TABLE IF NOT EXISTS catalog_imports (store_id TEXT PRIMARY KEY, version TEXT NOT NULL)");
}

/** 保留現有店家、認領、菜單與團快照；僅新增本批尚未匯入的種子店。 */
export function migrateTaichungExpansion(db: Db) {
  withWriteTx(db, () => {
    migrateTaichungExpansionSchema(db);
    // 虛構種子及純自建店家環境不混入真實店家。
    if (!ORIGINAL_IDS.some((id) => db.prepare("SELECT 1 FROM stores WHERE id = ? AND is_sample = 0").get(id))) return;
    for (const store of seed.stores) {
      if (store.address) db.prepare("UPDATE stores SET address = ? WHERE id = ? AND address IS NULL").run(store.address, store.id);
    }
    for (const id of EXPANSION_IDS) {
      if (db.prepare("SELECT 1 FROM catalog_imports WHERE store_id = ?").get(id)) continue;
      if (!db.prepare("SELECT 1 FROM stores WHERE id = ?").get(id)) {
        const store = seed.stores.find((s) => s.id === id)!;
        const occupied = new Set((db.prepare("SELECT lot_index FROM stores").all() as Array<{ lot_index: number }>).map((s) => s.lot_index));
        const lot = !occupied.has(store.lotIndex) ? store.lotIndex : LOTS.find((l) => !occupied.has(l.index))?.index;
        // 沒空位時保留現有店家，之後有空位再補入，不覆蓋或搬走他人的店。
        if (lot === undefined) continue;
        db.prepare(`INSERT INTO stores (id, name, style_key, lot_index, status, owner_session_id, manage_key_hash, is_sample, updated_at, address)
          VALUES (?, ?, ?, ?, 'open', NULL, ?, 0, ?, ?)`)
          .run(id, store.name, store.styleKey, lot, hashKey(`demo-${id}`), Date.now(), store.address);
        for (const [i, meal] of seed.meals.filter((m) => m.storeId === id).entries()) {
          db.prepare(`INSERT INTO meals (id, store_id, name, price_twd, image_key, available, tags_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(meal.id, id, meal.name, meal.priceTwd, meal.imageAssetKey, meal.available ? 1 : 0, JSON.stringify(meal.tags), i);
        }
      }
      // 已存在的店也只標記完成，不補回被店家刪掉或改價的餐點。
      db.prepare("INSERT INTO catalog_imports (store_id, version) VALUES (?, ?)").run(id, "taichung-20261107-v2");
    }
  });
}
