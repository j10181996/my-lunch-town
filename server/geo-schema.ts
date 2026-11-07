import type { Db } from "./db";
import { withWriteTx } from "./db-shared";

/** 真實經緯度欄位；可重複執行，Node 的 openDb 與 Worker 的 openSnapshot 都會呼叫。 */
export function migrateGeoLocation(db: Pick<Db, "prepare" | "exec">) {
  const additions = [
    ["stores", "lat", "REAL"], ["stores", "lng", "REAL"],
    ["room_stores", "lat", "REAL"], ["room_stores", "lng", "REAL"],
    ["rooms", "delivery_lat", "REAL"], ["rooms", "delivery_lng", "REAL"],
  ];
  const missing = additions.filter(([table, name]) => !(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((column) => column.name === name));
  if (!missing.length) return;
  withWriteTx(db as Db, () => {
    for (const [table, name, type] of missing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  });
}
