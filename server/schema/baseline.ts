/**
 * 版本化遷移的基線（0001_baseline）：導入版本化之前，所有增欄遷移套用完畢後的完整 schema。
 * 只用於全新的資料庫；舊資料庫由 legacy.ts 的可重跑升級補齊到同一狀態。
 * 欄位順序刻意與舊庫升級後一致，migrations.test.ts 會逐表比對兩者。
 * 這份內容已凍結：之後的 schema 變更一律新增遷移到 migrate.ts，不要改這裡。
 */
export const BASELINE_SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  style_key TEXT NOT NULL,
  lot_index INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('open','resting')),
  owner_session_id TEXT,
  manage_key_hash TEXT UNIQUE,
  is_sample INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  delivery_json TEXT,
  lat REAL,
  lng REAL,
  hours_json TEXT,
  address TEXT
);
CREATE TABLE meals (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_twd INTEGER NOT NULL CHECK (price_twd >= 0),
  image_key TEXT NOT NULL,
  available INTEGER NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL,
  options_json TEXT
);
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  catalog_version TEXT NOT NULL,
  is_sample INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  delivery_x REAL,
  delivery_y REAL,
  payment_json TEXT,
  payment_sent_at INTEGER,
  delivery_lat REAL,
  delivery_lng REAL,
  deadline_at INTEGER,
  delivery_address TEXT
);
CREATE TABLE room_stores (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  style_key TEXT NOT NULL,
  lot_index INTEGER NOT NULL,
  door_x REAL NOT NULL,
  door_y REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  delivery_json TEXT,
  lat REAL,
  lng REAL,
  order_deadline_at INTEGER,
  PRIMARY KEY (room_id, store_id)
);
CREATE TABLE room_meals (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  meal_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_twd INTEGER NOT NULL,
  image_key TEXT NOT NULL,
  available INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  options_json TEXT,
  PRIMARY KEY (room_id, meal_id)
);
CREATE TABLE members (
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
CREATE TABLE order_items (
  room_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  option_key TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price_twd INTEGER NOT NULL,
  PRIMARY KEY (room_id, member_id, meal_id, option_key, note)
);
CREATE TABLE store_orders (
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
  fulfillment TEXT NOT NULL DEFAULT 'pickup',
  distance_km REAL,
  delivery_min_twd INTEGER,
  delivery_address TEXT,
  UNIQUE (room_id, store_id)
);
CREATE TABLE processed_requests (
  scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (scope, actor_id, request_id)
);
CREATE TABLE member_social (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_emote_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE meal_images (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  object_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE member_ready (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE
);
CREATE TABLE room_celebrations (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  members_json TEXT NOT NULL
);
CREATE TABLE store_likes (
  room_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, store_id, member_id)
);
CREATE INDEX store_likes_by_store ON store_likes (store_id, created_at);
CREATE TABLE member_payments (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK (status IN ('reported','confirmed')),
  reported_at INTEGER,
  confirmed_at INTEGER,
  PRIMARY KEY (room_id, member_id)
);
CREATE TABLE payment_reminders (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id),
  reminded_at INTEGER NOT NULL
);
CREATE TABLE catalog_imports (
  store_id TEXT PRIMARY KEY,
  version TEXT NOT NULL
);
CREATE TABLE location_imports (
  store_id TEXT PRIMARY KEY
);
`;
