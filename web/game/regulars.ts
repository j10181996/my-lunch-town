/**
 * 店主認得常客（#88）與每日試吃（#89）。
 * 成員 id 每團不同、目前也沒有登入（#38），所以紀錄以瀏覽器為單位、跨團共用，只存在 localStorage。
 */
import { hashSeed } from "./town-life";

export interface StoreRecord {
  /** 造訪天數：同一家店同一天（台北）只算一次。 */
  visits: number;
  lastVisitDay: string;
  /** 點過的餐點名稱與份數，用來推算最常點。 */
  meals: Record<string, number>;
  /** 最後一次試吃的日期（台北）。 */
  tastedDay?: string;
}
export interface Snack { id: string; icon: string; name: string; storeName: string; day: string }
export interface Regulars {
  stores: Record<string, StoreRecord>;
  /** 已記錄過點餐的團，避免同一團重複累計。 */
  rooms: string[];
  snacks: Snack[];
}

/** 造訪滿幾天算常客。 */
export const REGULAR_VISITS = 5;
const MAX_ROOMS = 50;
const MAX_SNACKS = 30;
const KEY = "lunch-town:regulars:v1";

export const SNACKS = [
  { icon: "🍙", name: "迷你飯糰" }, { icon: "🥟", name: "煎餃" }, { icon: "🍡", name: "糰子" },
  { icon: "🍮", name: "布丁" }, { icon: "🧋", name: "小杯奶茶" }, { icon: "🍢", name: "關東煮" },
] as const;

export const emptyRegulars = (): Regulars => ({ stores: {}, rooms: [], snacks: [] });

export function taipeiDay(now: number) {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

const blank = (): StoreRecord => ({ visits: 0, lastVisitDay: "", meals: {} });

/** 進店：同一家店同一天只算一次造訪。 */
export function recordVisit(data: Regulars, storeId: string, day: string): Regulars {
  const store = data.stores[storeId] ?? blank();
  if (store.lastVisitDay === day) return data;
  return { ...data, stores: { ...data.stores, [storeId]: { ...store, visits: store.visits + 1, lastVisitDay: day } } };
}

/** 收單後記下自己點的餐點；同一團只記一次。 */
export function recordMeals(data: Regulars, roomId: string, items: Array<{ storeId: string; name: string; quantity: number }>): Regulars {
  if (data.rooms.includes(roomId) || !items.length) return data;
  const stores = { ...data.stores };
  for (const item of items) {
    const store = stores[item.storeId] ?? blank();
    stores[item.storeId] = { ...store, meals: { ...store.meals, [item.name]: (store.meals[item.name] ?? 0) + item.quantity } };
  }
  return { ...data, stores, rooms: [...data.rooms, roomId].slice(-MAX_ROOMS) };
}

export function favoriteMeal(store: StoreRecord | undefined): string | null {
  let best: string | null = null, count = 0;
  for (const [name, n] of Object.entries(store?.meals ?? {})) if (n > count) { best = name; count = n; }
  return best;
}

/** 依熟客程度打招呼；沒有紀錄時回 null，交給一般的時段招呼。 */
export function regularGreeting(store: StoreRecord | undefined): string | null {
  if (!store || store.visits < 1) return null;
  if (store.visits === 1) return "第一次來嗎？歡迎光臨！";
  if (store.visits < REGULAR_VISITS) return "又見面了！歡迎回來～";
  const favorite = favoriteMeal(store);
  return favorite ? `又來啦！今天也是${favorite}？` : "老朋友來啦！老位子留給你～";
}

/** 每家店每天第一次聊天可以試吃一次；回傳更新後的紀錄與拿到的點心。 */
export function tryTasting(data: Regulars, storeId: string, storeName: string, day: string): { data: Regulars; snack: Snack } | null {
  const store = data.stores[storeId] ?? blank();
  if (store.tastedDay === day) return null;
  const pick = SNACKS[hashSeed(`${storeId}:${day}`) % SNACKS.length];
  const snack: Snack = { id: `${day}:${storeId}`, icon: pick.icon, name: pick.name, storeName, day };
  return {
    snack,
    data: { ...data, stores: { ...data.stores, [storeId]: { ...store, tastedDay: day } }, snacks: [...data.snacks, snack].slice(-MAX_SNACKS) },
  };
}

export function readRegulars(): Regulars {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw.stores !== "object" || !Array.isArray(raw.rooms) || !Array.isArray(raw.snacks)) return emptyRegulars();
    return { stores: raw.stores, rooms: raw.rooms.filter((x: unknown) => typeof x === "string"), snacks: raw.snacks };
  } catch { return emptyRegulars(); }
}

export function saveRegulars(data: Regulars) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 儲存受限時本分頁仍可遊玩，只是不會記得。 */ }
}
