import type { SyncDb as Db } from "../db-shared";
import { withSyncTx } from "../db-shared";

const columnsOf = (db: Pick<Db, "prepare">, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

/**
 * 餐點選項與個人備註（#14）的可重複執行遷移，openDb 與 Worker 的 openSnapshot 都會呼叫。
 * - meals、room_meals 增加 options_json（NULL 表示沒有選項；開團時隨菜單凍結）。
 * - order_items 的主鍵從 (room, member, meal) 改成 (room, member, meal, option_key, note)。
 *   SQLite 不能改主鍵，所以重建表格；既有列的 option_key 與 note 為空字串，數量與單價原樣保留。
 */
export function migrateMealOptions(db: Pick<Db, "prepare" | "exec">) {
  const needMeals = !columnsOf(db, "meals").includes("options_json");
  const needRoomMeals = !columnsOf(db, "room_meals").includes("options_json");
  const needItems = !columnsOf(db, "order_items").includes("option_key");
  if (!needMeals && !needRoomMeals && !needItems) return;
  withSyncTx(db as Db, () => {
    if (needMeals) db.exec("ALTER TABLE meals ADD COLUMN options_json TEXT");
    if (needRoomMeals) db.exec("ALTER TABLE room_meals ADD COLUMN options_json TEXT");
    if (needItems) {
      db.exec(`
        CREATE TABLE order_items_v2 (
          room_id TEXT NOT NULL,
          member_id TEXT NOT NULL,
          meal_id TEXT NOT NULL,
          option_key TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
          unit_price_twd INTEGER NOT NULL,
          PRIMARY KEY (room_id, member_id, meal_id, option_key, note)
        );
        INSERT INTO order_items_v2 (room_id, member_id, meal_id, quantity, unit_price_twd)
          SELECT room_id, member_id, meal_id, quantity, unit_price_twd FROM order_items;
        DROP TABLE order_items;
        ALTER TABLE order_items_v2 RENAME TO order_items;
      `);
    }
  });
}
