import { useEffect, useState, type FormEvent } from "react";
import type { Point, TownLot } from "../../shared/contracts";
import { roomGateway, storeGateway } from "../adapters/http";
import { errorText, newRequestId } from "../api";
import { link, navigate } from "../router";
import { AVATAR_IDS } from "../../shared/town";
import { AvatarPicker, Storefront, TopBar } from "../ui";
import { TownMap } from "../TownMap";

export function Home() {
  const [deliveryPoint, setDeliveryPoint] = useState<Point | null>(() => {
    try {
      const p = JSON.parse(localStorageGet("lt-delivery-point"));
      return p && Number.isFinite(p.x) && Number.isFinite(p.y)
        && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? { x: p.x, y: p.y } : null;
    } catch {
      return null;
    }
  });
  function pickDelivery(point: Point | null) {
    setDeliveryPoint(point);
    localStorageSet("lt-delivery-point", JSON.stringify(point));
  }
  const [title, setTitle] = useState("今天午餐團");
  const [nickname, setNickname] = useState(() => localStorageGet("lt-nickname"));
  const [avatar, setAvatar] = useState(AVATAR_IDS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(newRequestId); // 開團重試沿用同一個 ID
  const [town, setTown] = useState<TownLot[]>([]);

  useEffect(() => {
    storeGateway.getTown().then(setTown).catch(() => {});
  }, []);

  const openStores = town.flatMap((l) => (l.store?.status === "open" ? [l.store] : []));
  const openCount = openStores.length;
  const [picked, setPicked] = useState<string[]>([]);
  // 店家休息後自動取消勾選，避免送出已不能點的店。
  const storeIds = picked.filter((id) => openStores.some((s) => s.id === id));
  function togglePick(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      localStorageSet("lt-nickname", nickname);
      const r = await roomGateway.createRoom({ title, nickname, avatarId: avatar, requestId, storeIds, deliveryPoint: deliveryPoint ?? undefined });
      navigate(r.invitePath);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar>
        <span className="spacer" />
        <a className="btn" {...link("/management/stores")}>管理者入口</a>
        <a className="btn" {...link("/shop")}>店家入口</a>
      </TopBar>
      <main className="page-body">
        <form className="panel" onSubmit={create}>
          <h2>我要揪團</h2>
          <p className="muted" style={{ margin: 0 }}>
            開一團、把網址丟到群組，大家操控角色逛店、按 ＋1 點自己的餐，你直接看到彙總。
          </p>
          <label className="field">
            團名
            <input type="text" value={title} maxLength={20} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="field">
            你的暱稱 <small>1 至 12 個字</small>
            <input type="text" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} required />
          </label>
          <AvatarPicker value={avatar} onChange={setAvatar} />
          <fieldset className="store-picker">
            <legend>今天吃哪家？ <small className="muted">必選，可複選</small></legend>
            {openCount > 0 ? <>
              <div className="chips">
                {openStores.map((s) => (
                  <label key={s.id} className={`chip${storeIds.includes(s.id) ? " on" : ""}`}>
                    <input type="checkbox" checked={storeIds.includes(s.id)} onChange={() => togglePick(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
              <div className="row">
                <button type="button" className="btn small" onClick={() => setPicked(openStores.map((s) => s.id))}>全選營業中的店</button>
                {storeIds.length > 0 && <button type="button" className="btn small ghost" onClick={() => setPicked([])}>清除</button>}
              </div>
              <small className="muted">{storeIds.length > 0
                ? `已選 ${storeIds.length} 家；團員只能在這些店點餐。`
                : "請至少選一家店；只選一家最容易湊到外送門檻。"}</small>
            </> : <small className="muted">小鎮目前沒有營業中的店。</small>}
          </fieldset>
          <div className="stack delivery-picker">
            <strong>送餐地點（點地圖選擇）</strong>
            <TownMap town={town} marker={deliveryPoint} onPick={pickDelivery}
              renderLot={(lot) => lot.store ? <div>
                <Storefront styleKey={lot.store.styleKey} resting={lot.store.status !== "open"} />
                <div className="lot-label">{lot.store.name}</div>
              </div> : <div className="lot-label">空地</div>} />
            <small className="muted">{deliveryPoint ? "已選送餐地點，收單時依各店門檻決定外送或自取。" : "未選送餐地點，全部自取。"}</small>
            <button type="button" className="btn small" onClick={() => pickDelivery(null)}>
              不外送，全部自取
            </button>
          </div>
          {error && <div className="banner error">{error}</div>}
          <button className="btn primary big" disabled={busy || storeIds.length === 0}>
            {busy ? "開團中…" : "開團並取得邀請網址"}
          </button>
          <small className="muted">
            {openCount > 0 ? "開團時會固定所選店家這一版的菜單與價格。" : "小鎮目前沒有營業中的店，請等店家開門營業。"}
          </small>
        </form>

        <section className="panel">
          <h2>小鎮街景</h2>
          <TownMap
            town={town}
            renderLot={(lot) =>
              lot.store ? (
                <div style={{ display: "grid", alignContent: "end" }}>
                  <Storefront styleKey={lot.store.styleKey} resting={lot.store.status !== "open"} />
                  <div className="lot-label">
                    {lot.store.name}
                    {lot.store.status === "open" ? "" : "（休息）"}
                  </div>
                </div>
              ) : (
                <div className="lot-label" style={{ alignSelf: "center", opacity: 0.8 }}>
                  空地
                </div>
              )
            }
          />
        </section>
      </main>
    </div>
  );
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
