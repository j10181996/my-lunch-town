import type { RoomSnapshot } from "../../shared/contracts";
import type { Ctx } from "../context";
import { err, withWriteTx, type Db } from "../db";
import { createStoreOrders } from "../orders/storeOrders";
import { buildSnapshot, bumpRevision, getRoomRow, listMembers, requireMember } from "./rooms";

/** 截止時間最早為一分鐘後、最晚為 24 小時後；伺服器時間為準。 */
export const MIN_DEADLINE_LEAD_MS = 60_000;
export const MAX_DEADLINE_LEAD_MS = 24 * 60 * 60_000;

/** 可重複執行：舊 SQLite／D1 image 補上 rooms.deadline_at。 */
export function migrateDeadline(db: Pick<Db, "prepare" | "exec">) {
  const columns = db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === "deadline_at")) return;
  withWriteTx(db as Db, () => {
    db.exec("ALTER TABLE rooms ADD COLUMN deadline_at INTEGER");
  });
}

/** undefined 表示未提供；null 表示不設截止。 */
export function parseDeadline(value: unknown, now = Date.now()): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw err.invalid("截止時間格式錯誤");
  if (value < now + MIN_DEADLINE_LEAD_MS) throw err.invalid("截止時間至少要在一分鐘後");
  if (value > now + MAX_DEADLINE_LEAD_MS) throw err.invalid("截止時間不能超過 24 小時後");
  return value;
}

/** 依伺服器時間判斷是否已過截止；未設截止永遠不過期。 */
export function deadlinePassed(room: { deadline_at?: number | null }, now = Date.now()): boolean {
  return room.deadline_at != null && now >= room.deadline_at;
}

/**
 * 收單的唯一交易內步驟：手動收單與自動收單都走這裡。
 * 必須在 withWriteTx 內呼叫；已收單時回 null，因此重試或並發都不會重複建立店家訂單。
 */
export function closeInTx(db: Db, roomId: string, now = Date.now()): { revision: number; storeIds: string[] } | null {
  const room = getRoomRow(db, roomId);
  if (room.status === "closed") return null;
  const owner = listMembers(db, roomId).find((m) => m.role === "owner")!;
  db.prepare("UPDATE rooms SET status = 'closed', closed_at = ? WHERE id = ?").run(now, roomId);
  const storeIds = createStoreOrders(db, roomId, owner.nickname);
  return { revision: bumpRevision(db, roomId), storeIds };
}

function notifyClosed(ctx: Ctx, roomId: string, result: { revision: number; storeIds: string[] }) {
  ctx.events.roomChanged(roomId, result.revision);
  result.storeIds.forEach((id) => ctx.events.storeOrdersChanged(id));
}

/** 掃描所有已過截止但仍開著的團並自動收單；回傳本次收掉的團。 */
export function closeExpiredRooms(ctx: Ctx, now = Date.now()): string[] {
  const { db } = ctx;
  const due = db
    .prepare("SELECT id FROM rooms WHERE status = 'open' AND deadline_at IS NOT NULL AND deadline_at <= ?")
    .all(now) as Array<{ id: string }>;
  const closed: string[] = [];
  for (const { id } of due) {
    const result = withWriteTx(db, () => {
      const room = getRoomRow(db, id);
      return deadlinePassed(room, now) ? closeInTx(db, id, now) : null;
    });
    if (result) {
      notifyClosed(ctx, id, result);
      closed.push(id);
    }
  }
  return closed;
}

/** 團員頁面倒數歸零時呼叫；未到截止不做事，可安全重試。 */
export function expireRoom(ctx: Ctx, sessionId: string, roomId: string, now = Date.now()): RoomSnapshot {
  const { db } = ctx;
  requireMember(db, roomId, sessionId);
  const result = withWriteTx(db, () => {
    const { room } = requireMember(db, roomId, sessionId);
    return deadlinePassed(room, now) ? closeInTx(db, roomId, now) : null;
  });
  if (result) notifyClosed(ctx, roomId, result);
  return buildSnapshot(db, roomId, sessionId);
}

/** 揪團者開團後設定、延後或取消截止時間。 */
export function setDeadline(ctx: Ctx, sessionId: string, roomId: string, body: unknown): RoomSnapshot {
  const { db } = ctx;
  const now = Date.now();
  const deadline = parseDeadline((body as { deadlineAt?: unknown } | null)?.deadlineAt, now);
  if (deadline === undefined) throw err.invalid("缺少截止時間");
  const revision = withWriteTx(db, () => {
    const { room, me } = requireMember(db, roomId, sessionId);
    if (me.role !== "owner") throw err.notAllowed("只有揪團者可以設定截止時間");
    if (room.status !== "open" || deadlinePassed(room, now)) throw err.closed();
    db.prepare("UPDATE rooms SET deadline_at = ? WHERE id = ?").run(deadline, roomId);
    return bumpRevision(db, roomId);
  });
  ctx.events.roomChanged(roomId, revision);
  return buildSnapshot(db, roomId, sessionId);
}
