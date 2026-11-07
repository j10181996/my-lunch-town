import type { LunchParty } from "../../shared/contracts";
import type { Ctx } from "../context";
import { err, withWriteTx, type Db } from "../db";
import { buildSnapshot, bumpRevision, listMembers, requireMember } from "./rooms";

export async function lunchParty(db: Db, roomId: string): Promise<LunchParty> {
  const { results: rows } = await db.prepare(`SELECT r.member_id FROM member_ready r JOIN members m ON m.id = r.member_id
    WHERE m.room_id = ? ORDER BY m.joined_seq`).bind(roomId).all<{ member_id: string }>();
  const saved = await db.prepare("SELECT generation, members_json FROM room_celebrations WHERE room_id = ?")
    .bind(roomId).first<{ generation: number; members_json: string }>();
  return { readyMemberIds: rows.map((r) => r.member_id), celebration: saved
    ? { id: saved.generation, members: JSON.parse(saved.members_json) } : null };
}

/** 使用明確的完成狀態；相同值重試不會切換狀態或重複慶祝。 */
export async function setLunchReady(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const ready = (input as { ready?: unknown } | null)?.ready;
  if (typeof ready !== "boolean") throw err.invalid("請選擇是否已選好午餐");
  const revision = await withWriteTx(ctx.db, async () => {
    const { room, me } = await requireMember(ctx.db, roomId, sid);
    if (room.status !== "open") throw err.closed();
    if (ready && !await ctx.db.prepare("SELECT 1 FROM order_items WHERE room_id = ? AND member_id = ? LIMIT 1").bind(roomId, me.id).first()) {
      throw err.invalid("先選一份午餐，再按選好了");
    }
    const changed = ready
      ? await ctx.db.prepare("INSERT OR IGNORE INTO member_ready (member_id) VALUES (?)").bind(me.id).run()
      : await ctx.db.prepare("DELETE FROM member_ready WHERE member_id = ?").bind(me.id).run();
    if (!changed.meta.changes) return null;
    const members = await listMembers(ctx.db, roomId);
    if (ready && (await lunchParty(ctx.db, roomId)).readyMemberIds.length === members.length) {
      const roster = members.map(({ id, nickname, avatarId }) => ({ id, nickname, avatarId }));
      await ctx.db.prepare(`INSERT INTO room_celebrations (room_id, generation, members_json) VALUES (?, 1, ?)
        ON CONFLICT(room_id) DO UPDATE SET generation = generation + 1, members_json = excluded.members_json`)
        .bind(roomId, JSON.stringify(roster)).run();
    }
    return bumpRevision(ctx.db, roomId);
  });
  if (revision !== null) ctx.events.roomChanged(roomId, revision);
  return buildSnapshot(ctx.db, roomId, sid);
}
