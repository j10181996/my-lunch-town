import { useState } from "react";
import type { Meal, MealOptionGroup, OrderItem, OwnerSummary, RoomSnapshot, Store, StreetStore } from "../../shared/contracts";
import { budgetStatus, DIET_FILTERS, dietTagsOf, matchesDietFilters } from "../../shared/diet";
import { describeDelivery, describeFulfillment, evaluateStoreDelivery } from "../../shared/delivery";
import { MAX_NOTE_LENGTH, optionLabel } from "../../shared/meal-options";
import { describeItem, lineName } from "../../shared/pricing";
import { styleOf } from "../../shared/town";
import { drawIcon } from "../art/scenes";
import { ctxOf, makeCanvas } from "../art/pixel";
import { pendingKeyOf, type LineRef, type Pending } from "../state/useRoom";
import { MealImg, money, OrderStatusBadge } from "../ui";
import { useOrderPrefs } from "./preferences";

export interface OrderingProps {
  snap: RoomSnapshot;
  pending: Record<string, Pending>;
  canEdit: boolean;
  change(line: string | LineRef, delta: 1 | -1): void;
}

/** 同一餐點各種選項與備註的合計份數。 */
function qtyOf(snap: RoomSnapshot, mealId: string) {
  return snap.myItems.filter((i) => i.mealId === mealId).reduce((sum, i) => sum + i.quantity, 0);
}

const lineOf = (it: OrderItem): LineRef => ({ mealId: it.mealId, choiceIds: it.choiceIds ?? [], note: it.note ?? "" });

function StoreIcon({ store }: { store: Pick<Store, "styleKey"> }) {
  const [src] = useState(() => {
    const c = makeCanvas(12, 12);
    drawIcon(ctxOf(c), styleOf(store.styleKey).icon, 1, 1);
    return c.toDataURL();
  });
  return <img className="pixel" src={src} alt="" width={36} height={36} />;
}

/** 店內右側：該店菜單。 */
export function MenuPanel({
  snap,
  pending,
  canEdit,
  change,
  store,
  focusMealId,
}: OrderingProps & { store: Store; focusMealId?: string | null }) {
  const prefs = useOrderPrefs();
  const storeMeals = snap.catalog.meals.filter((m) => m.storeId === store.id);
  // 已點的餐點即使不符合篩選也保留，才能減量。
  const meals = storeMeals.filter((m) => qtyOf(snap, m.id) > 0 || matchesDietFilters(m.tags, prefs.filters));
  const hidden = storeMeals.length - meals.length;
  const budget = budgetStatus(snap.myTotalTwd, prefs.budgetTwd);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterId = `diet-filter-${store.id}`;
  return (
    <section className="stack menu-panel" aria-label={`${store.name} 菜單`}>
      {/* 頂部固定：菜單再長也看得到店名、外送、篩選入口與預算。 */}
      <div className="menu-head">
        <div className="shop-head">
          <StoreIcon store={store} />
          <div>
            <h2>{store.name}</h2>
            {store.address && <div className="muted">📍 {store.address}</div>}
            <DeliveryStatus snap={snap} store={store} />
          </div>
        </div>
        <div className="menu-tools">
          <button type="button" className={`btn small${prefs.filters.length > 0 ? " green" : ""}`}
            aria-expanded={filtersOpen} aria-controls={filterId} onClick={() => setFiltersOpen((o) => !o)}>
            篩選{prefs.filters.length > 0 ? `（已選 ${prefs.filters.length} 項）` : ""} {filtersOpen ? "▴" : "▾"}
          </button>
          {budget && <span className={`budget-chip${budget.over ? " over" : ""}`} role="status">
            {budget.over ? `超出預算 ${money(-budget.remainingTwd)}` : `預算剩 ${money(budget.remainingTwd)}`}
          </span>}
        </div>
        {filtersOpen && <DietFilterBar id={filterId} />}
      </div>
      <div className="muted">選好餐點，按 ＋1 加入訂單；有選項的餐點選完再加入，也可以加備註</div>
      <div className="menu">
        {meals.map((m) => (
          <MealRow key={m.id} focused={m.id === focusMealId} meal={m} lines={snap.myItems.filter((i) => i.mealId === m.id)}
            pending={Object.values(pending).find((p) => p.mealId === m.id)} canEdit={canEdit} change={change}
            overBudget={!!budget && m.priceTwd > Math.max(0, budget.remainingTwd)} />
        ))}
        {storeMeals.length === 0 && <div className="muted">這家店在本團沒有可點的餐點。</div>}
        {storeMeals.length > 0 && meals.length === 0 && <div className="muted">沒有符合篩選條件的餐點。</div>}
        {hidden > 0 && <div className="row diet-hidden">
          <span className="muted">已依篩選隱藏 {hidden} 道</span>
          <button type="button" className="btn small" onClick={prefs.clearFilters}>顯示全部</button>
        </div>}
      </div>
    </section>
  );
}

