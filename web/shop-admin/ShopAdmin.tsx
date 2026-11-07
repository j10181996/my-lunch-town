import { StoreHoursSettings } from "./StoreHoursSettings";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  DeliveryRules,
  AdminMeal,
  MealInput,
  StoreProfile,
  StoreStatus,
  StoreOrder,
  StoreOrderStatus,
} from "../../shared/contracts";
import { describeFulfillment, validateDeliveryRules } from "../../shared/delivery";
import type { GeoPoint } from "../../shared/contracts";
import { mapsSearchUrl } from "../../shared/geo";
import { LocationPicker } from "../LocationPicker";
import { DIET_TAGS, dietTagsOf } from "../../shared/diet";
import { DEFAULT_MEAL_ART, MEAL_ART, styleOf } from "../../shared/town";
import { storeGateway as gw } from "../adapters/http";
import { ApiError, errorText } from "../api";
import { link, navigate } from "../router";
import { MealImg, Modal, Storefront, TopBar, money, OrderStatusBadge } from "../ui";
import { NotFound } from "../pages/NotFound";
import { StylePicker } from "./ShopNew";

type Load = { kind: "loading" } | { kind: "forbidden" } | { kind: "missing" } | { kind: "ready"; profile: StoreProfile };

export function ShopAdmin({ storeId }: { storeId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const reload = useCallback(async () => {
    try {
      setLoad({ kind: "ready", profile: await gw.getStore(storeId) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setLoad({ kind: "forbidden" });
      else setLoad({ kind: "missing" });
    }
  }, [storeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (load.kind === "loading")
    return (
      <div className="page">
        <TopBar />
        <div className="center muted">載入中…</div>
      </div>
    );
  if (load.kind === "missing") return <NotFound message="找不到這家店" />;
  if (load.kind === "forbidden") return <ClaimGate storeId={storeId} onClaimed={reload} />;
  return <AdminView profile={load.profile} setProfile={(p) => setLoad({ kind: "ready", profile: p })} />;
}

function ClaimGate({ storeId, onClaimed }: { storeId: string; onClaimed(): void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const p = await gw.claimStore(key);
      if (p.id !== storeId) navigate(`/shop/${p.id}`, true);
      else onClaimed();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div className="page">
      <TopBar />
      <main className="page-body" style={{ maxWidth: 480 }}>
        <form className="panel" onSubmit={submit}>
          <h2>這不是你目前登入的店</h2>
          <p className="muted" style={{ margin: 0 }}>
            輸入開店時拿到的管理碼來認領後台。
          </p>
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="xxxx-xxxx-xxxx" autoFocus />
          {error && <div className="banner error">{error}</div>}
          <button className="btn primary big" disabled={!key.trim()}>
            認領
          </button>
        </form>
      </main>
    </div>
  );
}

/** 同一個人管理多家店（例如用展示碼認領全部種子店家）時，可在頂欄切換。 */
function StoreSwitcher({ currentId }: { currentId: string }) {
  const [stores, setStores] = useState<StoreProfile[]>([]);
  useEffect(() => {
    gw.myStores().then(setStores).catch(() => setStores([]));
  }, [currentId]);
  if (stores.length < 2) return null;
  return (
    <label className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <span className="muted">切換店家</span>
      <select value={currentId} onChange={(e) => navigate(`/shop/${e.target.value}`)} style={{ width: "auto" }}>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AdminView({ profile, setProfile }: { profile: StoreProfile; setProfile(p: StoreProfile): void }) {
  const [name, setName] = useState(profile.name);
  const [statusError, setStatusError] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const style = styleOf(profile.styleKey);
  const availableCount = profile.meals.filter((m) => m.available).length;

  useEffect(() => setName(profile.name), [profile.name]);

  async function run(fn: () => Promise<StoreProfile>, okMsg?: string) {
    try {
      setProfile(await fn());
      if (okMsg) {
        setInfoMsg(okMsg);
        setTimeout(() => setInfoMsg(""), 2500);
      }
      return true;
    } catch (e) {
      setInfoMsg("");
      setStatusError(errorText(e));
      return false;
    }
  }

  async function setStatus(s: StoreStatus) {
    setStatusError("");
    await run(() => gw.setStatus(profile.id, s), s === "open" ? "開門營業！新開的團會看到你的店" : "已休息，新開的團不會出現你的店");
  }

  return (
    <div className="page">
      <TopBar>
        <span className="sep" />
        <span className="title">店家後台</span>
        <a className="btn" {...link("/management/stores")}>店家清單</a>
        <StoreSwitcher currentId={profile.id} />
        <span className="spacer" />
        <a className="btn" {...link("/shop")}>
          店家入口
        </a>
      </TopBar>
      <main className="page-body" style={{ maxWidth: 1200 }}>
        <div className="admin">
          <StoreOrders key={profile.id} storeId={profile.id} />
          <section className="panel">
            <div style={{ position: "relative" }}>
              <Storefront styleKey={profile.styleKey} resting={profile.status !== "open"} />
              <div
                style={{
                  position: "absolute",
                  left: "29%",
                  right: "12%",
                  top: "28%",
                  textAlign: "center",
                  fontWeight: 900,
                  fontSize: "clamp(12px, 2.2vw, 20px)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                {profile.name}
              </div>
            </div>

            <div className="status-toggle" role="group" aria-label="營業狀態">
              <button className="open" aria-pressed={profile.status === "open"} onClick={() => setStatus("open")}>
                營業中
              </button>
              <button className="resting" aria-pressed={profile.status === "resting"} onClick={() => setStatus("resting")}>
                休息中
              </button>
            </div>
            <StoreLocationSettings key={`loc-${profile.id}`} profile={profile} onSaved={setProfile} />
            <DeliverySettings key={profile.id} profile={profile} onSaved={setProfile} />
            {statusError && <div className="banner error">{statusError}</div>}
            {infoMsg && <div className="banner ok">{infoMsg}</div>}
            {availableCount === 0 && <div className="banner info">至少上架一道「供應中」的餐點才能開門營業</div>}
            {profile.activeRoomCount > 0 && (
              <div className="banner info">
                目前有 {profile.activeRoomCount} 個進行中的團使用開團當下的菜單；你的修改只會套用到之後開的團。
              </div>
            )}

            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                setStatusError("");
                void run(() => gw.updateStore(profile.id, { name }), "店名已更新");
              }}
            >
              店名
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input type="text" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
                <button className="btn small" disabled={name.trim() === profile.name || !name.trim()}>
                  儲存
                </button>
              </div>
            </form>
            <div className="field">
              店面風格 <small>目前：{style.label}</small>
              <StylePicker value={profile.styleKey} onChange={(k) => void run(() => gw.updateStore(profile.id, { styleKey: k }), "店面風格已更新")} />
            </div>
            {profile.isSample && <small className="muted">這是示範店家，管理碼為 demo-{profile.id}。</small>}
          </section>

          <StoreHoursSettings key={`hours-${profile.id}`} profile={profile} onSaved={setProfile} />

          <section className="panel">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>菜單</h2>
              <button className="btn green" onClick={() => setAdding(true)} disabled={adding || profile.meals.length >= 12}>
                ＋ 新增餐點
              </button>
            </div>
            <div className="editor-row editor-head" aria-hidden>
              <span>圖片</span>
              <span>名稱／標籤</span>
              <span>價格（元）</span>
              <span>供應</span>
              <span />
            </div>
            {adding && (
              <MealEditor
                key="new"
                storeId={profile.id}
                onSaved={(p) => {
                  setProfile(p);
                  setAdding(false);
                  setStatusError("");
                  setInfoMsg(`已上架：${p.meals[p.meals.length - 1]?.name ?? ""}`);
                  setTimeout(() => setInfoMsg(""), 2500);
                }}
                onCancel={() => setAdding(false)}
              />
            )}
            {profile.meals.map((m, i) => (
              <MealEditor
                key={m.id}
                storeId={profile.id}
                meal={m}
                first={i === 0}
                last={i === profile.meals.length - 1}
                onSaved={setProfile}
              />
            ))}
            {profile.meals.length === 0 && !adding && <div className="muted">還沒有餐點，按「新增餐點」開始上架。</div>}
          </section>
        </div>
      </main>
    </div>
  );
}

function MealEditor({
  storeId,
  meal,
  first,
  last,
  onSaved,
  onCancel,
}: {
  storeId: string;
  meal?: AdminMeal;
  first?: boolean;
  last?: boolean;
  onSaved(p: StoreProfile): void;
  onCancel?(): void;
}) {
  const initial = {
    name: meal?.name ?? "",
    price: meal ? String(meal.priceTwd) : "",
    imageAssetKey: meal?.imageAssetKey ?? DEFAULT_MEAL_ART,
    available: meal?.available ?? true,
    tags: meal?.tags.join(" ") ?? "",
  };
  const [d, setD] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!meal) return;
    setD({
      name: meal.name,
      price: String(meal.priceTwd),
      imageAssetKey: meal.imageAssetKey,
      available: meal.available,
      tags: meal.tags.join(" "),
    });
  }, [meal]);

  const dirty = !meal || JSON.stringify(d) !== JSON.stringify(initial);
  const priceOk = /^\d{1,4}$/.test(d.price);

  function toInput(): MealInput {
    return {
      name: d.name,
      priceTwd: Number(d.price),
      imageAssetKey: d.imageAssetKey,
      available: d.available,
      tags: splitTags(d.tags),
    };
  }

  async function save(patch?: Partial<MealInput>) {
    setState("saving");
    setError("");
    try {
      const p = meal ? await gw.updateMeal(storeId, meal.id, patch ?? toInput()) : await gw.addMeal(storeId, toInput());
      setState("saved");
      onSaved(p);
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (e) {
      setState("error");
      setError(errorText(e));
    }
  }

  async function act(fn: () => Promise<StoreProfile>) {
    try {
      onSaved(await fn());
    } catch (e) {
      setState("error");
      setError(errorText(e));
    }
  }

  return (
    <div className={`editor-row ${dirty && meal ? "dirty" : ""}`}>
      <button type="button" className="img-btn" onClick={() => setPicking(true)} aria-label="更換餐點圖片">
        <MealImg assetKey={d.imageAssetKey} alt={d.name || "餐點圖片"} size={64} />
      </button>
      <div className="stack" style={{ gap: 4 }}>
        <input type="text" value={d.name} maxLength={16} placeholder="餐點名稱" aria-label="餐點名稱" onChange={(e) => setD({ ...d, name: e.target.value })} />
        <input type="text" value={d.tags} placeholder="標籤（空白分隔，選填）" aria-label="標籤" onChange={(e) => setD({ ...d, tags: e.target.value })} style={{ fontSize: 13, padding: "3px 8px" }} />
        <DietTagPicker tags={d.tags} onChange={(tags) => setD({ ...d, tags })} />
      </div>
      <div>
        <input
          type="text"
          inputMode="numeric"
          value={d.price}
          placeholder="0"
          aria-label="價格（新台幣整數）"
          aria-invalid={!priceOk && d.price !== ""}
          onChange={(e) => setD({ ...d, price: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })}
        />
        <small className="muted">{priceOk ? money(Number(d.price)) : "整數"}</small>
      </div>
      <label className="switch">
        <input
          type="checkbox"
          checked={d.available}
          onChange={(e) => {
            const available = e.target.checked;
            setD({ ...d, available });
            if (meal && !dirty) void save({ available }); // 只切換供應時立即儲存
          }}
        />
        {d.available ? "供應中" : "已下架"}
      </label>
      <div className="stack" style={{ gap: 4, justifyItems: "end" }}>
        {(dirty || !meal) && (
          <div className="row" style={{ gap: 4 }}>
            <button className="btn small primary" disabled={!d.name.trim() || !priceOk || state === "saving"} onClick={() => save()}>
              {state === "saving" ? "儲存中" : meal ? "儲存" : "上架"}
            </button>
            {!meal && (
              <button className="btn small ghost" onClick={onCancel}>
                取消
              </button>
            )}
          </div>
        )}
        {meal && !dirty && (
          <div className="row" style={{ gap: 4 }}>
            <button className="btn small square" disabled={first} onClick={() => act(() => gw.moveMeal(storeId, meal.id, "up"))} aria-label="上移">
              ↑
            </button>
            <button className="btn small square" disabled={last} onClick={() => act(() => gw.moveMeal(storeId, meal.id, "down"))} aria-label="下移">
              ↓
            </button>
            <button className="btn small square" onClick={() => setConfirmDel(true)} aria-label="刪除">
              ✕
            </button>
          </div>
        )}
        {state === "saved" && <small style={{ color: "var(--green)" }}>已儲存</small>}
        {state === "error" && <small style={{ color: "var(--accent-ink)" }}>{error}</small>}
      </div>

      {picking && (
        <Modal title="挑一張點陣餐點圖" onClose={() => setPicking(false)}>
          <div className="picker">
            {MEAL_ART.map((a) => (
              <button
                key={a.key}
                aria-pressed={d.imageAssetKey === a.key}
                onClick={() => {
                  setD({ ...d, imageAssetKey: a.key });
                  setPicking(false);
                }}
              >
                <MealImg assetKey={a.key} alt="" size={64} />
                {a.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {confirmDel && meal && (
        <Modal title={`刪除「${meal.name}」？`} onClose={() => setConfirmDel(false)}>
          <p style={{ margin: 0 }}>進行中的團不受影響；之後開的團不會再出現這道餐點。</p>
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                setConfirmDel(false);
                void act(() => gw.deleteMeal(storeId, meal.id));
              }}
            >
              刪除
            </button>
            <button className="btn ghost" onClick={() => setConfirmDel(false)}>
              取消
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

async function playOrderTone() {
  let audio: AudioContext | undefined;
  try {
    audio = new AudioContext();
    await audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.22);
    oscillator.onended = () => { void audio?.close(); };
  } catch {
    // 瀏覽器可能阻擋自動播放；文字提示仍可使用。
    void audio?.close();
  }
}

function StoreOrders({ storeId }: { storeId: string }) {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [error, setError] = useState("");
  const [unseen, setUnseen] = useState<string[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const generation = useRef(0);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const ticket = ++generation.current;
      try {
        const list = await gw.listOrders(storeId);
        if (!alive || ticket !== generation.current) return;
        const fresh = list.filter((o) => o.status === "sent" && !seen.current?.has(o.id));
        // 第一次載入也提醒尚待處理的訂單，重連只提醒新增的訂單。
        seen.current ??= new Set();
        list.forEach((o) => seen.current!.add(o.id));
        if (fresh.length) {
          setUnseen((old) => [...new Set([...old, ...fresh.map((o) => o.id)])]);
          void playOrderTone();
        }
        setOrders(list);
        setError("");
      } catch (e) {
        if (alive && ticket === generation.current) setError(errorText(e));
      }
    }
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const unsubscribe = gw.subscribeOrders(storeId, () => { void refresh(); });
    const focus = () => { setUnseen([]); void refresh(); };
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, [storeId]);

  useEffect(() => {
    const title = document.title.replace(/^\(新訂單\) /, "");
    document.title = unseen.length ? `(新訂單) ${title}` : title;
    return () => { document.title = title; };
  }, [unseen.length]);

  function saved(order: StoreOrder) {
    // 讓更新完成前發出的清單回應失效，再重抓以保留同時到來的新訂單。
    generation.current++;
    setOrders((old) => old.map((o) => o.id === order.id ? order : o));
    refreshRef.current();
  }
  const active = orders.filter((o) => !["ready", "rejected"].includes(o.status));
  const today = new Date().toDateString();
  const completed = orders.filter((o) => ["ready", "rejected"].includes(o.status)
    && new Date(o.updatedAt).toDateString() === today);
  const card = (order: StoreOrder) => <StoreOrderCard key={order.id} order={order} onSaved={saved}
    onSeen={() => setUnseen((old) => old.filter((id) => id !== order.id))} />;
  return (
    <section className="panel store-orders" aria-label="訂單">
      <h2>訂單</h2>
      {unseen.length > 0 && <div className="banner info new-order-alert" role="status">
        有 {unseen.length} 筆新訂單，請查看並接單
      </div>}
      {error && <div className="banner error" role="alert">{error}
        <button className="btn small" onClick={() => refreshRef.current()}>重試</button>
      </div>}
      {active.length === 0 && <div className="muted">目前沒有進行中的訂單。</div>}
      <div className="store-order-grid">{active.map(card)}</div>
      <details><summary>今天已完成（{completed.length}）</summary>
        <div className="store-order-grid">{completed.map(card)}</div>
      </details>
    </section>
  );
}

function StoreOrderCard({ order, onSaved, onSeen }: {
  order: StoreOrder; onSaved(order: StoreOrder): void; onSeen(): void;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const reasonLength = [...reason.trim()].length;
  async function update(status: StoreOrderStatus) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(await gw.updateOrderStatus(order.storeId, order.id, { status, reason }));
      setRejecting(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const action = (status: StoreOrderStatus, label: string) => (
    <button className="btn green" disabled={busy} onClick={() => void update(status)}>
      {busy ? "處理中…" : label}
    </button>
  );
  return (
    // 只在點擊後才標為已讀：若在 focus（滑鼠按下）時收起上方的新訂單提示，版面會上移，
    // 放開滑鼠時已不在按鈕上，第一次按「接單」會沒反應。
    <article className="card stack store-order-card" onClick={onSeen} aria-label={`${order.roomTitle} 訂單`}>
      <div className="row"><h3>{order.roomTitle}</h3><OrderStatusBadge status={order.status} /></div>
      <div className="muted">揪團者：{order.ownerNickname} · 送出時間：
        <time dateTime={new Date(order.createdAt).toISOString()}>{new Date(order.createdAt).toLocaleString("zh-TW")}</time>
      </div>
      <span className={`fulfillment-badge ${order.fulfillment}`}>{describeFulfillment(order)}</span>
      {order.fulfillment === "delivery" && <div className="delivery-address">
        送餐地址：{order.deliveryAddress ?? <span className="muted">團主未填，請聯絡揪團者</span>}
      </div>}
      {order.items.map((item) => <div className="sum-line" key={item.mealId}>
        <span>{item.name}</span><span>{item.quantity} 份</span><strong>{money(item.subtotalTwd)}</strong>
      </div>)}
      <div className="total-line"><span>共 {order.totalQuantity} 份</span><span>{money(order.totalTwd)}</span></div>
      <details><summary>每人明細</summary><div className="stack">
        {order.people.map((person, index) => <div key={index}>
          <strong>{person.nickname}</strong>：{person.items.map((i) => `${i.name} × ${i.quantity}`).join("、")}
          <span> · {money(person.totalTwd)}</span>
        </div>)}
      </div></details>
      {order.rejectReason && <div className="banner error">拒單原因：{order.rejectReason}</div>}
      {error && !rejecting && <div className="banner error" role="alert">{error}，請重試</div>}
      <div className={`row order-actions ${order.status === "sent" ? "new" : ""}`}>
        {order.status === "sent" && <>
          {action("accepted", "接單")}
          <button className="btn primary" disabled={busy} onClick={() => { setError(""); setRejecting(true); }}>
            {busy ? "處理中…" : "拒單"}
          </button>
        </>}
        {order.status === "accepted" && action("preparing", "開始製作")}
        {["accepted", "preparing"].includes(order.status) && action("ready", "可取餐")}
      </div>
      {rejecting && <Modal title="拒單原因" onClose={() => !busy && setRejecting(false)}>
        <div className="row">{["已售完", "目前太忙", "不在營業時間"].map((r) => (
          <button className="btn small" key={r} disabled={busy} onClick={() => setReason(r)}>{r}</button>
        ))}</div>
        <label className="field">拒單原因（必填，1 至 40 字）
          <input type="text" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} required />
        </label>
        {error && <div className="banner error" role="alert">{error}，請重試</div>}
        <div className="row">
          <button className="btn primary" disabled={busy || reasonLength < 1 || reasonLength > 40}
            onClick={() => void update("rejected")}>{busy ? "處理中…" : "確定拒單"}</button>
          <button className="btn ghost" disabled={busy} onClick={() => setRejecting(false)}>取消</button>
        </div>
      </Modal>}
    </article>
  );
}

/** 店家真實位置：外送距離以團的送餐位置到這裡的直線距離計算。 */
function StoreLocationSettings({ profile, onSaved }: { profile: StoreProfile; onSaved(p: StoreProfile): void }) {
  const [location, setLocation] = useState<GeoPoint | null>(profile.location);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = location?.lat !== profile.location?.lat || location?.lng !== profile.location?.lng;
  async function save(next: GeoPoint | null) {
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const p = await gw.setLocation(profile.id, next);
      onSaved(p);
      setLocation(p.location);
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return <section className="stack delivery-settings" aria-label="店家位置">
    <h3>店家位置</h3>
    {!profile.location && <small className="muted">尚未設定位置；開了外送也無法計算距離，揪團會以自取送單</small>}
    {profile.address && <small className="muted">
      地址：{profile.address} · <a href={mapsSearchUrl(profile.address)} target="_blank" rel="noreferrer">在 Google 地圖找座標</a>
    </small>}
    <LocationPicker label="店家位置" value={location} disabled={busy}
      onChange={(p) => { setLocation(p); setSaved(false); }} />
    {error && <div className="banner error" role="alert">{error}</div>}
    {saved && <small className="delivery-saved" role="status">店家位置已儲存</small>}
    <div className="row">
      <button type="button" className="btn green" disabled={busy || !location || !dirty}
        onClick={() => void save(location)}>{busy ? "儲存中…" : "儲存店家位置"}</button>
      {profile.location && <button type="button" className="btn small ghost" disabled={busy}
        onClick={() => void save(null)}>清除位置</button>}
    </div>
    <small className="muted">修改只套用到之後開的團。</small>
  </section>;
}

function DeliverySettings({ profile, onSaved }: { profile: StoreProfile; onSaved(p: StoreProfile): void }) {
  const [enabled, setEnabled] = useState(profile.delivery?.enabled ?? false);
  const [tiers, setTiers] = useState(() => (profile.delivery?.tiers ?? []).map((tier) => ({
    maxKm: String(tier.maxKm),
    minTwd: String(tier.minTwd),
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    let rules: DeliveryRules;
    try {
      if (tiers.some((t) => !t.maxKm.trim() || !t.minTwd.trim())) {
        setError("請填寫每段公里數與最低金額");
        return;
      }
      rules = validateDeliveryRules({ enabled, tiers: tiers.map((t) => ({
        maxKm: Number(t.maxKm),
        minTwd: Number(t.minTwd),
      })) });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      onSaved(await gw.setDelivery(profile.id, rules));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return <form className="stack delivery-settings" onSubmit={save}
    onChange={() => setSaved(false)}>
    <h3>外送設定</h3>
    {!profile.delivery && <small className="muted">尚未設定外送，揪團會以自取送單</small>}
    <label className="switch"><input type="checkbox" checked={enabled} disabled={busy}
      onChange={(e) => setEnabled(e.target.checked)} />提供外送</label>
    <fieldset disabled={busy}>
      <div className="delivery-tiers">
        {tiers.map((tier, i) => <div className="delivery-tier" key={i}>
          <label className="field">公里內
            <input type="number" min="0.1" max="20" step="0.1" value={tier.maxKm}
              onChange={(e) => setTiers(tiers.map((t, j) => j === i ? { ...t, maxKm: e.target.value } : t))} />
          </label>
          <label className="field">最低金額（元）
            <input type="number" min="0" max="99999" step="1" value={tier.minTwd}
              onChange={(e) => setTiers(tiers.map((t, j) => j === i ? { ...t, minTwd: e.target.value } : t))} />
          </label>
          <button type="button" className="btn small" aria-label={`刪除第 ${i + 1} 段`}
            onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>刪除</button>
        </div>)}
      </div>
      <button type="button" className="btn small" disabled={tiers.length >= 5}
        onClick={() => setTiers([...tiers, { maxKm: "", minTwd: "" }])}>新增一段</button>
    </fieldset>
    {error && <div className="banner error" role="alert">{error}</div>}
    {saved && <small className="delivery-saved" role="status">外送設定已儲存</small>}
    <button className="btn green" disabled={busy}>{busy ? "儲存中…" : "儲存外送設定"}</button>
    <small className="muted">修改只套用到之後開的團。</small>
  </form>;
}

function splitTags(text: string) {
  return [...new Set(text.split(/[\s,，、]+/).filter(Boolean))];
}

/** 標準飲食標籤：勾選即寫入標籤欄，團員可依此篩選。 */
function DietTagPicker({ tags, onChange }: { tags: string; onChange(tags: string): void }) {
  const list = splitTags(tags);
  const present = dietTagsOf(list);
  return (
    <div className="chips diet-picker" role="group" aria-label="飲食標籤">
      {DIET_TAGS.map((tag) => (
        <label key={tag} className={`chip${present.has(tag) ? " on" : ""}`}>
          <input type="checkbox" checked={present.has(tag)} onChange={() => {
            // 取消時一併移除同義的舊寫法（例如「素」），避免篩選仍判定為素食。
            const next = present.has(tag) ? list.filter((t) => !dietTagsOf([t]).has(tag)) : [...list, tag];
            onChange(next.join(" "));
          }} />
          {tag}
        </label>
      ))}
    </div>
  );
}
