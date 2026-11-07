import { beforeEach, describe, expect, it } from "vitest";
import { inject } from "./inject";
import type { Hono } from "hono";
import type { Catalog } from "../../shared/contracts";
import { lotDoor } from "../../shared/town";
import { buildApp } from "../app";
import { noopEvents } from "../context";
import { SAMPLE_SEED, asyncDb, openDb, type RawDb } from "../db";

let app: Hono;
let db: RawDb;

beforeEach(async () => {
  db = openDb(":memory:", SAMPLE_SEED);
  app = await buildApp({ ctx: { db: asyncDb(db), events: noopEvents } });
});

async function catalog(): Promise<Catalog> {
  const res = await inject(app, { method: "GET", url: "/api/town/catalog" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("散步模式即時菜單 GET /api/town/catalog（#44）", () => {
  it("不需工作階段，回傳營業中店家、門口座標與供應中餐點", async () => {
    const c = await catalog();
    const stores = db.prepare("SELECT id, lot_index FROM stores ORDER BY lot_index").all() as Array<{ id: string; lot_index: number }>;
    expect(c.stores.map((s) => s.id)).toEqual(stores.map((s) => s.id));
    for (const s of c.stores) {
      expect(s.sceneId).toBe(`shop:${s.id}`);
      expect(s.door).toEqual(lotDoor(s.lotIndex!));
      expect(s.resting).toBe(false);
    }
    expect(c.meals.length).toBeGreaterThan(0);
    expect(c.meals.every((m) => m.available)).toBe(true);
    expect(c.isSample).toBe(true);
  });

  it("休息中的店仍可逛但標成 resting；沒有供應中餐點的店與售完餐點不列出", async () => {
    const [a, b] = (db.prepare("SELECT id FROM stores ORDER BY lot_index").all() as Array<{ id: string }>).map((r) => r.id);
    db.prepare("UPDATE stores SET status = 'resting' WHERE id = ?").run(a);
    db.prepare("UPDATE meals SET available = 0 WHERE store_id = ?").run(b);
    const soldOut = db.prepare("SELECT m.id FROM meals m JOIN stores s ON s.id = m.store_id WHERE s.id NOT IN (?, ?) LIMIT 1").get(a, b) as { id: string };
    db.prepare("UPDATE meals SET available = 0 WHERE id = ?").run(soldOut.id);

    const c = await catalog();
    expect(c.stores.find((s) => s.id === a)?.resting).toBe(true);
    expect(c.stores.some((s) => s.id === b)).toBe(false);
    expect(c.meals.some((m) => m.storeId === b || m.id === soldOut.id)).toBe(false);
  });

  it("只公開開團會看到的欄位，不含外送規則或擁有者資訊", async () => {
    const c = await catalog();
    const body = JSON.stringify(c);
    expect(body).not.toMatch(/owner|manage|session|delivery/i);
  });
});
