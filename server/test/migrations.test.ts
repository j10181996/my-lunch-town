import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { upgradeLegacy } from "../schema/legacy";
import { BASELINE, MIGRATIONS, migrate, type Migration } from "../schema/migrate";

const noSeed = () => [];

/** 每張表與索引的建立 SQL，去掉空白與引號後比對：涵蓋欄位順序、型別、預設值、CHECK 與外鍵。 */
function schemaOf(db: DatabaseSync) {
  const rows = db.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name <> 'schema_migrations' ORDER BY type, name",
  ).all() as Array<{ type: string; name: string; sql: string }>;
  return Object.fromEntries(rows.map((r) => [`${r.type}:${r.name}`, r.sql.replace(/\s+/g, "").replaceAll('"', "")]));
}

const appliedOf = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM schema_migrations ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);

describe("版本化遷移", () => {
  it("基線與舊庫升級後的 schema 完全一致", () => {
    // 只比對基線本身；之後新增的遷移不影響這項比對。
    const fresh = new DatabaseSync(":memory:");
    migrate(fresh, { legacySeedStores: noSeed, migrations: MIGRATIONS.filter((m) => m.name === BASELINE) });
    const legacy = new DatabaseSync(":memory:");
    upgradeLegacy(legacy, noSeed);
    // 基線有 19 張表與 1 個索引；之後的遷移只會增加。
    expect(Object.keys(schemaOf(fresh)).length).toBeGreaterThanOrEqual(20);
    expect(schemaOf(fresh)).toEqual(schemaOf(legacy));
  });

  it("新庫套用基線並記錄；重跑不再套用", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrate(db, { legacySeedStores: noSeed })).toEqual([BASELINE]);
    expect(migrate(db, { legacySeedStores: noSeed })).toEqual([]);
    expect(appliedOf(db)).toEqual([BASELINE]);
  });

  it("沒有遷移紀錄的舊庫補齊到基線、保留資料，並把基線記為已套用", () => {
    const old = new DatabaseSync(":memory:");
    old.exec(`CREATE TABLE rooms (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, catalog_version TEXT NOT NULL,
      is_sample INTEGER NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER
    ); INSERT INTO rooms VALUES ('old', '舊團', 'closed', 'v1', 0, 9, 100, 200);`);
    expect(migrate(old, { legacySeedStores: noSeed })).toEqual([]);
    expect(appliedOf(old)).toEqual([BASELINE]);
    const fresh = new DatabaseSync(":memory:");
    migrate(fresh, { legacySeedStores: noSeed });
    expect(Object.keys(schemaOf(old)).sort()).toEqual(Object.keys(schemaOf(fresh)).sort());
    expect(old.prepare("SELECT id, title, revision FROM rooms").get()).toEqual({ id: "old", title: "舊團", revision: 9 });
  });

  it("舊庫補外送欄位時以傳入的種子回填，不需要讀檔", () => {
    const old = new DatabaseSync(":memory:");
    old.exec(`CREATE TABLE stores (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, style_key TEXT NOT NULL, lot_index INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL, owner_session_id TEXT, manage_key_hash TEXT UNIQUE, is_sample INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    ); INSERT INTO stores VALUES ('s1', '店', 'bento', 0, 'open', NULL, NULL, 0, 1);`);
    const delivery = { enabled: true, tiers: [{ maxKm: 2, minTwd: 300 }] };
    migrate(old, { legacySeedStores: () => [{ id: "s1", delivery }, { id: "missing", delivery }] });
    expect(JSON.parse((old.prepare("SELECT delivery_json FROM stores").get() as { delivery_json: string }).delivery_json)).toEqual(delivery);
  });

  it("新遷移依序套用一次；舊庫在基線之後也會套用", () => {
    const order: string[] = [];
    const list: Migration[] = [
      ...MIGRATIONS,
      { name: "0002_a", up: (db) => { order.push("a"); db.exec("CREATE TABLE extra_a (id TEXT PRIMARY KEY)"); } },
      { name: "0003_b", up: (db) => { order.push("b"); db.exec("ALTER TABLE extra_a ADD COLUMN note TEXT"); } },
    ];
    const fresh = new DatabaseSync(":memory:");
    expect(migrate(fresh, { legacySeedStores: noSeed, migrations: list })).toEqual([BASELINE, "0002_a", "0003_b"]);
    expect(migrate(fresh, { legacySeedStores: noSeed, migrations: list })).toEqual([]);
    expect(order).toEqual(["a", "b"]);

    const old = new DatabaseSync(":memory:");
    old.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
    expect(migrate(old, { legacySeedStores: noSeed, migrations: list })).toEqual(["0002_a", "0003_b"]);
    expect(appliedOf(old)).toEqual([BASELINE, "0002_a", "0003_b"]);
  });

  it("遷移失敗時整筆回滾、不記錄，修正後下次開啟會重試", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, { legacySeedStores: noSeed });
    const broken: Migration = { name: "0002_broken", up: (d) => { d.exec("CREATE TABLE half_done (id TEXT)"); throw new Error("boom"); } };
    expect(() => migrate(db, { legacySeedStores: noSeed, migrations: [...MIGRATIONS, broken] })).toThrow("boom");
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
    expect(appliedOf(db)).toEqual([BASELINE]);
    const fixed: Migration = { name: "0002_broken", up: (d) => d.exec("CREATE TABLE half_done (id TEXT)") };
    expect(migrate(db, { legacySeedStores: noSeed, migrations: [...MIGRATIONS, fixed] })).toEqual(["0002_broken"]);
  });
});