/** 不在本團的店（#78）：唯讀菜單，只能看，不能加點。 */
export function StreetMenuPanel({ store, focusMealId }: { store: StreetStore; focusMealId?: string | null }) {
  const meals = store.meals ?? [];
  return (
    <section className="stack menu-panel" aria-label={`${store.name} 菜單`}>
      <div className="menu-head">
        <div className="shop-head">
          <StoreIcon store={store} />
          <div><h2>{store.name}</h2></div>
        </div>
      </div>
      <div className="banner info">這家不在本團，只能看菜單，不能點餐。想吃這家可以另外開一團。</div>
      <div className="menu">
        {meals.map((m) => (
          <div key={m.id} className={`meal-row${m.id === focusMealId ? " focused" : ""}`}
            ref={(el) => { if (m.id === focusMealId && el) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}>
            <MealImg assetKey={m.imageAssetKey} alt={m.name} />
            <div>
              <div className="meal-name">{m.name}</div>
              <div className="price">{money(m.priceTwd)}</div>
              <div>{m.tags.map((t) => <span className={`tag${dietTagsOf([t]).size > 0 ? " diet" : ""}`} key={t}>{t}</span>)}</div>
            </div>
          </div>
        ))}
        {meals.length === 0 && <div className="muted">這家目前沒有供應中的餐點。</div>}
      </div>
    </section>
  );
}

/** 飲食篩選：依店家標示，過敏者仍須向店家確認。 */
function DietFilterBar({ id }: { id?: string }) {
  const prefs = useOrderPrefs();
  return (
    <fieldset className="diet-filter" id={id}>
      <legend>飲食篩選</legend>
      <div className="chips">
        {DIET_FILTERS.map((f) => (
          <label key={f.key} className={`chip${prefs.filters.includes(f.key) ? " on" : ""}`}>
            <input type="checkbox" checked={prefs.filters.includes(f.key)} onChange={() => prefs.toggleFilter(f.key)} />
            {f.label}
          </label>
        ))}
      </div>
      {prefs.filters.length > 0 && <small className="muted">依店家標示篩選；有過敏請直接向店家確認。</small>}
    </fieldset>
  );
}

function BudgetBanner({ budget }: { budget: NonNullable<ReturnType<typeof budgetStatus>> }) {
  return budget.over ? (
    <div className="banner error" role="status">已超出預算 {money(-budget.remainingTwd)}（預算 {money(budget.budgetTwd)}）</div>
  ) : (
    <div className="banner ok" role="status">預算還剩 {money(budget.remainingTwd)}</div>
  );
}

/** 預算只存在本機，點餐超過時在菜單與我的訂單提醒。 */
function BudgetEditor({ totalTwd }: { totalTwd: number }) {
  const prefs = useOrderPrefs();
  const [draft, setDraft] = useState(prefs.budgetTwd ? String(prefs.budgetTwd) : "");
  const budget = budgetStatus(totalTwd, prefs.budgetTwd);
  return (
    <div className="stack budget">
      <label className="field">
        我的預算 <small>選填，只存在這台裝置</small>
        <input type="text" inputMode="numeric" placeholder="例如 150" value={draft}
          onChange={(e) => {
            const value = e.target.value.replace(/[^\d]/g, "").slice(0, 5);
            setDraft(value);
            prefs.setBudget(value ? Number(value) || null : null);
          }} />
      </label>
      {budget && <BudgetBanner budget={budget} />}
    </div>
  );
}

function MealRow({
  focused,
  meal,
  lines,
  pending,
  canEdit,
  change,
  overBudget,
}: {
  focused?: boolean;
  overBudget?: boolean;
  meal: Meal;
  lines: OrderItem[];
  pending?: Pending;
  canEdit: boolean;
  change(line: string | LineRef, delta: 1 | -1): void;
}) {
  const [choosing, setChoosing] = useState(false);
  const busy = !!pending;
  const qty = lines.reduce((sum, i) => sum + i.quantity, 0);
  const hasOptions = (meal.options?.length ?? 0) > 0;
  // 只有一筆明細時才能在菜單上直接減量；多種組合請到「我的訂單」調整。
  const only = lines.length === 1 ? lines[0] : null;
  return (
    <div
      className={`meal-row${focused ? " focused" : ""}${choosing ? " choosing" : ""}`}
      ref={(el) => {
        if (focused && el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }}
    >
      <MealImg assetKey={meal.imageAssetKey} alt={meal.name} />
      <div>
        <div className="meal-name">{meal.name}</div>
        <div className="price">{money(meal.priceTwd)}{hasOptions && <small className="muted"> 起</small>}</div>
        <div>
          {meal.tags.map((t) => (
            <span className={`tag${dietTagsOf([t]).size > 0 ? " diet" : ""}`} key={t}>
              {t}
            </span>
          ))}
          {overBudget && <span className="tag over-budget">超出預算</span>}
        </div>
        {!choosing && canEdit && meal.available && (
          <button type="button" className="link-btn" onClick={() => setChoosing(true)}>
            {hasOptions ? "選項／備註" : "加備註"}
          </button>
        )}
      </div>
      <div className="stack" style={{ justifyItems: "end" }}>
        <button
          className="btn plus"
          disabled={!canEdit || busy || !meal.available}
          onClick={() => (hasOptions ? setChoosing(true) : change(meal.id, 1))}
          aria-label={hasOptions ? `${meal.name} 選擇選項` : `${meal.name} 加一份`}
        >
          {busy && pending?.delta === 1 ? "…" : "+1"}
        </button>
        {qty > 0 && (
          <div className="qty-ctrl">
            {only && (
              <button className="btn small" disabled={!canEdit || busy} onClick={() => change(lineOf(only), -1)} aria-label={`${meal.name} 減一份`}>
                −
              </button>
            )}
            <span className="qty" aria-label={`已點 ${qty} 份`}>
              {busy ? "…" : qty}
            </span>
          </div>
        )}
        {qty > 0 && !only && <small className="muted">到我的訂單調整</small>}
      </div>
      {choosing && (
        <OptionChooser
          meal={meal}
          disabled={!canEdit || busy || !meal.available}
          onCancel={() => setChoosing(false)}
          onAdd={(choiceIds, note) => {
            change({ mealId: meal.id, choiceIds, note }, 1);
            setChoosing(false);
          }}
        />
      )}
    </div>
  );
}

/** 依店家設定挑選項（單選、複選、必選）並寫備註；選完才加入一份。 */
function OptionChooser({ meal, disabled, onAdd, onCancel }: {
  meal: Meal;
  disabled: boolean;
  onAdd(choiceIds: string[], note: string): void;
  onCancel(): void;
}) {
  const groups: MealOptionGroup[] = meal.options ?? [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const toggle = (g: MealOptionGroup, id: string) => setPicked((prev) => {
    const cur = prev[g.id] ?? [];
    if (cur.includes(id)) return { ...prev, [g.id]: cur.filter((c) => c !== id) };
    if (g.max === 1) return { ...prev, [g.id]: [id] };
    if (cur.length >= g.max) return prev;
    return { ...prev, [g.id]: [...cur, id] };
  });
  // 依菜單順序送出，與伺服器的組合鍵一致。
  const chosen = groups.flatMap((g) => g.choices.filter((c) => picked[g.id]?.includes(c.id)));
  const choiceIds = chosen.map((c) => c.id);
  const missing = groups.find((g) => (picked[g.id]?.length ?? 0) < g.min);
  const unit = meal.priceTwd + chosen.reduce((sum, c) => sum + c.priceTwd, 0);
  return (
    <div className="option-chooser stack">
      {groups.map((g) => (
        <fieldset key={g.id} className="option-group">
          <legend>
            {g.name}{" "}
            <small className="muted">
              {g.min > 0 ? (g.max === 1 ? "必選" : `必選 ${g.min}–${g.max} 項`) : g.max === 1 ? "選填" : `選填，最多 ${g.max} 項`}
            </small>
          </legend>
          <div className="chips">
            {g.choices.map((c) => {
              const on = picked[g.id]?.includes(c.id) ?? false;
              return (
                <button type="button" key={c.id} className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(g, c.id)}>
                  {c.name}{c.priceTwd > 0 && <small> +{c.priceTwd}</small>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <label className="field">
        備註 <small>選填，最多 {MAX_NOTE_LENGTH} 字</small>
        <input type="text" value={note} maxLength={MAX_NOTE_LENGTH} placeholder="例如：不要香菜"
          onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row option-actions">
        <button type="button" className="btn primary" disabled={disabled || !!missing}
          onClick={() => onAdd(choiceIds, note.trim())}
          aria-label={`${lineName(meal.name, optionLabel(groups, choiceIds))} 加一份`}>
          {missing ? `請選擇「${missing.name}」` : `加入 ${money(unit)}`}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

/** 店內底部固定的訂單列：份數、金額與預算，點擊捲到訂單明細。 */
export function OrderBar({ snap, onShow }: { snap: RoomSnapshot; onShow(): void }) {
  const prefs = useOrderPrefs();
  const budget = budgetStatus(snap.myTotalTwd, prefs.budgetTwd);
  return (
    <button type="button" className={`order-bar${budget?.over ? " over" : ""}`} onClick={onShow}>
      <span>我的訂單 {snap.myTotalQuantity} 份</span>
      <strong>{money(snap.myTotalTwd)}</strong>
      {budget && <span>{budget.over ? `超出 ${money(-budget.remainingTwd)}` : `預算剩 ${money(budget.remainingTwd)}`}</span>}
      <span className="order-bar-go" aria-hidden="true">明細 ▾</span>
    </button>
  );
}

/** 我的訂單：跨店，依店家分組。 */
export function MyOrder({ snap, pending, canEdit, change }: OrderingProps) {
  const byStore = snap.catalog.stores
    .map((s) => ({
      store: s,
      items: snap.myItems.filter((i) => snap.catalog.meals.find((m) => m.id === i.mealId)?.storeId === s.id),
    }))
    .filter((g) => g.items.length > 0);
  const name = (it: OrderItem) => {
    const meal = snap.catalog.meals.find((m) => m.id === it.mealId);
    return lineName(meal?.name ?? it.mealId, optionLabel(meal?.options, it.choiceIds));
  };

  return (
    <section className="stack" aria-label="我的訂單">
      <h3 className="section-title">我的訂單</h3>
      {byStore.length === 0 ? (
        <div className="muted">還沒選餐，進店看看吧</div>
      ) : (
        byStore.map(({ store, items }) => (
          <div key={store.id} className="store-block">
            <h4>{store.name}</h4>
            <div className="order-list">
              {items.map((it) => {
                const busy = !!pending[pendingKeyOf(lineOf(it))];
                return (
                  <div className="order-line" key={it.lineKey ?? it.mealId}>
                    <span>
                      {name(it)} <small className="muted">{money(it.unitPriceTwd)}</small>
                      {it.note && <small className="order-note">備註：{it.note}</small>}
                    </span>
                    <div className="qty-ctrl">
                      <button className="btn small" disabled={!canEdit || busy} onClick={() => change(lineOf(it), -1)} aria-label={`${name(it)} 減一份`}>
                        −
                      </button>
                      <span className="qty">{busy ? "…" : it.quantity}</span>
                      <button className="btn small" disabled={!canEdit || busy} onClick={() => change(lineOf(it), 1)} aria-label={`${name(it)} 加一份`}>
                        +
                      </button>
                    </div>
                    <span className="price">{money(it.quantity * it.unitPriceTwd)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
      <div className="total-line">
        <span>共 {snap.myTotalQuantity} 份</span>
        <span className="money">{money(snap.myTotalTwd)}</span>
      </div>
      <BudgetEditor totalTwd={snap.myTotalTwd} />
    </section>
  );
}

/** 揪團訂單：全員可看店家彙總。 */
export function GroupTotals({ snap }: { snap: RoomSnapshot }) {
  return (
    <section className="stack" aria-label="揪團訂單">
      <h3 className="section-title">
        揪團訂單 <span className="tag">● 即時更新</span>
      </h3>
      {snap.storeTotals.length === 0 && <div className="muted">還沒有人點餐。</div>}
      {snap.storeTotals.map((s) => (
        <div className="card store-block" key={s.storeId}>
          <h4>{s.name}</h4>
          <DeliveryStatus snap={snap} store={snap.catalog.stores.find((store) => store.id === s.storeId)!} />
          {s.meals.map((m) => (
            <div className="sum-line" key={m.lineKey ?? m.mealId}>
              <span>{lineName(m.name, m.optionLabel)}</span>
              <span>{m.quantity} 份</span>
              <span className="price">{money(m.subtotalTwd)}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="total-line">
        <span>共 {snap.totalQuantity} 份</span>
        <span>
          總金額 <span className="money">{money(snap.totalTwd)}</span>
        </span>
      </div>
    </section>
  );
}

/** 每人明細（僅 owner）。 */
export function PeopleDetail({ snap, summary, paymentBusy, onConfirm }: {
  snap: RoomSnapshot;
  summary: OwnerSummary | null;
  paymentBusy: boolean;
  onConfirm(memberId: string, confirmed: boolean): void;
}) {
  if (!summary) return <div className="muted">載入中…</div>;
  const mealOf = (id: string) => snap.catalog.meals.find((m) => m.id === id);
  return (
    <section className="stack" aria-label="每人明細">
      <h3 className="section-title">每人明細</h3>
      {snap.room.status === "closed" && summary.paymentProgress && <div className="banner ok">
        已收 {summary.paymentProgress.paidCount}／{summary.paymentProgress.totalCount} 人、
        {money(summary.paymentProgress.paidTwd)}／{money(summary.paymentProgress.totalTwd)}
      </div>}
      {summary.people.map((p) => (
        <div className="card" key={p.memberId}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{p.nickname}</strong>
            <span className="price">{money(p.totalTwd)}</span>
          </div>
          {p.paymentStatus && <div className="row payment-person">
            <span>{p.paymentStatus === "confirmed" ? "已確認收到"
              : p.paymentStatus === "reported" ? "已回報付款" : "未付款"}</span>
            <button className="btn small" disabled={paymentBusy}
              onClick={() => onConfirm(p.memberId, p.paymentStatus !== "confirmed")}>
              {p.paymentStatus === "confirmed" ? "取消確認" : "確認收到"}
            </button>
          </div>}
          {p.items.length === 0 ? (
            <small className="muted">尚未點餐</small>
          ) : (
            <small>{p.items.map((it) => describeItem(mealOf(it.mealId), it)).join("、")}</small>
          )}
        </div>
      ))}
    </section>
  );
}

export function RoomOrderStatus({ snap }: { snap: RoomSnapshot }) {
  return (
    <section className="card stack" aria-label="訂單狀態">
      <h3 className="section-title">訂單狀態</h3>
      {snap.room.deliveryAddress && snap.storeOrders?.some((o) => o.fulfillment === "delivery") &&
        <div className="delivery-address">送餐地址：{snap.room.deliveryAddress}</div>}
      {(snap.storeOrders ?? []).map((order) => (
        <div className="stack room-store-order" key={order.storeId}>
          <div className="row"><strong>{order.storeName}</strong><OrderStatusBadge status={order.status} /></div>
          <span className={`fulfillment-badge ${order.fulfillment}`}>{describeFulfillment(order)}</span>
          <div>{order.totalQuantity} 份 · {money(order.totalTwd)}</div>
          {order.status === "rejected" && <div className="banner error">拒單原因：{order.rejectReason}</div>}
        </div>
      ))}
      {!snap.storeOrders?.length && <div className="muted">沒有已送出的店家訂單。</div>}
    </section>
  );
}

export function deliveryForStore(snap: RoomSnapshot, store: Store) {
  const subtotal = snap.storeTotals.find((s) => s.storeId === store.id)?.totalTwd ?? 0;
  return evaluateStoreDelivery(snap.room, store, subtotal);
}

function DeliveryStatus({ snap, store }: { snap: RoomSnapshot; store: Store }) {
  const result = deliveryForStore(snap, store);
  return <div className="delivery-status">
    <small>{describeDelivery(result)}</small>
    {result.kind === "below-min" && <progress className="delivery-progress"
      aria-label={`${store.name} 外送門檻進度`}
      value={result.minTwd - result.shortTwd} max={result.minTwd} />}
  </div>;
}
