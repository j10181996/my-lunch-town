/** 固定表情清單，前後端共用，不接受任意聊天文字。 */
export const EMOTES = [
  { id: "wave", icon: "👋", label: "揮揮手", text: "👋 嗨，一起吃飯！" },
  { id: "heart", icon: "❤️", label: "比愛心", text: "❤️ 今天也要好好吃飯" },
  { id: "yum", icon: "😋", label: "好想吃", text: "😋 這家看起來好好吃！" },
  { id: "party", icon: "🎉", label: "開心慶祝", text: "🎉 午餐時間到！" },
] as const;
export type EmoteId = typeof EMOTES[number]["id"];

/** 推薦給大家（#91）的泡泡文字；名牌已顯示是誰，這裡只寫餐點。 */
export function recommendText(mealName: string) {
  return `👍 推薦「${mealName}」！`;
}
