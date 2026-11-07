/** 計價、彙總與匯出文字：純函式，前後端共用並由測試直接驗證。金額一律整數新台幣。 */
import type { Catalog, Meal, MealTotal, OrderItem, StoreTotal } from "./contracts";
import { compareChoices, lineKeyOf, optionKeyOf, optionLabel } from "./meal-options";

export interface PersonLine {
  memberId: string;
  nickname: string;
  items: OrderItem[];
  totalQuantity: number;
  totalTwd: number;
}

export function sumItems(items: OrderItem[]) {
  let totalQuantity = 0;
  let totalTwd = 0;
  for (const it of items) {
    totalQuantity += it.quantity;
    totalTwd += it.quantity * it.unitPriceTwd;
  }
  return { totalQuantity, totalTwd };
}

/**
 * 依菜單的店家與餐點順序分組；同一餐點依選項組合分列（#14），備註不分列。
 * 先以「餐點 + 選項」加總數量再算小計。沒有選項的列與升級前完全相同。
 */
export function computeStoreTotals(catalog: Catalog, items: OrderItem[]): StoreTotal[] {
  const byLine = new Map<string, { mealId: string; choiceIds: string[]; quantity: number; unit: number }>();
  for (const it of items) {
    const choiceIds = it.choiceIds ?? [];
    const key = `${it.mealId}\u0000${optionKeyOf(choiceIds)}`;
    const cur = byLine.get(key);
    if (cur) cur.quantity += it.quantity;
    else byLine.set(key, { mealId: it.mealId, choiceIds, quantity: it.quantity, unit: it.unitPriceTwd });
  }
  const result: StoreTotal[] = [];
  for (const store of catalog.stores) {
    const meals: MealTotal[] = [];
    for (const meal of catalog.meals) {
      if (meal.storeId !== store.id) continue;
      const lines = [...byLine.values()]
        .filter((l) => l.mealId === meal.id && l.quantity > 0)
        .sort((a, b) => compareChoices(meal.options, a.choiceIds, b.choiceIds));
      for (const q of lines) {
        const total: MealTotal = {
          mealId: meal.id,
          name: meal.name,
          unitPriceTwd: q.unit,
          quantity: q.quantity,
          subtotalTwd: q.quantity * q.unit,
        };
        if (q.choiceIds.length > 0) {
          total.choiceIds = q.choiceIds;
          total.optionLabel = optionLabel(meal.options, q.choiceIds);
          total.lineKey = lineKeyOf(meal.id, q.choiceIds);
        }
        meals.push(total);
      }
    }
    if (meals.length === 0) continue;
    result.push({
      storeId: store.id,
      name: store.name,
      meals,
      totalQuantity: meals.reduce((a, m) => a + m.quantity, 0),
      totalTwd: meals.reduce((a, m) => a + m.subtotalTwd, 0),
    });
  }
  return result;
}

export function grandTotals(stores: StoreTotal[]) {
  return {
    totalQuantity: stores.reduce((a, s) => a + s.totalQuantity, 0),
    totalTwd: stores.reduce((a, s) => a + s.totalTwd, 0),
  };
}

/** 依菜單順序排序個人品項；同一餐點依選項順序，再依備註（沒備註的在前）。 */
export function sortItemsByCatalog(catalog: Catalog, items: OrderItem[]): OrderItem[] {
  const order = new Map(catalog.meals.map((m, i) => [m.id, i]));
  const meals = new Map(catalog.meals.map((m) => [m.id, m]));
  return [...items].sort((a, b) =>
    (order.get(a.mealId) ?? 0) - (order.get(b.mealId) ?? 0)
    || compareChoices(meals.get(a.mealId)?.options, a.choiceIds ?? [], b.choiceIds ?? [])
    || (a.note ?? "").localeCompare(b.note ?? ""));
}

/** 餐點名稱加上選項，例如「招牌雞腿飯（大辣、加飯）」；沒有選項就是餐點名稱。 */
export function lineName(name: string, label: string | undefined): string {
  return label ? `${name}（${label}）` : name;
}

/** 個人明細的一筆：「名稱（選項）「備註」 × 數量」。 */
export function describeItem(meal: Pick<Meal, "name" | "options"> | undefined, item: OrderItem): string {
  const base = lineName(meal?.name ?? item.mealId, optionLabel(meal?.options, item.choiceIds));
  return `${base}${item.note ? `「${item.note}」` : ""} × ${item.quantity}`;
}

/** 規格第 11 節的匯出格式；有選項的餐點依選項分列，個人明細附備註。 */
export function buildExportText(
  title: string,
  catalog: Catalog,
  stores: StoreTotal[],
  people: PersonLine[],
): string {
  const meals = new Map(catalog.meals.map((m) => [m.id, m]));
  const lines: string[] = [`${title} 已收單`, ""];
  for (const s of stores) {
    lines.push(s.name);
    for (const m of s.meals) {
      lines.push(`${lineName(m.name, m.optionLabel)} ${m.quantity} 份 × ${m.unitPriceTwd} 元 = ${m.subtotalTwd} 元`);
    }
    lines.push(`店家小計 ${s.totalTwd} 元`, "");
  }
  const g = grandTotals(stores);
  lines.push(`合計 ${g.totalQuantity} 份 ${g.totalTwd} 元`);
  const withItems = people.filter((p) => p.items.length > 0);
  if (withItems.length > 0) {
    lines.push("", "個人明細");
    for (const p of withItems) {
      const parts = sortItemsByCatalog(catalog, p.items).map((it) => describeItem(meals.get(it.mealId), it));
      lines.push(`${p.nickname} ${parts.join(" ")} 共 ${p.totalTwd} 元`);
    }
  }
  return lines.join("\n");
}
