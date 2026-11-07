import { useEffect, useRef, useState, type FormEvent } from "react";
import { DELIVERY_ADDRESS_MAX, type Point, type TownLot } from "../../shared/contracts";
import { roomGateway, storeGateway } from "../adapters/http";
import { ApiError, errorText, newRequestId } from "../api";
import { link, navigate } from "../router";
import { AVATAR_IDS } from "../../shared/town";
import { AvatarPicker, Storefront, TopBar } from "../ui";
import { TownMap } from "../TownMap";
import { MyRooms } from "./MyRooms";

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
  const [deliveryAddress, setDeliveryAddressState] = useState(() => localStorageGet("lt-delivery-address"));
  function setDeliveryAddress(value: string) {
    setDeliveryAddressState(value);
    localStorageSet("lt-delivery-address", value);
  }
  const [title, setTitle] = useState("今天午餐團");
  const [nickname, setNickname] = useState(() => localStorageGet("lt-nickname"));
  const [avatar, setAvatarState] = useState(() => {
    const saved = localStorageGet("lt-avatar");
    return AVATAR_IDS.includes(saved) ? saved : AVATAR_IDS[0];
  });
  function setAvatar(id: string) {
    setAvatarState(id);
    localStorageSet("lt-avatar", id); // 散步模式沿用同一個角色
  }
  // 從散步模式的「用這家開團」回來時帶 ?from=店家 ID
  const [fromStoreId] = useState(() => new URLSearchParams(location.search).get("from"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(newRequestId); // 開團重試沿用同一個 ID
  const [deadlineChoice, setDeadlineChoice] = useState<DeadlineChoice>("none");
  const [customTime, setCustomTime] = useState("12:00");
  // 送出時換算的截止時間跟著 requestId 固定，網路重試才會送出相同內容。
  const frozenDeadline = useRef<{ requestId: string; deadlineAt: number | null } | null>(null);
  const [town, setTown] = useState<TownLot[]>([]);

  useEffect(() => {
    storeGateway.getTown().then(setTown).catch(() => {});
  }, []);

  const openStores = town.flatMap((l) => (l.store?.status === "open" ? [l.store] : []));
  const openCount = openStores.length;
  const fromStore = fromStoreId ? town.find((l) => l.store?.id === fromStoreId)?.store : undefined;
  // 從散步模式帶回來的店預先勾選；休息中的店會被下面的 storeIds 過濾掉，不會送出。
  const [picked, setPicked] = useState<string[]>(() => (fromStoreId ? [fromStoreId] : []));
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
      if (frozenDeadline.current?.requestId !== requestId) {
        frozenDeadline.current = { requestId, deadlineAt: deadlineFromChoice(deadlineChoice, customTime) };
      }
      const { deadlineAt } = frozenDeadline.current;
      // 沒選地點就全部自取，地址不送出。
      const address = deliveryPoint ? deliveryAddress.trim() : "";
      const r = await roomGateway.createRoom({
        title, nickname, avatarId: avatar, requestId, storeIds,
        deliveryPoint: deliveryPoint ?? undefined, deliveryAddress: address || undefined,
        ...(deadlineAt !== null ? { deadlineAt } : {}),
      });
      navigate(r.invitePath);
    } catch (err) {
      // 內容被拒（例如截止時間太近）時換新的請求 ID，改完設定可以重新送出。
      if (!(err instanceof ApiError && err.retryable)) setRequestId(newRequestId());
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
        <MyRooms openStoreIds={new Set(openStores.map((s) => s.id))} />
        <form className="panel" id="create-room" onSubmit={create}>
          <h2>我要揪團</h2>
          {fromStore && <div className="banner ok" role="status">
            {fromStore.status === "open"
              ? `已幫你勾選剛逛的「${fromStore.name}」，也可以再加選其他店。`
              : `「${fromStore.name}」目前休息中，請改選其他營業中的店。`}
          </div>}
          <p className="muted" style={{ margin: 0 }}>
            開一團、把網址丟到群組，大家操控角色逛店、按 ＋1 點自己的餐，你直接看到彙總。
          </p>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <small className="muted">還沒決定吃什麼？散步模式可以先逛店看菜單，不用開團。</small>
            <a className="btn green" {...link("/town")}>先進去逛逛 →</a>
          </div>
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
                  <label key={s.id} title={s.address} className={`chip${storeIds.includes(s.id) ? " on" : ""}`}>
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
          <fieldset className="store-picker">
            <legend>收單截止 <small className="muted">時間到自動收單並送給店家</small></legend>
            <div className="chips" role="radiogroup">
              {DEADLINE_CHOICES.map(([value, label]) => (
                <label key={value} className={`chip${deadlineChoice === value ? " on" : ""}`}>
                  <input type="radio" name="deadline" checked={deadlineChoice === value} onChange={() => setDeadlineChoice(value)} />
                  {label}
                </label>
              ))}
            </div>
            {deadlineChoice === "at" && <label className="field">
              截止時刻 <small>今天；已過的時間視為明天</small>
              <input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} required />
            </label>}
            <small className="muted">{deadlineChoice === "none"
              ? "不設截止，由你手動收單。"
              : "截止前 5 分鐘提醒團員；時間到後不能再點餐。"}</small>
          </fieldset>
          <div className="stack delivery-picker">
            <strong>送餐地點（點地圖選擇）</strong>
            <TownMap town={town} marker={deliveryPoint} onPick={pickDelivery}
              renderLot={(lot) => lot.store ? <div>
                <Storefront styleKey={lot.store.styleKey} resting={lot.store.status !== "open"} />
                <div className="lot-label">{lot.store.name}{lot.store.status === "open" ? "" : "（休息）"}</div>
              </div> : <div className="lot-label">空地</div>} />
            <small className="muted">{deliveryPoint ? "已選送餐地點，收單時依各店門檻決定外送或自取。" : "未選送餐地點，全部自取。"}</small>
            {deliveryPoint && <label className="field">
              送餐地址 <small>選填，最多 {DELIVERY_ADDRESS_MAX} 字；只給團員與要外送的店家看</small>
              <input type="text" value={deliveryAddress} maxLength={DELIVERY_ADDRESS_MAX}
                placeholder="例：台中市西屯區市政北二路 100 號 8 樓，到了請打分機 123"
                onChange={(e) => setDeliveryAddress(e.target.value)} />
            </label>}
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
      </main>
    </div>
  );
}

type DeadlineChoice = "none" | "15" | "30" | "60" | "at";
const DEADLINE_CHOICES: Array<[DeadlineChoice, string]> = [
  ["none", "不設截止"], ["15", "15 分鐘後"], ["30", "30 分鐘後"], ["60", "1 小時後"], ["at", "指定時刻"],
];

function deadlineFromChoice(choice: DeadlineChoice, time: string, now = Date.now()): number | null {
  if (choice === "none") return null;
  if (choice !== "at") return now + Number(choice) * 60_000;
  const [h, m] = time.split(":").map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
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
