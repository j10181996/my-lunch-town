import { useSyncExternalStore } from "react";
import { DIET_FILTERS, type DietFilterKey } from "../../shared/diet";

/** 團員個人偏好只存在這台裝置；讀寫失敗（私密模式）時退回本頁記憶體。 */
interface Prefs { filters: DietFilterKey[]; budgetTwd: number | null }

const KEY = "lt-order-prefs";
const listeners = new Set<() => void>();
let current: Prefs = load();

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    const keys = DIET_FILTERS.map((f) => f.key as string);
    const filters = Array.isArray(raw?.filters)
      ? raw.filters.filter((k): k is DietFilterKey => keys.includes(k as string)) : [];
    const budget = raw?.budgetTwd;
    return {
      filters,
      budgetTwd: typeof budget === "number" && Number.isSafeInteger(budget) && budget > 0 ? budget : null,
    };
  } catch {
    return { filters: [], budgetTwd: null };
  }
}

function save(next: Prefs) {
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 私密模式：只保留在本頁 */ }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useOrderPrefs() {
  const prefs = useSyncExternalStore(subscribe, () => current, () => current);
  return {
    ...prefs,
    toggleFilter(key: DietFilterKey) {
      const has = current.filters.includes(key);
      save({ ...current, filters: has ? current.filters.filter((k) => k !== key) : [...current.filters, key] });
    },
    clearFilters() { save({ ...current, filters: [] }); },
    setBudget(budgetTwd: number | null) { save({ ...current, budgetTwd }); },
  };
}
