import type { Member, PaymentStatus, RoomSnapshot } from "../../shared/contracts";
import { validatePaymentInfo } from "../../shared/payment";
import { sumItems } from "../../shared/pricing";
import type { Ctx } from "../context";
import { AppError, err, withWriteTx, type Db } from "../db";
import { buildSnapshot, bumpRevision, listMembers, loadItems, requireMember } from "./rooms";

/** 提醒冷卻時間，避免團主連按造成騷擾。 */
export const PAYMENT_REMIND_COOLDOWN_MS = 5 * 60_000;

export function paymentRemindedAt(db: Db, roomId: string): number | null {
  const row = db.prepare("SELECT reminded_at FROM payment_reminders WHERE room_id = ?").get(roomId) as
    { reminded_at: number } | undefined;
  return row?.reminded_at ?? null;
}

interface PaymentRow {
  status: "reported" | "confirmed";
  reported_at: number | null;
  confirmed_at: number | null;
}
export function paymentRow(db: Db, roomId: string, memberId: string): PaymentRow | undefined {
  return db.prepare("SELECT * FROM member_payments WHERE room_id = ? AND member_id = ?")
    .get(roomId, memberId) as PaymentRow | undefined;
}
export function paymentStatus(db: Db, roomId: string, memberId: string): PaymentStatus {
  return paymentRow(db, roomId, memberId)?.status ?? "unpaid";
}
/** 僅收單後金額大於零的非團主成員需要付款。 */
function requirePayee(db: Db, roomId: string, member: Member, closed: boolean) {
  if (member.role === "owner" || !closed || sumItems(loadItems(db, roomId, member.id)).totalTwd <= 0) {
    throw err.notAllowed("這位成員不需要付款");
  }
}
/** 真正改變狀態才遞增 revision；通知必須在交易提交後。 */
function mutate(ctx: Ctx, sessionId: string, roomId: string, action: () => boolean): RoomSnapshot {
  const revision = withWriteTx(ctx.db, () => action() ? bumpRevision(ctx.db, roomId) : null);
  if (revision !== null) ctx.events.roomChanged(roomId, revision);
  return buildSnapshot(ctx.db, roomId, sessionId);
}
function requireOwner(db: Db, roomId: string, sessionId: string) {
  const result = requireMember(db, roomId, sessionId);
  if (result.me.role !== "owner") throw err.notAllowed("只有揪團者可以操作收款設定");
  return result;
}
export function setPaymentInfo(ctx: Ctx, sessionId: string, roomId: string, input: unknown) {
  return mutate(ctx, sessionId, roomId, () => {
    const { room } = requireOwner(ctx.db, roomId, sessionId);
    let info;
    try {
      info = validatePaymentInfo(input);
    } catch (e) {
      throw err.invalid((e as Error).message);
    }
    const json = JSON.stringify(info);
    if (room.payment_json === json) return false;
    ctx.db.prepare("UPDATE rooms SET payment_json = ? WHERE id = ?").run(json, roomId);
    return true;
  });
}
export function sendPaymentInfo(ctx: Ctx, sessionId: string, roomId: string) {
  return mutate(ctx, sessionId, roomId, () => {
    const { room } = requireOwner(ctx.db, roomId, sessionId);
    if (room.status !== "closed") throw err.invalid("請先收單再傳送收款資訊");
    if (!room.payment_json) throw err.invalid("請先設定收款資料");
    if (room.payment_sent_at !== null) return false;
    ctx.db.prepare("UPDATE rooms SET payment_sent_at = ? WHERE id = ?").run(Date.now(), roomId);
    return true;
  });
}
/** 團主提醒仍未付款的團員；已回報或已確認的人不會收到提醒。 */
export function remindUnpaid(ctx: Ctx, sessionId: string, roomId: string, now = Date.now()) {
  return mutate(ctx, sessionId, roomId, () => {
    const { room } = requireOwner(ctx.db, roomId, sessionId);
    if (room.status !== "closed") throw err.invalid("請先收單再提醒付款");
    if (room.payment_sent_at === null) throw err.invalid("請先傳送收款資訊");
    const unpaid = listMembers(ctx.db, roomId).filter((m) => m.role !== "owner"
      && sumItems(loadItems(ctx.db, roomId, m.id)).totalTwd > 0
      && paymentStatus(ctx.db, roomId, m.id) === "unpaid");
    if (unpaid.length === 0) throw err.invalid("目前沒有未付款的團員");
    const last = paymentRemindedAt(ctx.db, roomId);
    if (last !== null && now - last < PAYMENT_REMIND_COOLDOWN_MS) {
      const minutes = Math.ceil((PAYMENT_REMIND_COOLDOWN_MS - (now - last)) / 60_000);
      throw err.invalid(`剛提醒過，請 ${minutes} 分鐘後再提醒`);
    }
    ctx.db.prepare(`INSERT INTO payment_reminders (room_id, reminded_at) VALUES (?, ?)
      ON CONFLICT(room_id) DO UPDATE SET reminded_at = excluded.reminded_at`).run(roomId, now);
    return true;
  });
}
export function reportPayment(ctx: Ctx, sessionId: string, roomId: string) {
  return mutate(ctx, sessionId, roomId, () => {
    const { room, me } = requireMember(ctx.db, roomId, sessionId);
    requirePayee(ctx.db, roomId, me, room.status === "closed");
    if (room.payment_sent_at === null) throw err.invalid("團主尚未傳送收款資訊");
    if (paymentRow(ctx.db, roomId, me.id)) return false;
    ctx.db.prepare(`INSERT INTO member_payments (room_id, member_id, status, reported_at)
      VALUES (?, ?, 'reported', ?)`).run(roomId, me.id, Date.now());
    return true;
  });
}
export function confirmPayment(ctx: Ctx, sessionId: string, roomId: string, memberId: string, input: unknown) {
  return mutate(ctx, sessionId, roomId, () => {
    const { room } = requireOwner(ctx.db, roomId, sessionId);
    const member = listMembers(ctx.db, roomId).find((m) => m.id === memberId);
    if (!member) throw new AppError("INVALID_INPUT", 404, "找不到這位成員");
    requirePayee(ctx.db, roomId, member, room.status === "closed");
    const confirmed = (input as { confirmed?: unknown } | null)?.confirmed;
    if (typeof confirmed !== "boolean") throw err.invalid("confirmed 須為布林值");
    const row = paymentRow(ctx.db, roomId, memberId);
    if (confirmed) {
      if (row?.status === "confirmed") return false;
      ctx.db.prepare(`INSERT INTO member_payments (room_id, member_id, status, confirmed_at)
        VALUES (?, ?, 'confirmed', ?) ON CONFLICT(room_id, member_id)
        DO UPDATE SET status = 'confirmed', confirmed_at = excluded.confirmed_at`)
        .run(roomId, memberId, Date.now());
    } else {
      if (row?.status !== "confirmed") return false;
      if (row.reported_at !== null) {
        ctx.db.prepare(`UPDATE member_payments SET status = 'reported', confirmed_at = NULL
          WHERE room_id = ? AND member_id = ?`).run(roomId, memberId);
      } else {
        ctx.db.prepare("DELETE FROM member_payments WHERE room_id = ? AND member_id = ?").run(roomId, memberId);
      }
    }
    return true;
  });
}
