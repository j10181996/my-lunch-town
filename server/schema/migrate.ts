import type { SyncDb as Db } from "../db-shared";
import { withSyncTx } from "../db-shared";
import { BASELINE_SCHEMA } from "./baseline";
import { upgradeLegacy, type LegacySeedStore } from "./legacy";

/**
 * 一筆版本化遷移。名稱以四位數序號開頭，依陣列順序套用，套用後記錄在 schema_migrations。
 * up 在交易內執行，失敗會整筆回滾、不記錄，下次開啟時重試。
 * 只能使用 db.exec 與 db.prepare 的 get/all/run，Node 與 Worker（D1）都要能跑。
 */
export interface Migration {
  name: string;
  up(db: Db): void;
}

/** 舊庫升級完成後直接記為已套用的基線遷移。 */
export const BASELINE = "0001_baseline";

/**
 * 所有 schema 變更的唯一清單。新增表或欄位時在最後加一筆，不要修改已發布的項目。
 * Node 的 openDb 與 Worker 的 openSnapshot 都只呼叫 migrate()，不需要兩邊各自登記。
 */
export const MIGRATIONS: Migration[] = [
  { name: BASELINE, up: (db) => db.exec(BASELINE_SCHEMA) },
];

export interface MigrateOptions {
  /** 舊庫升級時回填外送規則用的種子店家；只在需要時才讀取。 */
  legacySeedStores: () => LegacySeedStore[];
  /** 測試用；預設為 MIGRATIONS。 */
  migrations?: Migration[];
}

const TRACKING_SCHEMA = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
)`;

const tableExists = (db: Db, name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/** 有任何非 SQLite 內部表，代表是導入版本化之前就存在的資料庫。 */
const hasAnyTable = (db: Db) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();

/** 把資料庫升級到最新 schema；可重複呼叫，已套用的遷移不會再執行。回傳本次套用的遷移名稱。 */
export function migrate(db: Db, options: MigrateOptions): string[] {
  const migrations = options.migrations ?? MIGRATIONS;
  if (!tableExists(db, "schema_migrations")) {
    if (hasAnyTable(db)) {
      // 舊庫：先補齊到基線，再把基線記為已套用，之後只跑基線以後的遷移。
      upgradeLegacy(db, options.legacySeedStores);
      withSyncTx(db, () => {
        db.exec(TRACKING_SCHEMA);
        db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(BASELINE, Date.now());
      });
    } else {
      db.exec(TRACKING_SCHEMA);
    }
  }
  const applied = new Set((db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>).map((r) => r.name));
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    withSyncTx(db, () => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(migration.name, Date.now());
    });
    ran.push(migration.name);
  }
  return ran;
}
