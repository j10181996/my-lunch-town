import { socialEnabled } from "./social-schema";
import { EMOTES } from "../../shared/social";
import type { Ctx } from "../context";
import { err } from "../db";
import { requireMember } from "./rooms";

export function setSocial(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const { me } = requireMember(ctx.db, roomId, sid);
  const enabled = (input as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") throw err.invalid("請選擇是否開啟社交互動");
  ctx.db.prepare(`INSERT INTO member_social (member_id, enabled) VALUES (?, ?)
    ON CONFLICT(member_id) DO UPDATE SET enabled = excluded.enabled`).run(me.id, enabled ? 1 : 0);
  // 清除他人尚在顯示的泡泡；不包含訂單或修改 revision。
  if (!enabled) ctx.events.bubble(roomId, me.id, "");
  return { enabled };
}

export function sendEmote(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const { me } = requireMember(ctx.db, roomId, sid);
  const emote = EMOTES.find((e) => e.id === (input as { emote?: unknown } | null)?.emote);
  if (!emote) throw err.invalid("不支援的表情");
  if (!socialEnabled(ctx.db, me.id)) throw err.notAllowed("請先開啟社交互動");
  const now = Date.now();
  const sent = ctx.db.prepare(`INSERT INTO member_social (member_id, enabled, last_emote_at) VALUES (?, 1, ?)
    ON CONFLICT(member_id) DO UPDATE SET last_emote_at = excluded.last_emote_at
    WHERE member_social.last_emote_at <= ?`).run(me.id, now, now - 1000);
  if (!sent.changes) throw err.invalid("慢一點，等一下再送表情");
  ctx.events.bubble(roomId, me.id, emote.text);
  return { text: emote.text };
}
