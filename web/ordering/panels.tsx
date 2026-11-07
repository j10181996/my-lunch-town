import { useState } from "react";
import type { Meal, OwnerSummary, RoomSnapshot, Store } from "../../shared/contracts";
import { describeDelivery, describeFulfillment, distanceKm, evaluateDelivery } from "../../shared/delivery";
import { styleOf } from "../../shared/town";
import { drawIcon } from "../art/scenes";
import { ctxOf, makeCanvas } from "../art/pixel";
import type { Pending } from "../state/useRoom";
import { MealImg, money, OrderStatusBadge } from "../ui";

export interface OrderingProps {
  snap: RoomSnapshot;
  pending: Record<string, Pending>;
  canEdit: boolean;
  change(mealId: string, delta: 1 | -1): void;
}

function qtyOf(snap: RoomSnapshot, mealId: string) {
  return snap.myItems.find((i) => i.mealId === mealId)?.quantity ?? 0;
}

function StoreIcon({ store }: { store: Store }) {
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
  const meals = snap.catalog.meals.filter((m) => m.storeId === store.id);
  return (
    <section className="stack" aria-label={`${store.name} 菜單`}>
      <div className="shop-head">
        <StoreIcon store={store} />
        <div>
          <h2>{store.name}</h2>
          <DeliveryStatus snap={snap} store={store} />
          <div className="muted">選好餐點，按 ＋1 加入訂單</div>
        </div>
      </div>
      <div className="menu">
        {meals.map((m) => (
          <MealRow key={m.id} focused={m.id === focusMealId} meal={m} qty={qtyOf(snap, m.id)} pending={pending[m.id]} canEdit={canEdit} change={change} />
        ))}
        {meals.length === 0 && <div className="muted">這家店在本團沒有可點的餐點。</div>}
      </div>
    </section>
  );
}

function MealRow({
  focused,
  meal,
  qty,
  pending,
  canEdit,
  change,
}: {
  focused?: boolean;
  meal: Meal;
  qty: number;
  pending?: Pending;
  canEdit: boolean;
  change(mealId: string, delta: 1 | -1): void;
}) {
  const busy = !!pending;
  return (
    <div
      className={`meal-row${focused ? " focused" : ""}`}
      ref={(el) => {
        if (focused && el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }}
    >
      <MealImg assetKey={meal.imageAssetKey} alt={meal.name} />
      <div>
        <div className="meal-name">{meal.name}</div>
        <div className="price">{money(meal.priceTwd)}</div>
        <div>
          {meal.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="stack" style={{ justifyItems: "end" }}>
        <button
          className="btn plus"
          disabled={!canEdit || busy || !meal.available}
          onClick={() => change(meal.id, 1)}
          aria-label={`${meal.name} 加一份`}
        >
          {busy && pending?.delta === 1 ? "…" : "+1"}
        </button>
        {qty > 0 && (
          <div className="qty-ctrl">
            <button className="btn small" disabled={!canEdit || busy} onClick={() => change(meal.id, -1)} aria-label={`${meal.name} 減一份`}>
              −
            </button>
            <span className="qty" aria-label={`已點 ${qty} 份`}>
              {busy ? "…" : qty}
            </span>
          </div>
        )}
      </div>
    </div>
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
  const name = (id: string) => snap.catalog.meals.find((m) => m.id === id)?.name ?? id;

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
              {items.map((it) => (
                <div className="order-line" key={it.mealId}>
                  <span>
                    {name(it.mealId)} <small className="muted">{money(it.unitPriceTwd)}</small>
                  </span>
                  <div className="qty-ctrl">
                    <button className="btn small" disabled={!canEdit || !!pending[it.mealId]} onClick={() => change(it.mealId, -1)} aria-label={`${name(it.mealId)} 減一份`}>
                      −
                    </button>
                    <span className="qty">{pending[it.mealId] ? "…" : it.quantity}</span>
                    <button className="btn small" disabled={!canEdit || !!pending[it.mealId]} onClick={() => change(it.mealId, 1)} aria-label={`${name(it.mealId)} 加一份`}>
                      +
                    </button>
                  </div>
                  <span className="price">{money(it.quantity * it.unitPriceTwd)}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <div className="total-line">
        <span>共 {snap.myTotalQuantity} 份</span>
        <span className="money">{money(snap.myTotalTwd)}</span>
      </div>
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
            <div className="sum-line" key={m.mealId}>
              <span>{m.name}</span>
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
  const name = (id: string) => snap.catalog.meals.find((m) => m.id === id)?.name ?? id;
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
            <small>{p.items.map((it) => `${name(it.mealId)} × ${it.quantity}`).join("、")}</small>
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
  const km = snap.room.deliveryPoint ? distanceKm(snap.room.deliveryPoint, store.door) : null;
  const subtotal = snap.storeTotals.find((s) => s.storeId === store.id)?.totalTwd ?? 0;
  return evaluateDelivery(store.delivery, km, subtotal);
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
