import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import taichung from "../../shared/catalog/stores.taichung.json";
import type { DeliveryRules, GeoPoint } from "../../shared/contracts";
import { openDb, SAMPLE_SEED, TAICHUNG_SEED } from "../db";
import { evaluateStoreDelivery, storeDistanceKm } from "../../shared/delivery";
import { haversineKm, mapsUrl, parseGeoText, validateGeoPoint } from "../../shared/geo";
import { migrateGeoLocation } from "../geo-schema";

describe("真實經緯度純函式", () => {
  it("haversine 直線距離四捨五入到 0.1 公里", () => {
    const a = { lat: 24, lng: 120 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, { lat: 24.01, lng: 120 })).toBe(1.1);
    // 經度一度的長度隨緯度縮短：cos(24°) ≈ 0.9135
    expect(haversineKm(a, { lat: 24, lng: 120.01 })).toBe(1);
    expect(haversineKm({ lat: 24.01, lng: 120 }, a)).toBe(1.1);
  });

  it.each([
    ["24.147736, 120.673648", { lat: 24.147736, lng: 120.673648 }],
    ["24.147736，120.673648", { lat: 24.147736, lng: 120.673648 }],
    [" 24.1 120.6 ", { lat: 24.1, lng: 120.6 }],
    ["-33.8688,151.2093", { lat: -33.8688, lng: 151.2093 }],
    ["https://www.google.com/maps/place/x/@24.1477363,120.6736482,17z", { lat: 24.147736, lng: 120.673648 }],
    ["https://www.google.com/maps?q=24.15,120.65", { lat: 24.15, lng: 120.65 }],
  ])("解析貼上的座標 %s", (text, expected) => {
    expect(parseGeoText(text)).toEqual(expected);
  });

  it.each(["", "台中市西區", "24.1", "91, 120", "24, 181", "abc, def"])("無法解析回 null：%s", (text) => {
    expect(parseGeoText(text)).toBeNull();
  });

  it("驗證範圍並四捨五入到 6 位，錯誤帶 INVALID_INPUT", () => {
    expect(validateGeoPoint({ lat: 24.1234567, lng: 120.9876543 })).toEqual({ lat: 24.123457, lng: 120.987654 });
    for (const bad of [null, {}, { lat: "24", lng: 120 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: NaN, lng: 0 }]) {
      expect(() => validateGeoPoint(bad)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    }
    expect(mapsUrl({ lat: 24.15, lng: 120.65 })).toBe("https://www.google.com/maps?q=24.15,120.65");
  });
});

describe("依團與店家位置判斷外送", () => {
  const rules: DeliveryRules = { enabled: true, tiers: [{ maxKm: 1, minTwd: 100 }] };
  const here = { lat: 24, lng: 120 };
  const store = { door: { x: 0, y: 0 }, delivery: rules, location: { lat: 24.005, lng: 120 } };

  it("新團用經緯度；舊團只有街區座標時沿用像素換算", () => {
    expect(storeDistanceKm({ deliveryLocation: here }, store)).toBe(0.6);
    expect(evaluateStoreDelivery({ deliveryLocation: here }, store, 100)).toEqual({ kind: "ok", distanceKm: 0.6, minTwd: 100 });
    expect(evaluateStoreDelivery({ deliveryPoint: { x: 0, y: 0 } }, store, 100)).toEqual({ kind: "ok", distanceKm: 0, minTwd: 100 });
  });

  it("判斷順序：未選位置 → 未設規則 → 只自取 → 店家未設位置 → 距離與門檻", () => {
    expect(evaluateStoreDelivery({}, store, 100).kind).toBe("no-point");
    expect(evaluateStoreDelivery({ deliveryLocation: here }, { ...store, delivery: null, location: null }, 100).kind).toBe("not-set");
    expect(evaluateStoreDelivery({ deliveryLocation: here }, { ...store, delivery: { enabled: false, tiers: [] }, location: null }, 100).kind)
      .toBe("pickup-only");
    expect(evaluateStoreDelivery({ deliveryLocation: here }, { ...store, location: null }, 100)).toEqual({ kind: "no-store-location" });
    expect(storeDistanceKm({ deliveryLocation: here }, { ...store, location: null })).toBeNull();
    expect(evaluateStoreDelivery({ deliveryLocation: here }, { ...store, location: { lat: 24.02, lng: 120 } }, 100).kind)
      .toBe("out-of-range");
  });
});

describe("台中店家位置回填", () => {
  const seeded = new Map((taichung.stores as Array<{ id: string; location?: GeoPoint }>).map((s) => [s.id, s.location]));
  const locations = (db: DatabaseSync) => new Map((db.prepare("SELECT id, lat, lng FROM stores").all() as Array<{ id: string; lat: number | null; lng: number | null }>)
    .map((r) => [r.id, r.lat == null ? null : { lat: r.lat, lng: r.lng! }]));

  it("種子每家都有台中範圍內的座標", () => {
    expect(seeded.size).toBe(14);
    for (const [id, p] of seeded) {
      expect(p, id).toBeDefined();
      expect(p!.lat).toBeGreaterThan(24.1);
      expect(p!.lat).toBeLessThan(24.2);
      expect(p!.lng).toBeGreaterThan(120.6);
      expect(p!.lng).toBeLessThan(120.7);
    }
  });

  it("新庫與升級前的舊庫都補上位置；只補一次，店家清除後不會被填回", () => {
    const dir = mkdtempSync(join(tmpdir(), "lt-geo-"));
    try {
      const path = join(dir, "db.sqlite");
      const db = openDb(path, TAICHUNG_SEED);
      try {
        const got = locations(db);
        for (const [id, p] of seeded) expect(got.get(id), id).toEqual(p);
        db.prepare("UPDATE stores SET lat = NULL, lng = NULL WHERE id = 'store-chingfan'").run();
        // 模擬升級前的庫：清掉回填紀錄與另一家的位置
        db.prepare("UPDATE stores SET lat = NULL, lng = NULL WHERE id = 'store-musi'").run();
        db.prepare("DELETE FROM location_imports WHERE store_id = 'store-musi'").run();
      } finally { db.close(); }
      const reopened = openDb(path, TAICHUNG_SEED);
      try {
        const got = locations(reopened);
        expect(got.get("store-chingfan")).toBeNull();
        expect(got.get("store-musi")).toEqual(seeded.get("store-musi"));
      } finally { reopened.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("虛構種子不混入真實店家位置", () => {
    const db = openDb(":memory:", SAMPLE_SEED);
    try {
      expect([...locations(db).keys()].some((id) => seeded.has(id))).toBe(false);
      expect(db.prepare("SELECT COUNT(*) AS n FROM location_imports").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });
});

it("經緯度遷移可重複執行，保留既有資料", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE stores (id TEXT); CREATE TABLE room_stores (store_id TEXT); CREATE TABLE rooms (id TEXT); INSERT INTO stores VALUES ('s')");
    migrateGeoLocation(db);
    db.prepare("UPDATE stores SET lat = 24.1, lng = 120.6").run();
    migrateGeoLocation(db);
    expect(db.prepare("SELECT * FROM stores").get()).toEqual({ id: "s", lat: 24.1, lng: 120.6 });
    expect(db.prepare("PRAGMA table_info(rooms)").all().map((c) => c.name)).toEqual(["id", "delivery_lat", "delivery_lng"]);
    expect(db.prepare("PRAGMA table_info(room_stores)").all().map((c) => c.name)).toEqual(["store_id", "lat", "lng"]);
  } finally { db.close(); }
});
