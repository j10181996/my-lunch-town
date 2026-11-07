import type { Db } from "../db";

/** 自己在這團已按讚的店家，放進快照讓畫面顯示「已按讚」（放這裡避免 rooms 與 likes 互相匯入）。 */
export async function likedStoreIds(db: Db, roomId: string, memberId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT store_id FROM store_likes WHERE room_id = ? AND member_id = ? ORDER BY store_id")
    .bind(roomId, memberId).all<{ store_id: string }>();
  return results.map((r) => r.store_id);
}

/**
 * 吃完給店家按讚（#92）。Node 與 Sites 舊快照皆可重複套用。
 * 刻意不加外鍵串聯：之後清理過期團（#11）時，店家的讚數不會跟著消失。
 * 主鍵限制每人每店每團一次，重送不會重複計數。
 */
export const STORE_LIKES_SCHEMA = `CREATE TABLE IF NOT EXISTS store_likes (
  room_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, store_id, member_id)
);
CREATE INDEX IF NOT EXISTS store_likes_by_store ON store_likes (store_id, created_at)`;
