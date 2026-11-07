import { socialEnabled } from "./social-schema";
import { EMOTES, recommendText } from "../../shared/social";
import type { Ctx } from "../context";
import { err } from "../db";
import { requireMember } from "./rooms";

export async function setSocial(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const { me } = await requireMember(ctx.db, roomId, sid);
  const enabled = (input as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") throw err.invalid("請選擇是否開啟社交互動");
  await ctx.db.prepare(`INSERT INTO member_social (member_id, enabled) VALUES (?, ?)
    ON CONFLICT(member_id) DO UPDATE SET enabled = excluded.enabled`).bind(me.id, enabled ? 1 : 0).run();
  // 清除他人尚在顯示的泡泡；不包含訂單或修改 revision。
  if (!enabled) ctx.events.bubble(roomId, me.id, "");
  return { enabled };
}

/** 和表情共用頻率限制：每人每秒最多一則；被擋下時回 false。 */
async function takeEmoteSlot(ctx: Ctx, memberId: string) {
  const now = Date.now();
  const { meta } = await ctx.db.prepare(`INSERT INTO member_social (member_id, enabled, last_emote_at) VALUES (?, 1, ?)
    ON CONFLICT(member_id) DO UPDATE SET last_emote_at = excluded.last_emote_at
    WHERE member_social.last_emote_at <= ?`).bind(memberId, now, now - 1000).run();
  return meta.changes > 0;
}

/** 推薦給大家（#91）：只能推薦本團收單中的餐點，泡泡文字由伺服器組成，不接受任意文字。 */
export async function recommendMeal(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const { room, me } = await requireMember(ctx.db, roomId, sid);
  const mealId = (input as { mealId?: unknown } | null)?.mealId;
  if (typeof mealId !== "string") throw err.invalid("請選擇要推薦的餐點");
  if (room.status !== "open") throw err.closed();
  const meal = await ctx.db.prepare("SELECT name FROM room_meals WHERE room_id = ? AND meal_id = ? AND available = 1")
    .bind(roomId, mealId).first<{ name: string }>();
  if (!meal) throw err.invalid("這道餐點不在本團菜單上");
  if (!await socialEnabled(ctx.db, me.id)) throw err.notAllowed("請先開啟社交互動");
  if (!await takeEmoteSlot(ctx, me.id)) throw err.invalid("慢一點，等一下再推薦");
  const text = recommendText(meal.name);
  ctx.events.bubble(roomId, me.id, text);
  return { text };
}

export async function sendEmote(ctx: Ctx, sid: string, roomId: string, input: unknown) {
  const { me } = await requireMember(ctx.db, roomId, sid);
  const emote = EMOTES.find((e) => e.id === (input as { emote?: unknown } | null)?.emote);
  if (!emote) throw err.invalid("不支援的表情");
  if (!await socialEnabled(ctx.db, me.id)) throw err.notAllowed("請先開啟社交互動");
  if (!await takeEmoteSlot(ctx, me.id)) throw err.invalid("慢一點，等一下再送表情");
  ctx.events.bubble(roomId, me.id, emote.text);
  return { text: emote.text };
}
