import { MEAL_IMAGES_SCHEMA } from "./images/schema";
import { migrateTaichungExpansion } from "./catalog/taichung-expansion";
import { PARTY_SCHEMA } from "./rooms/party-schema";
import { migrateStoreHours } from "./store-hours-schema";
import { migrateDeadline } from "./rooms/deadline";
import { SOCIAL_SCHEMA } from "./rooms/social-schema";
import { hashKey, withWriteTx } from "./db-shared";
import { PAYMENT_REMINDER_SCHEMA } from "./rooms/payment-schema";
export { hashKey, withWriteTx, AppError, err } from "./db-shared";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DeliveryRules } from "../shared/contracts";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  style_key TEXT NOT NULL,
  lot_index INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('open','resting')),
  owner_session_id TEXT,
  manage_key_hash TEXT UNIQUE,
  is_sample INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_twd INTEGER NOT NULL CHECK (price_twd >= 0),
  image_key TEXT NOT NULL,
  available INTEGER NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  catalog_version TEXT NOT NULL,
  is_sample INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS room_stores (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  style_key TEXT NOT NULL,
  lot_index INTEGER NOT NULL,
  door_x REAL NOT NULL,
  door_y REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (room_id, store_id)
);
CREATE TABLE IF NOT EXISTS room_meals (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  meal_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_twd INTEGER NOT NULL,
  image_key TEXT NOT NULL,
  available INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (room_id, meal_id)
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  session_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  display_suffix INTEGER NOT NULL,
  avatar_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','participant')),
  joined_seq INTEGER NOT NULL,
  UNIQUE (room_id, session_id)
);
CREATE TABLE IF NOT EXISTS order_items (
  room_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price_twd INTEGER NOT NULL,
  PRIMARY KEY (room_id, member_id, meal_id)
);
CREATE TABLE IF NOT EXISTS store_orders (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  store_name TEXT NOT NULL,
  room_title TEXT NOT NULL,
  owner_nickname TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','accepted','rejected','preparing','ready')),
  reject_reason TEXT,
  items_json TEXT NOT NULL,
  people_json TEXT NOT NULL,
  total_quantity INTEGER NOT NULL,
  total_twd INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (room_id, store_id)
);
CREATE TABLE IF NOT EXISTS processed_requests (
  scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (scope, actor_id, request_id)
);
`;

const here = dirname(fileURLToPath(import.meta.url));
/** 規格附的虛構示範店家（測試與 410 元驗收資料使用）。 */
export const SAMPLE_SEED = join(here, "../shared/catalog/seed.json");
/** 台中真實店家（由使用者的菜單筆記人工整理）。正式啟動預設使用。 */
export const TAICHUNG_SEED = join(here, "../shared/catalog/stores.taichung.json");

/** seedFile：空庫建立店家；既有庫僅在首次增欄遷移時補入種子外送規則。 */
export function openDb(path: string, seedFile: string = SAMPLE_SEED): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  db.exec(SOCIAL_SCHEMA);
  db.exec(MEAL_IMAGES_SCHEMA);
  db.exec(PARTY_SCHEMA);
  migrateDelivery(db, seedFile);
  migratePayment(db);
  seedIfEmpty(db, seedFile);
  migrateStoreHours(db);
  migrateTaichungExpansion(db);
  migrateDeadline(db);
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
  }>;
  meals: Array<{ id: string; storeId: string; name: string; priceTwd: number; imageAssetKey: string; available: boolean; tags: string[] }>;
}

const SEED_STYLE: Record<string, string> = {
  "interior-bento": "bento",
  "interior-noodle": "noodle",
  "interior-vegetarian": "veg",
};

/** 新舊資料庫都由同一套增欄遷移補齊；回填與 DDL 同交易，失敗可安全重試。 */
function migrateDelivery(db: Db, seedFile: string) {
  withWriteTx(db, () => {
    const columns: Record<string, Array<[string, string]>> = {
      stores: [["delivery_json", "TEXT"]],
      rooms: [["delivery_x", "REAL"], ["delivery_y", "REAL"]],
      room_stores: [["delivery_json", "TEXT"]],
      store_orders: [
        ["fulfillment", "TEXT NOT NULL DEFAULT 'pickup'"],
        ["distance_km", "REAL"],
        ["delivery_min_twd", "INTEGER"],
      ],
    };
    let backfill = false;
    for (const [table, additions] of Object.entries(columns)) {
      const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      for (const [name, type] of additions) {
        if (existing.some((c) => c.name === name)) continue;
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
        if (table === "stores" && name === "delivery_json") backfill = true;
      }
    }
    if (backfill) {
      const seed = JSON.parse(readFileSync(seedFile, "utf8")) as SeedFile;
      const update = db.prepare("UPDATE stores SET delivery_json = ? WHERE id = ? AND delivery_json IS NULL");
      for (const store of seed.stores) {
        if (store.delivery) update.run(JSON.stringify(store.delivery), store.id);
      }
    }
  });
}

function seedIfEmpty(db: Db, seedFile: string) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM stores").get() as { n: number };
  if (row.n > 0) return;
  const seed = JSON.parse(readFileSync(seedFile, "utf8")) as SeedFile;
  const isSample = seed.isSample === false ? 0 : 1;
  const now = Date.now();
  const insStore = db.prepare(
    `INSERT INTO stores
      (id, name, style_key, lot_index, status, owner_session_id, manage_key_hash, is_sample, updated_at, delivery_json)
      VALUES (?, ?, ?, ?, 'open', NULL, ?, ?, ?, ?)`,
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
      ),
    );
    seed.meals.forEach((m, i) =>
      insMeal.run(m.id, m.storeId, m.name, m.priceTwd, m.imageAssetKey, m.available ? 1 : 0, JSON.stringify(m.tags), i),
    );
  });
}

/** 舊庫與新庫均以增欄遷移補齊，不回填或覆蓋既有資料。 */
function migratePayment(db: Db) {
  withWriteTx(db, () => {
    const existing = db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>;
    for (const [name, type] of [["payment_json", "TEXT"], ["payment_sent_at", "INTEGER"]]) {
      if (!existing.some((c) => c.name === name)) db.exec(`ALTER TABLE rooms ADD COLUMN ${name} ${type}`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS member_payments (
      room_id TEXT NOT NULL REFERENCES rooms(id),
      member_id TEXT NOT NULL REFERENCES members(id),
      status TEXT NOT NULL CHECK (status IN ('reported','confirmed')),
      reported_at INTEGER,
      confirmed_at INTEGER,
      PRIMARY KEY (room_id, member_id)
    )`);
    db.exec(PAYMENT_REMINDER_SCHEMA);
  });
}
