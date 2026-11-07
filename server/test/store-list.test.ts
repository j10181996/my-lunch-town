import { afterEach, expect, it, vi } from "vitest";
import { inject } from "./inject";
import { openDb, SAMPLE_SEED } from "../db";
import { listManagementStores } from "../stores/store-list";
afterEach(() => vi.restoreAllMocks());
it("lists all public store summaries but only exposes details of owned stores", () => {
  const db = openDb(":memory:", SAMPLE_SEED);
  try {
    db.prepare("UPDATE stores SET owner_session_id = 'alice' WHERE id = 'store-af'").run();
    db.prepare("UPDATE stores SET owner_session_id = 'bob' WHERE id = 'store-tree'").run();
    const all = listManagementStores(db, "alice");
    expect(all).toHaveLength(3);
    expect(all.find((s) => s.id === "store-af")).toMatchObject({ canViewDetails: true, managePath: "/shop/store-af", mealCount: 3 });
    expect(all.find((s) => s.id === "store-tree")).toMatchObject({ canViewDetails: false, mealCount: null, hours: null, activeRoomCount: null });
    for (const row of all) {
      expect(row).not.toHaveProperty("owner_session_id");
      expect(row).not.toHaveProperty("manage_key_hash");
    }
    expect(listManagementStores(db, "stranger").every((s) => !s.canViewDetails && s.mealCount === null)).toBe(true);
    expect(db.prepare("SELECT owner_session_id FROM stores WHERE id = 'store-tree'").get()).toMatchObject({ owner_session_id: "bob" });
  } finally { db.close(); }
});
it("reports actual availability independently of manual open", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-09T12:00:00+08:00"));
  const db = openDb(":memory:", SAMPLE_SEED);
  try {
    db.prepare("UPDATE stores SET hours_json = ? WHERE id = 'store-af'").run(JSON.stringify({ weekly: Array.from({ length: 7 }, () => []), cutoff: null }));
    db.prepare("UPDATE meals SET available = 0 WHERE store_id = 'store-tree'").run();
    const list = listManagementStores(db, "stranger");
    expect(list.find((s) => s.id === "store-af")).toMatchObject({ accepting: false, manualStatus: "open" });
    expect(list.find((s) => s.id === "store-tree")?.accepting).toBe(false);
    expect(list.find((s) => s.id === "store-green")?.accepting).toBe(true);
  } finally { db.close(); }
});
it("list links and client flags do not grant store edit access", async () => {
  const { buildApp } = await import("../app");
  const { noopEvents } = await import("../context");
  const db = openDb(":memory:", SAMPLE_SEED);
  const app = await buildApp({ ctx: { db, events: noopEvents } });
  try {
    const headers = { "x-admin": "true", "oai-authenticated-user-id": "pretend-admin" };
    const response = await inject(app, { method: "GET", url: "/api/management/stores?scope=all", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().stores).toHaveLength(3);
    expect(response.json().stores.every((s: { canViewDetails: boolean }) => !s.canViewDetails)).toBe(true);
    expect((await inject(app, { method: "GET", url: "/api/stores/store-af", headers })).statusCode).toBe(403);
    expect((await inject(app, { method: "PATCH", url: "/api/stores/store-af", headers, payload: { name: "changed" } })).statusCode).toBe(403);
  } finally { db.close(); }
});
