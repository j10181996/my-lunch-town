/**
 * 餐點選項與個人備註（#14）：純函式，前後端共用。
 * 選項群組隨餐點存在店家菜單，開團時與菜單一起凍結；點餐交易的鍵是「餐點 + 選項組合 + 備註」。
 * 驗證失敗拋出帶 code: "INVALID_INPUT" 的 Error，由 API 邊界轉成 err.invalid。
 */
import type { Id, MealOptionChoice, MealOptionGroup } from "./contracts";

export const MAX_OPTION_GROUPS = 4;
export const MAX_OPTION_CHOICES = 8;
export const MAX_OPTION_PRICE_TWD = 999;
export const MAX_NOTE_LENGTH = 30;
const GROUP_NAME_MAX = 10;
const CHOICE_NAME_MAX = 10;

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: "INVALID_INPUT" as const });
}

function name(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw invalid(`${label}必須是文字`);
  const v = value.trim().replace(/\s+/g, " ");
  if (v.length === 0 || [...v].length > max) throw invalid(`${label}需為 1–${max} 個字`);
  return v;
}

/**
 * 店家送出的選項群組。識別碼由位置決定（g0、g0c1），送入的 id 一律忽略：
 * 進行中的團用的是開團時凍結的副本，之後重排或改名不會影響已點的訂單。
 */
export function validateOptionGroups(input: unknown): MealOptionGroup[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw invalid("選項格式錯誤");
  if (input.length > MAX_OPTION_GROUPS) throw invalid(`每道餐點最多 ${MAX_OPTION_GROUPS} 組選項`);
  const groupNames = new Set<string>();
  return input.map((raw, gi): MealOptionGroup => {
    if (!raw || typeof raw !== "object") throw invalid("選項格式錯誤");
    const g = raw as Record<string, unknown>;
    const groupName = name(g.name, "選項群組名稱", GROUP_NAME_MAX);
    if (groupNames.has(groupName)) throw invalid(`選項群組「${groupName}」重複`);
    groupNames.add(groupName);
    if (!Array.isArray(g.choices) || g.choices.length === 0) throw invalid(`「${groupName}」至少要有一個選項`);
    if (g.choices.length > MAX_OPTION_CHOICES) throw invalid(`「${groupName}」最多 ${MAX_OPTION_CHOICES} 個選項`);
    const choiceNames = new Set<string>();
    const choices = g.choices.map((c, ci): MealOptionChoice => {
      if (!c || typeof c !== "object") throw invalid("選項格式錯誤");
      const choice = c as Record<string, unknown>;
      const choiceName = name(choice.name, "選項名稱", CHOICE_NAME_MAX);
      if (choiceNames.has(choiceName)) throw invalid(`「${groupName}」的選項「${choiceName}」重複`);
      choiceNames.add(choiceName);
      const price = choice.priceTwd ?? 0;
      if (!Number.isInteger(price) || (price as number) < 0 || (price as number) > MAX_OPTION_PRICE_TWD) {
        throw invalid(`選項加價需為 0–${MAX_OPTION_PRICE_TWD} 的整數`);
      }
      return { id: `g${gi}c${ci}`, name: choiceName, priceTwd: price as number };
    });
    const min = g.min ?? 0;
    const max = g.max ?? 1;
    if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 0 || (max as number) < 1
      || (min as number) > (max as number) || (max as number) > choices.length) {
      throw invalid(`「${groupName}」的可選數量設定不正確`);
    }
    return { id: `g${gi}`, name: groupName, min: min as number, max: max as number, choices };
  });
}

/** 讀取資料庫的 options_json；舊資料為 NULL。 */
export function parseOptionGroups(json: string | null | undefined): MealOptionGroup[] {
  return json ? (JSON.parse(json) as MealOptionGroup[]) : [];
}

/**
 * 驗證團員選的選項，回傳依菜單順序排好的選項識別碼與加價。
 * 單選群組（max 1）與必選群組（min ≥ 1）都在這裡檢查。
 */
export function resolveChoices(groups: MealOptionGroup[], input: unknown): { choiceIds: Id[]; surchargeTwd: number } {
  if (input === undefined || input === null) input = [];
  if (!Array.isArray(input) || input.length > MAX_OPTION_GROUPS * MAX_OPTION_CHOICES
    || input.some((v) => typeof v !== "string")) {
    throw invalid("選項格式錯誤");
  }
  const picked = new Set(input as string[]);
  if (picked.size !== input.length) throw invalid("選項重複");
  const choiceIds: Id[] = [];
  let surchargeTwd = 0;
  let matched = 0;
  for (const g of groups) {
    const chosen = g.choices.filter((c) => picked.has(c.id));
    if (chosen.length < g.min) throw invalid(g.min === 1 ? `請選擇「${g.name}」` : `「${g.name}」至少選 ${g.min} 項`);
    if (chosen.length > g.max) throw invalid(g.max === 1 ? `「${g.name}」只能選一項` : `「${g.name}」最多選 ${g.max} 項`);
    for (const c of chosen) {
      choiceIds.push(c.id);
      surchargeTwd += c.priceTwd;
    }
    matched += chosen.length;
  }
  if (matched !== picked.size) throw invalid("選項不在這道餐點的菜單上");
  return { choiceIds, surchargeTwd };
}

/** 個人備註：選填，去除前後空白並壓縮空白與換行；空字串表示沒有備註。 */
export function normalizeNote(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "string") throw invalid("備註必須是文字");
  const v = input.trim().replace(/\s+/g, " ");
  if ([...v].length > MAX_NOTE_LENGTH) throw invalid(`備註最多 ${MAX_NOTE_LENGTH} 個字`);
  return v;
}

/** 資料庫 option_key：依菜單順序的選項識別碼，以逗號串接；沒有選項為空字串。 */
export function optionKeyOf(choiceIds: readonly Id[]): string {
  return choiceIds.join(",");
}

export function choiceIdsOf(optionKey: string): Id[] {
  return optionKey ? optionKey.split(",") : [];
}

/**
 * 一筆點餐明細的識別鍵（前端 React key、待確認操作）。
 * 沒有選項與備註時就是 mealId，與升級前的行為相同。
 */
export function lineKeyOf(mealId: Id, choiceIds: readonly Id[] = [], note = ""): string {
  return choiceIds.length === 0 && note === "" ? mealId : JSON.stringify([mealId, choiceIds, note]);
}

/** 選項文字，例如「大辣、加飯」；沒有選項回空字串。 */
export function optionLabel(groups: MealOptionGroup[] | undefined, choiceIds: readonly Id[] | undefined): string {
  if (!groups?.length || !choiceIds?.length) return "";
  const names = new Map(groups.flatMap((g) => g.choices.map((c) => [c.id, c.name] as const)));
  return choiceIds.map((id) => names.get(id) ?? id).join("、");
}

/** 依菜單上的選項順序比較兩組選項，讓同一餐點的不同組合排序穩定。 */
export function compareChoices(groups: MealOptionGroup[] | undefined, a: readonly Id[], b: readonly Id[]): number {
  const order = new Map((groups ?? []).flatMap((g) => g.choices.map((c) => c.id)).map((id, i) => [id, i]));
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = (order.get(a[i]) ?? 0) - (order.get(b[i]) ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}
