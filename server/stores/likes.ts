/** 吃完給店家按讚（#92）：團員收單後對有接到這團訂單的店家按「好吃！」，店家後台看得到。 */
import type { Ctx } from "../context";
import type { Db } from "../db";
import { err } from "../db";
import { requireMember } from "../rooms/rooms";
import { requireOwner } from "./stores";
import type { StoreLikes } from "../../shared/contracts";

const DAY = 24 * 60 * 60 * 1000;
const RECENT = 5;

/** 每人每店每團一次；重送回傳同樣結果，不重複計數（主鍵保證，不需 requestId）。 */
export async function likeStore(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const { room, me } = await requireMember(ctx.db, roomId, sid);
  const storeId = (input as { storeId?: unknown } | null)?.storeId;
  if (typeof storeId !== "string") throw err.invalid("請選擇要按讚的店家");
  if (room.status !== "closed") throw err.invalid("收單後才能給店家按讚");
  const order = await ctx.db.prepare("SELECT status FROM store_orders WHERE room_id = ? AND store_id = ?")
    .bind(roomId, storeId).first<{ status: string }>();
  if (!order) throw err.invalid("這家店沒有接到這團的訂單");
  if (order.status === "rejected") throw err.invalid("這家店拒單了，不能按讚");
  await ctx.db.prepare("INSERT OR IGNORE INTO store_likes (room_id, store_id, member_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(roomId, storeId, me.id, Date.now()).run();
  return { storeId, liked: true };
}

/** 店家後台：累計、近 7 天與最近幾筆按讚；只顯示團名與時間，不顯示是誰。 */
export async function storeLikes(db: Db, sid: string, storeId: string, now = Date.now()): Promise<StoreLikes> {
  await requireOwner(db, sid, storeId);
  const count = async (since: number) => (await db.prepare("SELECT COUNT(*) AS n FROM store_likes WHERE store_id = ? AND created_at >= ?")
    .bind(storeId, since).first<{ n: number }>())!.n;
  const { results: recent } = await db.prepare(`SELECT l.created_at AS at, COALESCE(o.room_title, '') AS roomTitle FROM store_likes l
    LEFT JOIN store_orders o ON o.room_id = l.room_id AND o.store_id = l.store_id
    WHERE l.store_id = ? ORDER BY l.created_at DESC LIMIT ?`).bind(storeId, RECENT).all<{ at: number; roomTitle: string }>();
  return { total: await count(0), last7Days: await count(now - 7 * DAY), recent: recent.map((r) => ({ at: Number(r.at), roomTitle: String(r.roomTitle) })) };
}
