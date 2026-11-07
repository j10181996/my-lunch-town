import { useState } from "react";
import type { MealOptionGroup } from "../../shared/contracts";
import { MAX_OPTION_CHOICES, MAX_OPTION_GROUPS, MAX_OPTION_PRICE_TWD } from "../../shared/meal-options";

/** 編輯中的選項群組：數字欄位保留字串，送出時再轉換；識別碼由伺服器依位置產生。 */
export interface OptionDraft {
  name: string;
  required: boolean;
  max: number;
  choices: Array<{ name: string; price: string }>;
}

export function toDrafts(groups: MealOptionGroup[] | undefined): OptionDraft[] {
  return (groups ?? []).map((g) => ({
    name: g.name,
    required: g.min > 0,
    max: g.max,
    choices: g.choices.map((c) => ({ name: c.name, price: c.priceTwd ? String(c.priceTwd) : "" })),
  }));
}

/** 必選在介面上固定為至少一項；API 另外支援更大的 min。 */
export function fromDrafts(drafts: OptionDraft[]): MealOptionGroup[] {
  return drafts.map((g, gi) => ({
    id: `g${gi}`,
    name: g.name.trim(),
    min: g.required ? 1 : 0,
    max: Math.min(Math.max(1, g.max), Math.max(1, g.choices.length)),
    choices: g.choices.map((c, ci) => ({ id: `g${gi}c${ci}`, name: c.name.trim(), priceTwd: Number(c.price || 0) })),
  }));
}

export function describeDrafts(drafts: OptionDraft[]): string {
  return drafts.length === 0 ? "沒有選項" : drafts.map((g) => g.name || "未命名").join("、");
}

/** 選項群組編輯器：例如「辣度（必選、單選）」「加點（選填、最多 2 項，可加價）」。 */
export function MealOptionsEditor({ value, onApply, onCancel }: {
  value: OptionDraft[];
  onApply(next: OptionDraft[]): void;
  onCancel(): void;
}) {
  const [groups, setGroups] = useState<OptionDraft[]>(value);
  const update = (gi: number, patch: Partial<OptionDraft>) =>
    setGroups((all) => all.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const updateChoice = (gi: number, ci: number, patch: Partial<OptionDraft["choices"][number]>) =>
    update(gi, { choices: groups[gi].choices.map((c, i) => (i === ci ? { ...c, ...patch } : c)) });
  const complete = groups.every((g) => g.name.trim() && g.choices.length > 0 && g.choices.every((c) => c.name.trim()));

  return (
    <div className="option-editor">
      <p className="muted" style={{ margin: 0 }}>
        團員點餐時依這裡的設定選擇，加價會算進單價。修改只影響之後開的團。
      </p>
      {groups.map((g, gi) => (
        <fieldset key={gi}>
          <div className="row">
            <input type="text" value={g.name} maxLength={10} placeholder="群組名稱，例如：辣度" aria-label={`第 ${gi + 1} 組名稱`}
              onChange={(e) => update(gi, { name: e.target.value })} />
            <button type="button" className="btn small square" aria-label={`刪除第 ${gi + 1} 組`}
              onClick={() => setGroups((all) => all.filter((_, i) => i !== gi))}>✕</button>
          </div>
          <div className="row">
            <label className="chip">
              <input type="checkbox" checked={g.required} onChange={(e) => update(gi, { required: e.target.checked })} />
              必選
            </label>
            <label className="row" style={{ gap: 4 }}>
              最多選
              <select value={g.max} onChange={(e) => update(gi, { max: Number(e.target.value) })} aria-label={`第 ${gi + 1} 組最多選幾項`}>
                {Array.from({ length: Math.max(1, g.choices.length) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n === 1 ? "1 項（單選）" : `${n} 項`}</option>
                ))}
              </select>
            </label>
          </div>
          {g.choices.map((c, ci) => (
            <div className="row" key={ci}>
              <input type="text" value={c.name} maxLength={10} placeholder="選項，例如：小辣" aria-label={`第 ${gi + 1} 組第 ${ci + 1} 個選項`}
                onChange={(e) => updateChoice(gi, ci, { name: e.target.value })} />
              <input type="text" inputMode="numeric" className="price-input" value={c.price} placeholder="+0"
                aria-label={`第 ${gi + 1} 組第 ${ci + 1} 個選項加價`}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
                  updateChoice(gi, ci, { price: digits && Number(digits) > MAX_OPTION_PRICE_TWD ? String(MAX_OPTION_PRICE_TWD) : digits });
                }} />
              <button type="button" className="btn small square" aria-label={`刪除第 ${gi + 1} 組第 ${ci + 1} 個選項`}
                onClick={() => update(gi, {
                  choices: g.choices.filter((_, i) => i !== ci),
                  max: Math.min(g.max, Math.max(1, g.choices.length - 1)),
                })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn small" disabled={g.choices.length >= MAX_OPTION_CHOICES}
            onClick={() => update(gi, { choices: [...g.choices, { name: "", price: "" }] })}>新增選項</button>
        </fieldset>
      ))}
      <button type="button" className="btn" disabled={groups.length >= MAX_OPTION_GROUPS}
        onClick={() => setGroups((all) => [...all, { name: "", required: false, max: 1, choices: [{ name: "", price: "" }] }])}>
        新增選項群組
      </button>
      <div className="row">
        <button type="button" className="btn primary" disabled={!complete} onClick={() => onApply(groups)}>套用</button>
        <button type="button" className="btn ghost" onClick={onCancel}>取消</button>
      </div>
      {!complete && <small className="muted">每組都要有名稱與至少一個有名稱的選項。</small>}
    </div>
  );
}
