import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import seed from "../../shared/catalog/stores.taichung.json";
import { LOTS, MEAL_ART_KEYS, STREET_H, STREET_W, lotDoor } from "../../shared/town";
import { openDb, SAMPLE_SEED, TAICHUNG_SEED, type Db } from "../db";
import { EXPANSION_IDS, migrateTaichungExpansion } from "../catalog/taichung-expansion";
import { createRoom, buildSnapshot } from "../rooms/rooms";
import { changeQuantity } from "../orders/orders";
import { noopEvents } from "../context";
import { getTownCatalog } from "../stores/town-catalog";
import { matchesDietFilters } from "../../shared/diet";
import { getTown } from "../stores/stores";
import { checkStreet } from "../../web/art/street-check";
import { streetLayout } from "../../web/art/street-layout";

const databases: Db[] = [];
const directories: string[] = [];
const db = (file = ":memory:", seedFile = TAICHUNG_SEED) => { const d = openDb(file, seedFile); databases.push(d); return d; };
afterEach(() => { for (const d of databases.splice(0)) d.close(); for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true }); });
describe("台中新店種子與地圖", () => {
  it("十四家店可全選開團，八家新店都能點餐，地址與餐點符合限制", () => {
    const database = db(), ctx = { db: database, events: noopEvents };
    expect(getTown(database)).toHaveLength(20);
    const walk = getTownCatalog(database);
    expect(walk.stores).toHaveLength(14);
    expect(walk.stores.every((s) => s.address?.startsWith("臺中市"))).toBe(true);
    expect(matchesDietFilters(walk.meals.find((m) => m.name === "全蔬餐盒（含蛋）")!.tags, ["no-egg"])).toBe(false);
    expect(matchesDietFilters(walk.meals.find((m) => m.name === "手工漢堡排餐")!.tags, ["no-beef"])).toBe(false);
    const room = createRoom(ctx, "owner", { title: "台中午餐", nickname: "團長", requestId: crypto.randomUUID(), storeIds: seed.stores.map((s) => s.id) }).snapshot;
    expect(room.catalog.stores).toHaveLength(14); expect(room.catalog.meals).toHaveLength(145);
    for (const store of room.catalog.stores) {
      expect(store.address).toMatch(/^臺中市/);
      expect([...store.name].length).toBeLessThanOrEqual(12);
      const meals = room.catalog.meals.filter((m) => m.storeId === store.id);
      expect(meals.length).toBeGreaterThan(0); expect(meals.length).toBeLessThanOrEqual(12);
      for (const m of meals) {
        expect([...m.name].length).toBeLessThanOrEqual(16);
        expect(Number.isInteger(m.priceTwd) && m.priceTwd > 0).toBe(true);
        expect(MEAL_ART_KEYS).toContain(m.imageAssetKey);
        expect(m.name).not.toMatch(/看不清|疑似/);
      }
      if (EXPANSION_IDS.includes(store.id)) changeQuantity(ctx, "owner", room.room.id, { mealId: meals[0].id, delta: 1, requestId: crypto.randomUUID() });
    }
    expect(buildSnapshot(database, room.room.id, "owner").myTotalQuantity).toBe(8);
  });
  it("舊六家資料庫補入八家，不覆蓋認領、改價、營業狀態或既有團快照", () => {
    const dir = mkdtempSync(join(tmpdir(), "lunch-town-67-upgrade-")); directories.push(dir);
    const path = join(dir, "old.json");
    writeFileSync(path, JSON.stringify({ ...seed, stores: seed.stores.filter((s) => !EXPANSION_IDS.includes(s.id)), meals: seed.meals.filter((m) => !EXPANSION_IDS.includes(m.storeId)) }));
    // openDb 會執行升級；移除新增資料，模擬升級前的六家快照。
    const database = db(":memory:", path);
    database.exec("DELETE FROM catalog_imports");
    for (const id of EXPANSION_IDS) {
      database.prepare("DELETE FROM meals WHERE store_id = ?").run(id); database.prepare("DELETE FROM stores WHERE id = ?").run(id);
    }
    const ctx = { db: database, events: noopEvents };
    const room = createRoom(ctx, "owner", { title: "舊團", nickname: "團長", requestId: crypto.randomUUID(), storeIds: ["store-chingfan"] }).snapshot;
    database.prepare("UPDATE stores SET owner_session_id = 'existing-owner', name = '店家自訂', status = 'resting' WHERE id = 'store-chingfan'").run();
    database.prepare("UPDATE meals SET price_twd = 999 WHERE id = 'meal-cf-signature'").run();
    const before = JSON.stringify(buildSnapshot(database, room.room.id, "owner").catalog);
    migrateTaichungExpansion(database); migrateTaichungExpansion(database);
    expect(getTown(database).filter((l) => l.store)).toHaveLength(14);
    expect(database.prepare("SELECT name, owner_session_id, status FROM stores WHERE id = 'store-chingfan'").get()).toEqual({ name: "店家自訂", owner_session_id: "existing-owner", status: "resting" });
    expect(database.prepare("SELECT price_twd FROM meals WHERE id = 'meal-cf-signature'").get()).toEqual({ price_twd: 999 });
    expect(JSON.stringify(buildSnapshot(database, room.room.id, "owner").catalog)).toBe(before);
    database.prepare("DELETE FROM meals WHERE store_id = 'store-musi'").run();
    migrateTaichungExpansion(database);
    expect(database.prepare("SELECT COUNT(*) AS n FROM meals WHERE store_id = 'store-musi'").get()).toEqual({ n: 0 });
  });
  it("不混入虛構種子，碰到已占用的新地段會選其他空位", () => {
    const sample = db(":memory:", SAMPLE_SEED);
    expect(getTown(sample).filter((l) => l.store)).toHaveLength(3);
    const database = db();
    database.prepare("DELETE FROM catalog_imports WHERE store_id = 'store-musi'").run();
    database.prepare("DELETE FROM meals WHERE store_id = 'store-musi'").run();
    database.prepare("DELETE FROM stores WHERE id = 'store-musi'").run();
    database.prepare("UPDATE stores SET lot_index = 12 WHERE id = 'store-youfan'").run();
    migrateTaichungExpansion(database);
    expect(database.prepare("SELECT lot_index FROM stores WHERE id = 'store-youfan'").get()).toEqual({ lot_index: 12 });
    expect(database.prepare("SELECT lot_index FROM stores WHERE id = 'store-musi'").get()).not.toEqual({ lot_index: 12 });
  });
  it("二十個店門從出生點可達，原地段與世界尺寸維持相容", () => {
    expect([STREET_W, STREET_H]).toEqual([960, 608]);
    expect(LOTS).toHaveLength(20);
    expect(LOTS.slice(0, 6).map((l) => [l.bx, l.by])).toEqual([[384, 224], [640, 208], [688, 64], [64, 336], [592, 368], [800, 416]]);
    expect(checkStreet(streetLayout().colliders)).toMatchObject({ passed: true, reachableDoors: 20, failures: [] });
    for (const l of LOTS) { const door = lotDoor(l.index); expect(door.x > 0 && door.x < 1 && door.y > 0 && door.y < 1).toBe(true); }
  });
});
