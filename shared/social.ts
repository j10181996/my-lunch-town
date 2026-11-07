/** 固定表情清單，前後端共用，不接受任意聊天文字。 */
export const EMOTES = [
  { id: "wave", icon: "👋", label: "揮揮手", text: "👋 嗨，一起吃飯！" },
  { id: "heart", icon: "❤️", label: "比愛心", text: "❤️ 今天也要好好吃飯" },
  { id: "yum", icon: "😋", label: "好想吃", text: "😋 這家看起來好好吃！" },
  { id: "party", icon: "🎉", label: "開心慶祝", text: "🎉 午餐時間到！" },
] as const;
export type EmoteId = typeof EMOTES[number]["id"];

/** 可以隨角色位置廣播的成就徽章；前端成就清單（web/game/collection.ts）必須一致，測試會檢查。 */
export const BADGE_IDS = ["visit", "order", "friend", "collect", "shopkeeper", "regular"] as const;
export type BadgeId = typeof BADGE_IDS[number];
export function isBadgeId(value: unknown): value is BadgeId {
  return typeof value === "string" && (BADGE_IDS as readonly string[]).includes(value);
}
