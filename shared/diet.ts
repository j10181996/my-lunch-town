/**
 * 飲食標籤沿用餐點既有的自由標籤欄位：店家勾選標準標籤，就以標準名稱存進 tags；
 * 舊資料或手打的常見寫法（例如「素」）透過別名一併辨識，不需要資料遷移。
 */
export const DIET_TAGS = ["素食", "全素", "辣", "含蛋", "含奶", "含海鮮", "含堅果", "含牛肉"] as const;
export type DietTag = (typeof DIET_TAGS)[number];

const ALIASES: Record<string, DietTag> = {
  素: "素食", 蛋奶素: "素食", 奶蛋素: "素食", 方便素: "素食",
  純素: "全素", 植物性: "全素",
  小辣: "辣", 中辣: "辣", 大辣: "辣", 麻辣: "辣", 微辣: "辣",
  蛋: "含蛋",
  奶: "含奶", 乳製品: "含奶",
  海鮮: "含海鮮", 蝦: "含海鮮",
  堅果: "含堅果", 花生: "含堅果",
  牛: "含牛肉", 牛肉: "含牛肉",
};

/** 團員可用的篩選：「只看」要求有該標籤，「不要」要求沒有該標籤。 */
export const DIET_FILTERS = [
  { key: "veg", label: "只看素食", require: "素食" },
  { key: "vegan", label: "只看全素", require: "全素" },
  { key: "no-spicy", label: "不辣", exclude: "辣" },
  { key: "no-egg", label: "不含蛋", exclude: "含蛋" },
  { key: "no-dairy", label: "不含奶", exclude: "含奶" },
  { key: "no-seafood", label: "不含海鮮", exclude: "含海鮮" },
  { key: "no-nuts", label: "不含堅果", exclude: "含堅果" },
  { key: "no-beef", label: "不含牛肉", exclude: "含牛肉" },
] as const satisfies ReadonlyArray<{ key: string; label: string; require?: DietTag; exclude?: DietTag }>;
export type DietFilterKey = (typeof DIET_FILTERS)[number]["key"];

export function isDietTag(tag: string): tag is DietTag {
  return (DIET_TAGS as readonly string[]).includes(tag);
}

/** 餐點標籤對應到的標準飲食標籤；全素一定也是素食。 */
export function dietTagsOf(tags: readonly string[]): Set<DietTag> {
  const out = new Set<DietTag>();
  for (const raw of tags) {
    const tag = raw.trim();
    const diet = isDietTag(tag) ? tag : ALIASES[tag];
    if (diet) out.add(diet);
  }
  if (out.has("全素")) out.add("素食");
  return out;
}

export function matchesDietFilters(tags: readonly string[], filters: Iterable<DietFilterKey>): boolean {
  const diet = dietTagsOf(tags);
  for (const key of filters) {
    const filter = DIET_FILTERS.find((f) => f.key === key);
    if (!filter) continue;
    if ("require" in filter && !diet.has(filter.require)) return false;
    if ("exclude" in filter && diet.has(filter.exclude)) return false;
  }
  return true;
}

/** 預算狀態；budget 為 null 或 0 表示未設定。 */
export function budgetStatus(totalTwd: number, budgetTwd: number | null) {
  if (!budgetTwd || budgetTwd <= 0) return null;
  const remainingTwd = budgetTwd - totalTwd;
  return { budgetTwd, remainingTwd, over: remainingTwd < 0 };
}
