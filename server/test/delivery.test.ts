import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeliveryRules } from "../../shared/contracts";
import {
  describeDelivery,
  distanceKm,
  evaluateDelivery,
  fulfillmentOf,
  validateDeliveryRules,
} from "../../shared/delivery";
import { STREET_H, STREET_W } from "../../shared/town";
import { openDb, TAICHUNG_SEED } from "../db";

const rules: DeliveryRules = {
  enabled: true,
  tiers: [{ maxKm: 2, minTwd: 300 }, { maxKm: 3, minTwd: 500 }],
};

describe("外送純函式", () => {
  it("正規化座標換回世界像素，依兩軸算直線距離並四捨五入到 0.1 公里", () => {
    const origin = { x: 0, y: 0 };
    expect(distanceKm(origin, origin)).toBe(0);
    expect(distanceKm(origin, { x: 300 / STREET_W, y: 400 / STREET_H })).toBe(2);
    expect(distanceKm(origin, { x: 0.5, y: 0 })).toBe(1.9);
    expect(distanceKm(origin, { x: 0, y: 0.5 })).toBe(1.2);
    expect(distanceKm(origin, { x: 137.5 / STREET_W, y: 0 })).toBe(0.6);
    expect(distanceKm({ x: 137 / STREET_W, y: 0 }, origin)).toBe(0.5);
  });

  it("所有結果與優先序、中文說明、送單方式", () => {
    const cases = [
      { result: evaluateDelivery(null, null, 100), expected: { kind: "no-point" } },
      { result: evaluateDelivery(undefined, 1, 100), expected: { kind: "not-set" } },
      { result: evaluateDelivery({ enabled: false, tiers: [] }, 1, 100), expected: { kind: "pickup-only" } },
      { result: evaluateDelivery(rules, 3.1, 9999), expected: { kind: "out-of-range", distanceKm: 3.1, maxKm: 3 } },
      { result: evaluateDelivery(rules, 1.8, 250),
        expected: { kind: "below-min", distanceKm: 1.8, minTwd: 300, shortTwd: 50 } },
      { result: evaluateDelivery(rules, 1.8, 300), expected: { kind: "ok", distanceKm: 1.8, minTwd: 300 } },
    ];
    for (const { result, expected } of cases) {
      expect(result).toEqual(expected);
      expect(fulfillmentOf(result)).toBe(result.kind === "ok" ? "delivery" : "pickup");
      expect(describeDelivery(result).length).toBeGreaterThan(0);
    }
    expect(evaluateDelivery(null, 1, 300)).toEqual({ kind: "not-set" });
    expect(describeDelivery(evaluateDelivery(rules, 1.8, 250))).toContain("還差 $50");
  });

  it("第一個包含邊界的分段勝出；零門檻可外送", () => {
    expect(evaluateDelivery(rules, 2, 300)).toEqual({ kind: "ok", distanceKm: 2, minTwd: 300 });
    expect(evaluateDelivery(rules, 2.1, 300))
      .toEqual({ kind: "below-min", distanceKm: 2.1, minTwd: 500, shortTwd: 200 });
    expect(evaluateDelivery(rules, 3, 500)).toEqual({ kind: "ok", distanceKm: 3, minTwd: 500 });
    expect(evaluateDelivery({ enabled: true, tiers: [{ maxKm: 1, minTwd: 0 }] }, 0, 0).kind).toBe("ok");
  });

  it("驗證會正規化並接受合法邊界、關閉時保留分段", () => {
    expect(validateDeliveryRules({ ...rules, ignored: true })).toEqual(rules);
    expect(validateDeliveryRules({ enabled: false, tiers: [] })).toEqual({ enabled: false, tiers: [] });
    expect(validateDeliveryRules({ ...rules, enabled: false })).toEqual({ ...rules, enabled: false });
    expect(validateDeliveryRules({ enabled: true, tiers: [{ maxKm: 0.1, minTwd: 0 }, { maxKm: 20, minTwd: 99999 }] }))
      .toEqual({ enabled: true, tiers: [{ maxKm: 0.1, minTwd: 0 }, { maxKm: 20, minTwd: 99999 }] });
  });

  it.each([
    null, {}, { enabled: "true", tiers: [] }, { enabled: true, tiers: [] },
    { enabled: true, tiers: Array.from({ length: 6 }, (_, i) => ({ maxKm: i + 1, minTwd: 0 })) },
    { enabled: true, tiers: [{ maxKm: 2, minTwd: 1 }, { maxKm: 2, minTwd: 2 }] },
    { enabled: true, tiers: [{ maxKm: 2, minTwd: 1 }, { maxKm: 1, minTwd: 2 }] },
    ...[-1, 0, 20.1, 1.11, NaN, Infinity, "2"].map((maxKm) => ({ enabled: true, tiers: [{ maxKm, minTwd: 0 }] })),
    ...[-1, 1.1, 100000, NaN, "300"].map((minTwd) => ({ enabled: true, tiers: [{ maxKm: 2, minTwd }] })),
    { enabled: true, tiers: [null] },
  ])("拒絕非法規則 %#", (input) => {
    expect(() => validateDeliveryRules(input)).toThrow();
    try { validateDeliveryRules(input); } catch (e) {
      expect(e).toMatchObject({ code: "INVALID_INPUT" });
    }
  });
});

