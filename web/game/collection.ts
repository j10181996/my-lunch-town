import { hashSeed, safeSpot } from "./town-life";

export const ACHIEVEMENTS = [
  { id: "visit", icon: "🚪", name: "小鎮探險家", description: "第一次走進店裡" },
  { id: "order", icon: "🍱", name: "開飯啦", description: "第一次成功點餐" },
  { id: "friend", icon: "🐾", name: "毛孩好朋友", description: "第一次摸摸小動物" },
  { id: "collect", icon: "🌼", name: "口袋收藏家", description: "撿起一件街區小物" },
] as const;
export type AchievementId = typeof ACHIEVEMENTS[number]["id"];
export type Accessory = "none" | "flower" | "leaf" | "cap";
export interface Collection { items: string[]; achievements: AchievementId[]; accessory: Accessory; badge: boolean }
export const ACCESSORIES: Array<{ id: Accessory; label: string; icon: string }> = [
  { id: "none", label: "原本造型", icon: "🙂" }, { id: "flower", label: "小花髮飾", icon: "🌼" },
  { id: "leaf", label: "葉子帽", icon: "🌿" }, { id: "cap", label: "午餐小帽", icon: "🧢" },
];
const initial = (): Collection => ({ items: [], achievements: [], accessory: "none", badge: true });
const key = (room: string, member: string) => `lunch-town:collection:v1:${room}:${member}`;
export function readCollection(room: string, member: string): Collection {
  try {
    const data = JSON.parse(localStorage.getItem(key(room, member)) ?? "null");
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.achievements)) return initial();
    return { items: [...new Set<string>(data.items.filter((x: unknown) => typeof x === "string"))].slice(-100),
      achievements: ACHIEVEMENTS.filter((a) => data.achievements.includes(a.id)).map((a) => a.id),
      accessory: ACCESSORIES.find((a) => a.id === data.accessory)?.id ?? "none", badge: data.badge !== false };
  } catch { return initial(); }
}
export function saveCollection(room: string, member: string, data: Collection) {
  try { localStorage.setItem(key(room, member), JSON.stringify(data)); } catch { /* 儲存受限時本分頁仍可遊玩。 */ }
}
export function collectibles(room: string, member: string) {
  const seed = hashSeed(`${room}:${member}`);
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  return [[504, 368], [552, 408], [464, 336], [720, 328], [600, 472]].map(([x, y], i) => {
    const [px, py] = safeSpot(x + ((seed >>> (i * 3)) % 3 - 1) * 8, y);
    return { id: `${date}:${i}`, x: px, y: py, icon: ["🌼", "🍃", "⭐", "🌸", "🍀"][i] };
  });
}
