/** 計價、彙總與匯出文字：純函式，前後端共用並由測試直接驗證。金額一律整數新台幣。 */
import type { Catalog, MealTotal, OrderItem, StoreTotal } from "./contracts";

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

/** 依菜單的店家與餐點順序分組；先以 mealId 加總數量再算小計。 */
export function computeStoreTotals(catalog: Catalog, items: OrderItem[]): StoreTotal[] {
  const qtyByMeal = new Map<string, { quantity: number; unit: number }>();
  for (const it of items) {
    const cur = qtyByMeal.get(it.mealId);
    if (cur) cur.quantity += it.quantity;
    else qtyByMeal.set(it.mealId, { quantity: it.quantity, unit: it.unitPriceTwd });
  }
  const result: StoreTotal[] = [];
  for (const store of catalog.stores) {
    const meals: MealTotal[] = [];
    for (const meal of catalog.meals) {
      if (meal.storeId !== store.id) continue;
      const q = qtyByMeal.get(meal.id);
      if (!q || q.quantity <= 0) continue;
      meals.push({
        mealId: meal.id,
        name: meal.name,
        unitPriceTwd: q.unit,
        quantity: q.quantity,
        subtotalTwd: q.quantity * q.unit,
      });
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

/** 依菜單順序排序個人品項。 */
export function sortItemsByCatalog(catalog: Catalog, items: OrderItem[]): OrderItem[] {
  const order = new Map(catalog.meals.map((m, i) => [m.id, i]));
  return [...items].sort((a, b) => (order.get(a.mealId) ?? 0) - (order.get(b.mealId) ?? 0));
}

/** 規格第 11 節的匯出格式。 */
export function buildExportText(
  title: string,
  catalog: Catalog,
  stores: StoreTotal[],
  people: PersonLine[],
): string {
  const mealName = new Map(catalog.meals.map((m) => [m.id, m.name]));
  const lines: string[] = [`${title} 已收單`, ""];
  for (const s of stores) {
    lines.push(s.name);
    for (const m of s.meals) {
      lines.push(`${m.name} ${m.quantity} 份 × ${m.unitPriceTwd} 元 = ${m.subtotalTwd} 元`);
    }
    lines.push(`店家小計 ${s.totalTwd} 元`, "");
  }
  const g = grandTotals(stores);
  lines.push(`合計 ${g.totalQuantity} 份 ${g.totalTwd} 元`);
  const withItems = people.filter((p) => p.items.length > 0);
  if (withItems.length > 0) {
    lines.push("", "個人明細");
    for (const p of withItems) {
      const parts = sortItemsByCatalog(catalog, p.items).map(
        (it) => `${mealName.get(it.mealId) ?? it.mealId} × ${it.quantity}`,
      );
      lines.push(`${p.nickname} ${parts.join(" ")} 共 ${p.totalTwd} 元`);
    }
  }
  return lines.join("\n");
}
