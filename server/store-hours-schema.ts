import type { Db } from "./db";
import { withWriteTx } from "./db-shared";

/** Idempotent upgrade of the SQLite domain image, including pre-Sites databases. */
export function migrateStoreHours(db: Pick<Db, "prepare" | "exec">) {
  const additions = [["stores", "hours_json", "TEXT"], ["room_stores", "order_deadline_at", "INTEGER"]];
  const missing = additions.filter(([table, name]) => !(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((column) => column.name === name));
  if (!missing.length) return;
  withWriteTx(db as Db, () => {
    for (const [table, name, type] of missing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  });
}
