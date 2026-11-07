import type { LunchParty } from "../../shared/contracts";
import type { Ctx } from "../context";
import { err, withWriteTx, type Db } from "../db";
import { buildSnapshot, bumpRevision, listMembers, requireMember } from "./rooms";

export function lunchParty(db: Db, roomId: string): LunchParty {
  const rows = db.prepare(`SELECT r.member_id FROM member_ready r JOIN members m ON m.id = r.member_id
    WHERE m.room_id = ? ORDER BY m.joined_seq`).all(roomId) as Array<{ member_id: string }>;
  const saved = db.prepare("SELECT generation, members_json FROM room_celebrations WHERE room_id = ?")
    .get(roomId) as { generation: number; members_json: string } | undefined;
  return { readyMemberIds: rows.map((r) => r.member_id), celebration: saved
    ? { id: saved.generation, members: JSON.parse(saved.members_json) } : null };
}

/** 使用明確的完成狀態；相同值重試不會切換狀態或重複慶祝。 */
export function setLunchReady(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const ready = (input as { ready?: unknown } | null)?.ready;
  if (typeof ready !== "boolean") throw err.invalid("請選擇是否已選好午餐");
  const revision = withWriteTx(ctx.db, () => {
    const { room, me } = requireMember(ctx.db, roomId, sid);
    if (room.status !== "open") throw err.closed();
    if (ready && !ctx.db.prepare("SELECT 1 FROM order_items WHERE room_id = ? AND member_id = ? LIMIT 1").get(roomId, me.id)) {
      throw err.invalid("先選一份午餐，再按選好了");
    }
    const changed = ready
      ? ctx.db.prepare("INSERT OR IGNORE INTO member_ready (member_id) VALUES (?)").run(me.id)
      : ctx.db.prepare("DELETE FROM member_ready WHERE member_id = ?").run(me.id);
    if (!changed.changes) return null;
    const members = listMembers(ctx.db, roomId);
    if (ready && lunchParty(ctx.db, roomId).readyMemberIds.length === members.length) {
      const roster = members.map(({ id, nickname, avatarId }) => ({ id, nickname, avatarId }));
      ctx.db.prepare(`INSERT INTO room_celebrations (room_id, generation, members_json) VALUES (?, 1, ?)
        ON CONFLICT(room_id) DO UPDATE SET generation = generation + 1, members_json = excluded.members_json`)
        .run(roomId, JSON.stringify(roster));
    }
    return bumpRevision(ctx.db, roomId);
  });
  if (revision !== null) ctx.events.roomChanged(roomId, revision);
  return buildSnapshot(ctx.db, roomId, sid);
}