it("舊 schema 增欄與種子回填只做一次，保留舊資料與既有訂單", () => {
  const dir = mkdtempSync(join(tmpdir(), "lt-delivery-"));
  const path = join(dir, "old.sqlite");
  // 上一版四張表的完整欄位，刻意不含任何本輪新增欄位。
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE stores (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, style_key TEXT NOT NULL, lot_index INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('open','resting')), owner_session_id TEXT,
      manage_key_hash TEXT UNIQUE, is_sample INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
    );
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','closed')),
      catalog_version TEXT NOT NULL, is_sample INTEGER NOT NULL, revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL, closed_at INTEGER
    );
    CREATE TABLE room_stores (
      room_id TEXT NOT NULL REFERENCES rooms(id), store_id TEXT NOT NULL, name TEXT NOT NULL,
      style_key TEXT NOT NULL, lot_index INTEGER NOT NULL, door_x REAL NOT NULL, door_y REAL NOT NULL,
      sort_order INTEGER NOT NULL, PRIMARY KEY(room_id, store_id)
    );
    CREATE TABLE store_orders (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), store_id TEXT NOT NULL REFERENCES stores(id),
      store_name TEXT NOT NULL, room_title TEXT NOT NULL, owner_nickname TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('sent','accepted','rejected','preparing','ready')), reject_reason TEXT,
      items_json TEXT NOT NULL, people_json TEXT NOT NULL, total_quantity INTEGER NOT NULL,
      total_twd INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(room_id, store_id)
    );
    INSERT INTO stores VALUES ('store-zhuangzhuang', '原有名稱', 'drink', 0, 'open', 'owner', 'hash', 0, 123);
    INSERT INTO rooms VALUES ('r-old', '舊團', 'closed', 'old-version', 0, 7, 10, 20);
    INSERT INTO room_stores VALUES ('r-old', 'store-zhuangzhuang', '舊店名', 'drink', 0, 0.4, 0.5, 0);
    INSERT INTO store_orders VALUES (
      'so-old', 'r-old', 'store-zhuangzhuang', '舊店名', '舊團', '阿凱', 'accepted', NULL,
      '[]', '[]', 1, 300, 10, 20
    );
  `);
  const before = {
    store: old.prepare("SELECT * FROM stores").get()!,
    room: old.prepare("SELECT * FROM rooms").get()!,
    frozen: old.prepare("SELECT * FROM room_stores").get()!,
    order: old.prepare("SELECT * FROM store_orders").get()!,
  };
  old.close();
  try {
    const db = openDb(path, TAICHUNG_SEED);
    try {
      for (const [table, names] of Object.entries({
        stores: ["delivery_json"], rooms: ["delivery_x", "delivery_y"], room_stores: ["delivery_json"],
        store_orders: ["fulfillment", "distance_km", "delivery_min_twd"],
      })) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
        expect(columns).toEqual(expect.arrayContaining(names));
      }
      const seeded = JSON.parse(readFileSync(TAICHUNG_SEED, "utf8")).stores
        .find((s: { id: string }) => s.id === "store-zhuangzhuang");
      const store = db.prepare("SELECT * FROM stores").get()!;
      expect(store).toMatchObject(before.store);
      expect(JSON.parse(store.delivery_json as string)).toEqual(seeded.delivery);
      expect(db.prepare("SELECT * FROM rooms").get())
        .toEqual({ ...before.room, delivery_x: null, delivery_y: null, payment_json: null, payment_sent_at: null });
      expect(db.prepare("SELECT * FROM room_stores").get())
        .toEqual({ ...before.frozen, delivery_json: null, order_deadline_at: null });
      expect(db.prepare("SELECT * FROM store_orders").get())
        .toEqual({ ...before.order, fulfillment: "pickup", distance_km: null, delivery_min_twd: null });
      // 舊店完整保留，另由台中種子升級補入本批八家。
      expect(db.prepare("SELECT COUNT(*) AS n FROM stores").get()).toMatchObject({ n: 9 });
      db.exec("UPDATE stores SET delivery_json = NULL");
    } finally { db.close(); }
    const reopened = openDb(path, TAICHUNG_SEED);
    try {
      expect(reopened.prepare("SELECT delivery_json FROM stores").get()).toEqual({ delivery_json: null });
    } finally { reopened.close(); }
    const fresh = openDb(":memory:", TAICHUNG_SEED);
    try {
      expect(JSON.parse(fresh.prepare("SELECT delivery_json FROM stores WHERE id = 'store-zhuangzhuang'")
        .get()!.delivery_json as string)).toEqual({
        enabled: true,
        tiers: [
          { maxKm: 2, minTwd: 300 }, { maxKm: 3, minTwd: 500 },
          { maxKm: 4, minTwd: 800 }, { maxKm: 5, minTwd: 1200 },
        ],
      });
      expect(fresh.prepare("SELECT COUNT(*) AS n FROM stores WHERE delivery_json IS NOT NULL").get())
        .toMatchObject({ n: 1 });
    } finally { fresh.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
