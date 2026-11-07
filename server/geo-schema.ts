import taichung from "../shared/catalog/stores.taichung.json";
import type { SyncDb as Db } from "./db-shared";
import { withSyncTx } from "./db-shared";

/** 真實經緯度欄位；可重複執行，Node 的 openDb 與 Worker 的 openSnapshot 都會呼叫。 */
export function migrateGeoLocation(db: Pick<Db, "prepare" | "exec">) {
  const additions = [
    ["stores", "lat", "REAL"], ["stores", "lng", "REAL"],
    ["room_stores", "lat", "REAL"], ["room_stores", "lng", "REAL"],
    ["rooms", "delivery_lat", "REAL"], ["rooms", "delivery_lng", "REAL"],
  ];
  const missing = additions.filter(([table, name]) => !(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((column) => column.name === name));
  if (!missing.length) return;
  withSyncTx(db as Db, () => {
    for (const [table, name, type] of missing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  });
}

/** 位置回填紀錄表；可重複執行。舊庫升級（schema/legacy.ts）與下方回填共用。 */
export function migrateLocationImports(db: Pick<Db, "exec">) {
  db.exec("CREATE TABLE IF NOT EXISTS location_imports (store_id TEXT PRIMARY KEY)");
}

/**
 * 把台中種子的店家位置補進既有資料庫（含已部署的 D1）。須在 migrateGeoLocation 與店家匯入之後呼叫。
 * 每家只補一次並記錄：只填真實店家且目前沒有位置的；店家之後自行清除位置不會被填回。
 * 尚未匯入的店不記錄，等它出現後的下次啟動再補。
 */
export function backfillSeedLocations(db: Pick<Db, "prepare" | "exec">) {
  withSyncTx(db as Db, () => {
    migrateLocationImports(db);
    const done = db.prepare("SELECT 1 FROM location_imports WHERE store_id = ?");
    const exists = db.prepare("SELECT 1 FROM stores WHERE id = ? AND is_sample = 0");
    const fill = db.prepare("UPDATE stores SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL");
    const mark = db.prepare("INSERT INTO location_imports (store_id) VALUES (?)");
    for (const store of taichung.stores as Array<{ id: string; location?: { lat: number; lng: number } }>) {
      if (!store.location || done.get(store.id) || !exists.get(store.id)) continue;
      fill.run(store.location.lat, store.location.lng, store.id);
      mark.run(store.id);
    }
  });
}
