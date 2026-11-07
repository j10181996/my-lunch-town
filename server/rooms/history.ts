import type { MyRoomSummary } from "../../shared/contracts";
import type { Db } from "../db";

/** 首頁「我的團」最多列出的筆數（新到舊）。 */
export const MY_ROOMS_LIMIT = 30;

/**
 * 我開過與參加過的團。以目前身分（session）查成員紀錄；
 * 綁定 ChatGPT 帳號後（#38）同一帳號跨裝置得到同一身分，歷史自然一致。
 * 只回傳自己的金額，不含其他人的明細或收款狀態。
 */
export function myRooms(db: Db, sessionId: string): MyRoomSummary[] {
  const rows = db.prepare(
    `SELECT r.id, r.title, r.status, r.created_at, r.closed_at, r.delivery_x, r.delivery_y, r.delivery_address,
            m.id AS member_id, m.role, m.nickname, m.avatar_id,
            (SELECT COUNT(*) FROM members x WHERE x.room_id = r.id) AS member_count,
            (SELECT COALESCE(SUM(o.quantity * o.unit_price_twd), 0) FROM order_items o
              WHERE o.room_id = r.id AND o.member_id = m.id) AS my_total_twd
     FROM members m JOIN rooms r ON r.id = m.room_id
     WHERE m.session_id = ?
     ORDER BY r.created_at DESC, r.id
     LIMIT ?`,
  ).all(sessionId, MY_ROOMS_LIMIT) as Array<{
    id: string; title: string; status: "open" | "closed"; created_at: number; closed_at: number | null;
    delivery_x: number | null; delivery_y: number | null; delivery_address: string | null; member_id: string; role: "owner" | "participant";
    nickname: string; avatar_id: string; member_count: number; my_total_twd: number;
  }>;
  const stores = db.prepare("SELECT store_id, name FROM room_stores WHERE room_id = ? ORDER BY sort_order");
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    role: r.role,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    memberCount: r.member_count,
    myTotalTwd: r.my_total_twd,
    nickname: r.nickname,
    avatarId: r.avatar_id,
    deliveryPoint: r.delivery_x === null ? null : { x: r.delivery_x, y: r.delivery_y! },
    deliveryAddress: r.delivery_address ?? null,
    stores: (stores.all(r.id) as Array<{ store_id: string; name: string }>).map((s) => ({ id: s.store_id, name: s.name })),
  }));
}
