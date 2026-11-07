import { afterEach, describe, expect, it, vi } from "vitest";
import { inject } from "./inject";
import { DatabaseSync } from "node:sqlite";
import type { StoreHours } from "../../shared/contracts";
import { storeOpening, validateStoreHours } from "../../shared/store-hours";
import { migrateStoreHours } from "../store-hours-schema";
import { openDb, SAMPLE_SEED } from "../db";
import { noopEvents } from "../context";
import { createRoom, buildSnapshot } from "../rooms/rooms";
import { setHours, getTown } from "../stores/stores";
import { changeQuantity, closeRoom } from "../orders/orders";
import { buildApp } from "../app";
import { SAMPLE_STORE_IDS } from "./fixtures";

const instant = (date: string) => Date.parse(date + "+08:00");
const hours = (day = 1, open = "09:00", close = "18:00", cutoff: string | null = "17:00"): StoreHours => ({
  weekly: Array.from({ length: 7 }, (_, i) => i === day ? [{ open, close }] : []), cutoff,
});
afterEach(() => vi.restoreAllMocks());

describe("Taiwan weekly hours", () => {
  it.each([
    ["2026-11-09T08:59:59", false], ["2026-11-09T09:00:00", true],
    ["2026-11-09T17:59:59", true], ["2026-11-09T18:00:00", false],
    ["2026-11-08T10:00:00", false],
  ])("Monday slot at %s", (date, open) => {
    expect(storeOpening(hours(), instant(date)).open).toBe(open);
  });
  it("handles Sunday into Monday across the week boundary and a next-day cutoff", () => {
    const schedule = hours(0, "22:00", "02:00", "00:30");
    expect(storeOpening(schedule, instant("2026-11-09T01:00:00"))).toEqual({ open: true, deadline: instant("2026-11-09T00:30:00") });
    expect(storeOpening(schedule, instant("2026-11-09T02:00:00")).open).toBe(false);
  });
  it("supports split service, no schedule, no cutoff, and whole-week closure", () => {
    const schedule = hours(); schedule.weekly[1] = [{ open: "09:00", close: "12:00" }, { open: "17:00", close: "21:00" }];
    expect(storeOpening(schedule, instant("2026-11-09T13:00:00")).open).toBe(false);
    expect(storeOpening(schedule, instant("2026-11-09T19:00:00")).open).toBe(true);
    expect(storeOpening(null)).toEqual({ open: true, deadline: null });
    expect(storeOpening(hours(1, "09:00", "18:00", null), instant("2026-11-09T10:00:00")).deadline).toBeNull();
    expect(storeOpening({ weekly: Array.from({ length: 7 }, () => []), cutoff: null }).open).toBe(false);
  });
  it.each([undefined, {}, { weekly: [], cutoff: null }, hours(1, "25:00"), hours(1, "09:00", "09:00"), hours(1, "09:00", "18:00", "xx")])("rejects malformed schedule %#", (value) => expect(() => validateStoreHours(value)).toThrow());
  it("rejects overlaps including overnight week wrap; allows adjacent slots", () => {
    const h = hours(0, "22:00", "02:00"); h.weekly[1] = [{ open: "01:00", close: "03:00" }];
    expect(() => validateStoreHours(h)).toThrow(/重疊/);
    h.weekly[1] = [{ open: "02:00", close: "03:00" }];
    expect(validateStoreHours(h)).toEqual(h);
    h.weekly[6] = [{ open: "23:00", close: "23:00" }];
    expect(() => validateStoreHours(h)).toThrow();
  });
});

it("upgrades old domain images twice without resetting hours or existing rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE stores (id TEXT PRIMARY KEY); CREATE TABLE room_stores (store_id TEXT); INSERT INTO stores VALUES ('existing')");
    migrateStoreHours(db);
    db.prepare("UPDATE stores SET hours_json = ?").run(JSON.stringify(hours()));
    migrateStoreHours(db);
    expect(db.prepare("SELECT * FROM stores").get()).toMatchObject({ id: "existing", hours_json: JSON.stringify(hours()) });
  } finally { db.close(); }
});

