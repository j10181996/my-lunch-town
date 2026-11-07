import type { DeliveryRules } from "../../shared/contracts";
import { migrateTaichungExpansionSchema } from "../catalog/taichung-expansion";
import type { Db } from "../db";
import { withWriteTx } from "../db-shared";
import { migrateDeliveryAddress } from "../delivery-address-schema";
import { migrateGeoLocation, migrateLocationImports } from "../geo-schema";
import { MEAL_IMAGES_SCHEMA } from "../images/schema";
import { migrateMealOptions } from "../orders/options-schema";
import { migrateDeadline } from "../rooms/deadline";
import { PARTY_SCHEMA } from "../rooms/party-schema";
import { PAYMENT_REMINDER_SCHEMA } from "../rooms/payment-schema";
import { SOCIAL_SCHEMA } from "../rooms/social-schema";
import { migrateStoreHours } from "../store-hours-schema";
import { STORE_LIKES_SCHEMA } from "../stores/likes-schema";

/** 舊庫外送回填所需的種子店家欄位。 */
export interface LegacySeedStore { id: string; delivery?: DeliveryRules }

/**
 * 導入版本化遷移之前的資料庫升級路徑（已凍結）。
 * 沒有 schema_migrations 但已有業務表的資料庫（Node 的 data/、已部署的 D1 image）
 * 依原本順序跑完各個可重跑的增欄遷移，結果與 0001_baseline 相同。
 * 每一步各自一個交易，中途失敗可以安全重跑。之後的 schema 變更不要加在這裡。
 */
export function upgradeLegacy(db: Db, seedStores: () => LegacySeedStore[]) {
  db.exec(LEGACY_BASE_SCHEMA);
  db.exec(SOCIAL_SCHEMA);
  db.exec(MEAL_IMAGES_SCHEMA);
  db.exec(PARTY_SCHEMA);
  db.exec(STORE_LIKES_SCHEMA);
  migrateDelivery(db, seedStores);
  migratePayment(db);
  migrateMealOptions(db);
  migrateGeoLocation(db);
  migrateStoreHours(db);
  migrateDeadline(db);
  migrateDeliveryAddress(db);
  migrateTaichungExpansionSchema(db);
  migrateLocationImports(db);
}

/** 最早的業務表定義；舊庫靠 IF NOT EXISTS 補上缺少的表，欄位由後續增欄遷移補齊。 */
const LEGACY_BASE_SCHEMA = `
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

/** 外送欄位；只在 stores.delivery_json 這次才新增時，從種子補入外送規則。回填與 DDL 同交易。 */
function migrateDelivery(db: Db, seedStores: () => LegacySeedStore[]) {
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
      const update = db.prepare("UPDATE stores SET delivery_json = ? WHERE id = ? AND delivery_json IS NULL");
      for (const store of seedStores()) {
        if (store.delivery) update.run(JSON.stringify(store.delivery), store.id);
      }
    }
  });
}

/** 收款欄位與表；不回填或覆蓋既有資料。 */
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
