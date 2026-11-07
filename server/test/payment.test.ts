import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePaymentInfo } from "../../shared/payment";
import { paymentQrPayload, twqrTransferPayload } from "../../shared/payment-qr";
import { openDb } from "../db";
import { SAMPLE_STORE_IDS } from "./fixtures";

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
  it("LINE Pay／街口收款連結選填，只接受 https，空白連結視為未填", () => {
    const link = "https://line.me/R/pay/kai";
    expect(validatePaymentInfo({ methods: [{ type: "linepay", id: "kai", link: ` ${link} ` }], note: "" }))
      .toEqual({ methods: [{ type: "linepay", id: "kai", link }], note: "" });
    expect(validatePaymentInfo({ methods: [{ type: "jkopay", id: "kai", link: " " }], note: "" }))
      .toEqual({ methods: [{ type: "jkopay", id: "kai" }], note: "" });
    for (const bad of ["http://line.me/pay", "javascript:alert(1)", "https://a b.com", "line.me/pay",
      `https://x.com/${"a".repeat(290)}`, 42]) {
      expect(() => validatePaymentInfo({ methods: [{ type: "linepay", id: "kai", link: bad }], note: "" }))
        .toThrow();
    }
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

describe("收款 QR code 內容", () => {
  it("銀行轉帳產生 TWQR 轉帳字串：轉入行、16 碼帳號、台幣與兩位小數金額", () => {
    expect(twqrTransferPayload(bank as never, 185)).toBe(
      "TWQRP://%E5%80%8B%E4%BA%BA%E8%BD%89%E5%B8%B3/158/02/V1?D5=812&D6=0000123456789012&D10=901&D1=18500",
    );
    const url = new URL(twqrTransferPayload(bank as never, 185)!.replace("TWQRP://", "https://twqr/"));
    expect(decodeURIComponent(url.pathname)).toBe("/個人轉帳/158/02/V1");
    expect(Object.fromEntries(url.searchParams)).toEqual({ D5: "812", D6: "0000123456789012", D10: "901", D1: "18500" });
  });
  it("沒有應付金額時不帶金額；帳號超過 16 碼時不產生 QR", () => {
    expect(twqrTransferPayload(bank as never)).not.toContain("D1=");
    expect(twqrTransferPayload(bank as never, 0)).not.toContain("D1=");
    expect(twqrTransferPayload({ ...bank, account: "1".repeat(17) } as never, 100)).toBeNull();
    expect(twqrTransferPayload({ ...bank, account: "1".repeat(16) } as never, 100)).toContain(`D6=${"1".repeat(16)}`);
  });
  it("LINE Pay／街口用收款連結，現金與其他沒有 QR", () => {
    expect(paymentQrPayload({ type: "linepay", id: "kai", link: "https://line.me/R/pay/kai" })).toBe("https://line.me/R/pay/kai");
    expect(paymentQrPayload({ type: "jkopay", id: "kai" })).toBeNull();
    expect(paymentQrPayload({ type: "cash", note: "" })).toBeNull();
    expect(paymentQrPayload({ type: "other", text: "交給阿凱" })).toBeNull();
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
        .toEqual({ ...before, payment_json: null, payment_sent_at: null, deadline_at: null, delivery_address: null,
          delivery_lat: null, delivery_lng: null });
      expect(db.prepare("PRAGMA table_info(member_payments)").all().map((r) => r.name))
        .toEqual(["room_id", "member_id", "status", "reported_at", "confirmed_at"]);
      expect(db.prepare("PRAGMA table_info(payment_reminders)").all().map((r) => r.name))
        .toEqual(["room_id", "reminded_at"]);
      db.prepare("UPDATE rooms SET payment_json = ?, payment_sent_at = 123 WHERE id = 'old'")
        .run(JSON.stringify({ methods: [bank], note: "" }));
    } finally { db.close(); }
    const reopened = openDb(path);
    try {
      expect(reopened.prepare("SELECT * FROM rooms").get()).toEqual({
        ...before,
        payment_json: JSON.stringify({ methods: [bank], note: "" }),
        payment_sent_at: 123,
        deadline_at: null,
        delivery_address: null,
        delivery_lat: null,
        delivery_lng: null,
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
    const roomId = createRoom(ctx, "owner", { title: "收款", nickname: "阿凱", requestId, storeIds: SAMPLE_STORE_IDS }).snapshot.room.id;
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

it("付款提醒只送給未付款的團員，限團主、收單並傳送後，並有冷卻時間", async () => {
  const { buildSnapshot, createRoom, joinRoom } = await import("../rooms/rooms");
  const { changeQuantity, closeRoom } = await import("../orders/orders");
  const { PAYMENT_REMIND_COOLDOWN_MS, remindUnpaid, reportPayment, sendPaymentInfo, setPaymentInfo } =
    await import("../rooms/payments");
  const db = openDb(":memory:");
  const notifications: number[] = [];
  const ctx = {
    db,
    events: { roomChanged(_r: string, revision: number) { notifications.push(revision); }, bubble() {}, storeOrdersChanged() {} },
  };
  const requestId = "payment-remind-request";
  try {
    const roomId = createRoom(ctx, "owner", { title: "提醒", nickname: "阿凱", requestId, storeIds: SAMPLE_STORE_IDS }).snapshot.room.id;
    joinRoom(ctx, "rain", roomId, { nickname: "小雨", avatarId: "avatar-pink" });
    joinRoom(ctx, "sun", roomId, { nickname: "小陽", avatarId: "avatar-pink" });
    joinRoom(ctx, "idle", roomId, { nickname: "沒點", avatarId: "avatar-pink" });
    changeQuantity(ctx, "rain", roomId, { mealId: "meal-af-chicken", delta: 1, requestId });
    changeQuantity(ctx, "sun", roomId, { mealId: "meal-af-chicken", delta: 1, requestId });
    expect(() => remindUnpaid(ctx, "owner", roomId)).toThrow("請先收單");
    closeRoom(ctx, "owner", roomId, requestId);
    setPaymentInfo(ctx, "owner", roomId, { methods: [bank], note: "" });
    expect(() => remindUnpaid(ctx, "owner", roomId)).toThrow("請先傳送收款資訊");
    sendPaymentInfo(ctx, "owner", roomId);
    reportPayment(ctx, "sun", roomId);
    expect(() => remindUnpaid(ctx, "rain", roomId)).toThrow("只有揪團者");
    expect(buildSnapshot(db, roomId, "rain").myPayment?.remindedAt).toBeNull();

    const before = notifications.length;
    const at = 1_000_000;
    const owner = remindUnpaid(ctx, "owner", roomId, at);
    expect(owner.payment?.remindedAt).toBe(at);
    expect(notifications).toHaveLength(before + 1);
    expect(buildSnapshot(db, roomId, "rain").myPayment).toMatchObject({ status: "unpaid", remindedAt: at });
    expect(buildSnapshot(db, roomId, "sun").myPayment).toMatchObject({ status: "reported", remindedAt: null });
    expect(buildSnapshot(db, roomId, "idle").myPayment).toBeNull();
    expect(buildSnapshot(db, roomId, "rain").payment).not.toHaveProperty("remindedAt");

    expect(() => remindUnpaid(ctx, "owner", roomId, at + PAYMENT_REMIND_COOLDOWN_MS - 1)).toThrow("剛提醒過");
    remindUnpaid(ctx, "owner", roomId, at + PAYMENT_REMIND_COOLDOWN_MS);
    expect(buildSnapshot(db, roomId, "rain").myPayment?.remindedAt).toBe(at + PAYMENT_REMIND_COOLDOWN_MS);

    reportPayment(ctx, "rain", roomId);
    expect(buildSnapshot(db, roomId, "rain").myPayment?.remindedAt).toBeNull();
    expect(() => remindUnpaid(ctx, "owner", roomId, at * 10)).toThrow("沒有未付款");
  } finally { db.close(); }
});
