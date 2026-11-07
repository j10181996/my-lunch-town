import type { SyncDb as Db } from "./db-shared";
import { withSyncTx } from "./db-shared";

/** 送餐地址欄位；可重複執行，Node 的 openDb 與 Worker 的 openSnapshot 都會呼叫。 */
export function migrateDeliveryAddress(db: Pick<Db, "prepare" | "exec">) {
  const additions = [["rooms", "delivery_address", "TEXT"], ["store_orders", "delivery_address", "TEXT"]];
  const missing = additions.filter(([table, name]) => !(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((column) => column.name === name));
  if (!missing.length) return;
  withSyncTx(db as Db, () => {
    for (const [table, name, type] of missing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  });
}
