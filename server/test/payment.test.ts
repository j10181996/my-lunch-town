import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePaymentInfo } from "../../shared/payment";
import { openDb } from "../db";

const bank = { type: "bank", bankCode: "812", account: "1234-5678-9012", holder: "王阿凱" };
const valid = [bank, { type: "linepay", id: "kai" }, { type: "jkopay", id: "kai" },
  { type: "cash", note: "" }, { type: "other", text: "交給阿凱" }];
describe("收款資料純函式", () => {
  it.each(valid)("接受合法收款方式 %#", (method) => {
    expect(validatePaymentInfo({ methods: [method], note: "" })).toEqual({ methods: [method], note: "" });
  });
  it("接受方式數量與各文字欄位上限，清除額外欄位及前後空白", () => {
    const methods = [
      { ...bank, account: "1".repeat(20), holder: "王".repeat(20) },
      { type: "linepay", id: "a".repeat(40) },
      { type: "cash", note: "字".repeat(40) },
      { type: "other", text: "字".repeat(60) },
    ];
    expect(validatePaymentInfo({ methods, note: "字".repeat(100) })).toEqual({ methods, note: "字".repeat(100) });
    expect(validatePaymentInfo({ methods: [{ type: "jkopay", id: " kai ", secret: true }], note: " " }))
      .toEqual({ methods: [{ type: "jkopay", id: "kai" }], note: "" });
  });
  it.each([
    null, {}, { methods: [], note: "" }, { methods: Array(5).fill(bank), note: "" },
    { methods: [bank], note: "字".repeat(101) }, { methods: [bank] },
    ...[
      null, {}, { type: "unknown" },
      { ...bank, bankCode: "81" }, { ...bank, bankCode: "abc" }, { ...bank, bankCode: "8123" },
      { ...bank, account: "12345" }, { ...bank, account: "1".repeat(21) }, { ...bank, account: "12345a" },
      { ...bank, holder: "" }, { ...bank, holder: "王".repeat(21) },
      { type: "linepay", id: "" }, { type: "linepay", id: "a".repeat(41) },
      { type: "jkopay", id: "" }, { type: "jkopay", id: "a".repeat(41) },
      { type: "cash", note: "字".repeat(41) }, { type: "cash" },
      { type: "other", text: "" }, { type: "other", text: "字".repeat(61) },
    ].map((method) => ({ methods: [method], note: "" })),
  ])("拒絕非法收款資料 %#", (input) => {
    expect(() => validatePaymentInfo(input)).toThrow();
    try { validatePaymentInfo(input); } catch (e) { expect(e).toMatchObject({ code: "INVALID_INPUT" }); }
  });
});

it("舊 rooms 增欄與付款表遷移可重試、保留原資料及新設定", () => {
  const dir = mkdtempSync(join(tmpdir(), "lt-payment-"));
  const path = join(dir, "old.sqlite");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE rooms (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, catalog_version TEXT NOT NULL,
    is_sample INTEGER NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER,
    delivery_x REAL, delivery_y REAL
  ); INSERT INTO rooms VALUES ('old', '舊團', 'closed', 'v1', 0, 9, 100, 200, 0.2, 0.3);`);
  const before = old.prepare("SELECT * FROM rooms").get();
  old.close();
  try {
    const db = openDb(path);
    try {
      expect(db.prepare("SELECT * FROM rooms").get())
        .toEqual({ ...before, payment_json: null, payment_sent_at: null });
      expect(db.prepare("PRAGMA table_info(member_payments)").all().map((r) => r.name))
        .toEqual(["room_id", "member_id", "status", "reported_at", "confirmed_at"]);
      db.prepare("UPDATE rooms SET payment_json = ?, payment_sent_at = 123 WHERE id = 'old'")
        .run(JSON.stringify({ methods: [bank], note: "" }));
    } finally { db.close(); }
    const reopened = openDb(path);
    try {
      expect(reopened.prepare("SELECT * FROM rooms").get()).toEqual({
        ...before,
        payment_json: JSON.stringify({ methods: [bank], note: "" }),
        payment_sent_at: 123,
      });
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("付款變更與 revision 原子提交、提交後通知，重試與取消保留正確時間", async () => {
  const { createRoom, joinRoom } = await import("../rooms/rooms");
  const { changeQuantity, closeRoom } = await import("../orders/orders");
  const { confirmPayment, paymentRow, reportPayment, sendPaymentInfo, setPaymentInfo } =
    await import("../rooms/payments");
  const db = openDb(":memory:");
  const notifications: number[] = [];
  const ctx = {
    db,
    events: {
      roomChanged(_roomId: string, revision: number) {
        expect(db.isTransaction).toBe(false);
        notifications.push(revision);
      },
      bubble() {},
      storeOrdersChanged() {},
    },
  };
  const requestId = "payment-atomic-request";
  try {
    const roomId = createRoom(ctx, "owner", { title: "收款", nickname: "阿凱", requestId }).snapshot.room.id;
    const memberId = joinRoom(ctx, "rain", roomId, { nickname: "小雨", avatarId: "avatar-pink" }).me.id;
    changeQuantity(ctx, "rain", roomId, { mealId: "meal-af-chicken", delta: 1, requestId });
    closeRoom(ctx, "owner", roomId, requestId);
    setPaymentInfo(ctx, "owner", roomId, { methods: [bank], note: "" });
    sendPaymentInfo(ctx, "owner", roomId);
    const before = db.prepare("SELECT revision FROM rooms WHERE id = ?").get(roomId)!.revision;
    const events = notifications.length;
    db.exec(`CREATE TRIGGER block_payment_revision BEFORE UPDATE OF revision ON rooms
      BEGIN SELECT RAISE(ABORT, 'forced revision failure'); END;`);
    expect(() => reportPayment(ctx, "rain", roomId)).toThrow("forced revision failure");
    expect(paymentRow(db, roomId, memberId)).toBeUndefined();
    expect(db.prepare("SELECT revision FROM rooms WHERE id = ?").get(roomId)!.revision).toBe(before);
    expect(notifications).toHaveLength(events);
    db.exec("DROP TRIGGER block_payment_revision");
    reportPayment(ctx, "rain", roomId);
    const reported = paymentRow(db, roomId, memberId)!;
    expect(reported.reported_at).toEqual(expect.any(Number));
    expect(reported.confirmed_at).toBeNull();
    reportPayment(ctx, "rain", roomId);
    expect(paymentRow(db, roomId, memberId)).toEqual(reported);
    confirmPayment(ctx, "owner", roomId, memberId, { confirmed: true });
    const confirmed = paymentRow(db, roomId, memberId)!;
    expect(confirmed.confirmed_at).toEqual(expect.any(Number));
    expect(confirmed.reported_at).toBe(reported.reported_at);
    confirmPayment(ctx, "owner", roomId, memberId, { confirmed: true });
    reportPayment(ctx, "rain", roomId);
    expect(paymentRow(db, roomId, memberId)).toEqual(confirmed);
    confirmPayment(ctx, "owner", roomId, memberId, { confirmed: false });
    expect(paymentRow(db, roomId, memberId)).toEqual(reported);
  } finally { db.close(); }
});
