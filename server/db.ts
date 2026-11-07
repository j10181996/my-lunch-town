import { migrateTaichungExpansion } from "./catalog/taichung-expansion";
import { backfillSeedLocations } from "./geo-schema";
import { hashKey, withWriteTx } from "./db-shared";
import { migrate } from "./schema/migrate";
export { hashKey, withWriteTx, AppError, err } from "./db-shared";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DeliveryRules, GeoPoint } from "../shared/contracts";

export type Db = DatabaseSync;

const here = dirname(fileURLToPath(import.meta.url));
/** 規格附的虛構示範店家（測試與 410 元驗收資料使用）。 */
export const SAMPLE_SEED = join(here, "../shared/catalog/seed.json");
/** 台中真實店家（由使用者的菜單筆記人工整理）。正式啟動預設使用。 */
export const TAICHUNG_SEED = join(here, "../shared/catalog/stores.taichung.json");

/**
 * 開啟資料庫並升級到最新 schema（schema/migrate.ts），再匯入種子資料。
 * seedFile：空庫建立店家；導入版本化之前的舊庫，在補上外送欄位時也從這裡回填外送規則。
 */
export function openDb(path: string, seedFile: string = SAMPLE_SEED): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db, { legacySeedStores: () => readSeed(seedFile).stores });
  seedIfEmpty(db, seedFile);
  // 以下是資料匯入，不是 schema 變更：可重複執行，Worker 的 openSnapshot 也會呼叫。
  migrateTaichungExpansion(db);
  backfillSeedLocations(db); // 須在店家匯入之後
  return db;
}

interface SeedFile {
  isSample?: boolean;
  stores: Array<{
    id: string;
    name: string;
    interiorAssetKey?: string;
    styleKey?: string;
    lotIndex?: number;
    delivery?: DeliveryRules;
    location?: GeoPoint;
  }>;
  meals: Array<{ id: string; storeId: string; name: string; priceTwd: number; imageAssetKey: string; available: boolean; tags: string[] }>;
}

const readSeed = (seedFile: string) => JSON.parse(readFileSync(seedFile, "utf8")) as SeedFile;

const SEED_STYLE: Record<string, string> = {
  "interior-bento": "bento",
  "interior-noodle": "noodle",
  "interior-vegetarian": "veg",
};

function seedIfEmpty(db: Db, seedFile: string) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM stores").get() as { n: number };
  if (row.n > 0) return;
  const seed = readSeed(seedFile);
  const isSample = seed.isSample === false ? 0 : 1;
  const now = Date.now();
  const insStore = db.prepare(
    `INSERT INTO stores
      (id, name, style_key, lot_index, status, owner_session_id, manage_key_hash, is_sample, updated_at, delivery_json, lat, lng)
      VALUES (?, ?, ?, ?, 'open', NULL, ?, ?, ?, ?, ?, ?)`,
  );
  // 種子店家的管理碼固定為 demo-{storeId}，方便展示時認領；之後自行開的店為隨機碼。
  const insMeal = db.prepare(
    "INSERT INTO meals (id, store_id, name, price_twd, image_key, available, tags_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  withWriteTx(db, () => {
    seed.stores.forEach((s, i) =>
      insStore.run(
        s.id,
        s.name,
        s.styleKey ?? SEED_STYLE[s.interiorAssetKey ?? ""] ?? "bento",
        s.lotIndex ?? i,
        hashKey(`demo-${s.id}`),
        isSample,
        now,
        s.delivery ? JSON.stringify(s.delivery) : null,
        s.location?.lat ?? null,
        s.location?.lng ?? null,
      ),
    );
    seed.meals.forEach((m, i) =>
      insMeal.run(m.id, m.storeId, m.name, m.priceTwd, m.imageAssetKey, m.available ? 1 : 0, JSON.stringify(m.tags), i),
    );
  });
}