it("excludes closed stores AND their meals from new rooms; keeps existing price and cutoff snapshots", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(instant("2026-11-09T10:00:00"));
  const db = openDb(":memory:", SAMPLE_SEED);
  try {
    const ctx = { db, events: noopEvents };
    db.prepare("UPDATE stores SET owner_session_id = 'shop' WHERE id = 'store-af'").run();
    setHours(db, "shop", "store-af", hours());
    const first = createRoom(ctx, "owner", { title: "午餐", nickname: "團主", requestId: "first-request", storeIds: SAMPLE_STORE_IDS });
    expect(first.snapshot.catalog.stores.find((s) => s.id === "store-af")?.orderDeadlineAt).toBe(instant("2026-11-09T17:00:00"));
    changeQuantity(ctx, "owner", first.snapshot.room.id, { mealId: "meal-af-chicken", delta: 1, requestId: "order-request" });
    setHours(db, "shop", "store-af", { weekly: Array.from({ length: 7 }, () => []), cutoff: null });
    expect(() => createRoom(ctx, "other", { title: "晚餐", nickname: "團主", requestId: "closed-request", storeIds: SAMPLE_STORE_IDS }))
      .toThrow("「阿福便當」目前沒有營業");
    const second = createRoom(ctx, "other", { title: "晚餐", nickname: "團主", requestId: "second-request", storeIds: ["store-tree", "store-green"] });
    expect(second.snapshot.catalog.stores.some((s) => s.id === "store-af")).toBe(false);
    expect(second.snapshot.catalog.meals.some((m) => m.storeId === "store-af")).toBe(false);
    expect(getTown(db).find((l) => l.store?.id === "store-af")?.store?.status).toBe("resting");
    now.mockReturnValue(instant("2026-11-09T18:01:00"));
    const closed = closeRoom(ctx, "owner", first.snapshot.room.id, "close-request");
    expect(closed.totalTwd).toBe(120);
    expect(closed.room.status).toBe("closed");
    expect(closed.catalog.stores.find((s) => s.id === "store-af")?.orderDeadlineAt).toBe(instant("2026-11-09T17:00:00"));
    expect(buildSnapshot(db, first.snapshot.room.id, "owner").storeOrders).toHaveLength(1);
  } finally { db.close(); }
});

it("filters by time at room creation and preserves requestId across closing boundaries", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(instant("2026-11-09T10:00:00"));
  const db = openDb(":memory:", SAMPLE_SEED);
  try {
    db.prepare("UPDATE stores SET hours_json = ?").run(JSON.stringify(hours()));
    const ctx = { db, events: noopEvents };
    const input = { title: "午餐", nickname: "團主", requestId: "retry-create", storeIds: SAMPLE_STORE_IDS };
    const first = createRoom(ctx, "owner", input);
    now.mockReturnValue(instant("2026-11-09T18:00:00"));
    expect(createRoom(ctx, "owner", input).snapshot.room.id).toBe(first.snapshot.room.id);
    expect(() => createRoom(ctx, "owner", { ...input, requestId: "new-create" })).toThrow(/沒有營業/);
  } finally { db.close(); }
});

it("hours API enforces owner permissions, validates input, and can remove the schedule", async () => {
  const db = openDb(":memory:", SAMPLE_SEED);
  const app = await buildApp({ ctx: { db, events: noopEvents } });
  try {
    const claim = await inject(app, { method: "POST", url: "/api/stores/claim", payload: { manageKey: "demo-store-af" } });
    const cookie = String(claim.headers["set-cookie"]).split(";")[0];
    const url = "/api/stores/store-af/hours";
    expect((await inject(app, { method: "PUT", url, payload: hours() })).statusCode).toBe(403);
    expect((await inject(app, { method: "PUT", url, headers: { cookie }, payload: {} })).statusCode).toBe(400);
    const saved = await inject(app, { method: "PUT", url, headers: { cookie }, payload: hours() });
    expect(saved.statusCode).toBe(200); expect(saved.json().hours).toEqual(hours());
    const reset = await inject(app, { method: "PUT", url, headers: { cookie, "content-type": "application/json" }, payload: "null" });
    expect(reset.statusCode).toBe(200); expect(reset.json().hours).toBeNull();
  } finally { db.close(); }
});
