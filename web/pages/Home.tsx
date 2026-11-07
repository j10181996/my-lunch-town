import { useEffect, useState, type FormEvent } from "react";
import type { Point, StoreProfile, TownLot } from "../../shared/contracts";
import { roomGateway, storeGateway } from "../adapters/http";
import { errorText, newRequestId } from "../api";
import { link, navigate } from "../router";
import { Storefront, TopBar } from "../ui";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(newRequestId); // 開團重試沿用同一個 ID
  const [town, setTown] = useState<TownLot[]>([]);
  const [mine, setMine] = useState<StoreProfile[]>([]);
  const [key, setKey] = useState("");
  const [claimError, setClaimError] = useState("");

  useEffect(() => {
    storeGateway.getTown().then(setTown).catch(() => {});
    storeGateway.myStores().then(setMine).catch(() => {});
  }, []);

  const openCount = town.filter((l) => l.store?.status === "open").length;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      localStorageSet("lt-nickname", nickname);
      const r = await roomGateway.createRoom({ title, nickname, requestId, deliveryPoint: deliveryPoint ?? undefined });
      navigate(r.invitePath);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function claim(e: FormEvent) {
    e.preventDefault();
    setClaimError("");
    try {
      const p = await storeGateway.claimStore(key);
      navigate(`/shop/${p.id}`);
    } catch (err) {
      setClaimError(errorText(err));
    }
  }

  return (
    <div className="page">
      <TopBar><span className="spacer" /><a className="btn" {...link("/management/stores")}>管理者入口</a></TopBar>
      <main className="page-body">
        <div className="hero">
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
            <button className="btn primary big" disabled={busy || openCount === 0}>
              {busy ? "開團中…" : "開團並取得邀請網址"}
            </button>
            <small className="muted">
              {openCount > 0 ? `小鎮目前有 ${openCount} 家店營業中，開團時會固定這一版菜單與價格。` : "小鎮目前沒有營業中的店，請先開店。"}
            </small>
          </form>

          <section className="panel">
            <h2>我要開店</h2>
            <p className="muted" style={{ margin: 0 }}>
              在小鎮租一個店面、擺上點陣菜單。營業中的店會出現在之後開的每一團。
            </p>
            <a className="btn green big" {...link("/shop/new")}>
              開一家新店
            </a>
            {mine.length > 0 && (
              <div className="stack">
                <strong>我的店</strong>
                {mine.map((s) => (
                  <a key={s.id} className="btn" {...link(`/shop/${s.id}`)} style={{ justifyContent: "space-between" }}>
                    <span>{s.name}</span>
                    <span className="muted">{s.status === "open" ? "營業中" : "休息中"}</span>
                  </a>
                ))}
              </div>
            )}
            <form className="stack" onSubmit={claim}>
              <label className="field">
                用管理碼找回我的店 <small>換裝置或清除瀏覽資料後使用</small>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="xxxx-xxxx-xxxx" />
                  <button className="btn" disabled={!key.trim()}>
                    認領
                  </button>
                </div>
              </label>
              {claimError && <div className="banner error">{claimError}</div>}
            </form>
          </section>
        </div>

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
