import { useEffect, useRef, useState } from "react";
import type { MyRoomSummary } from "../../shared/contracts";
import { roomGateway } from "../adapters/http";
import { ApiError, errorText, newRequestId } from "../api";
import { link, navigate } from "../router";

/** 預設只顯示最近幾團，避免把開團表單推太遠。 */
const PREVIEW_COUNT = 3;

const when = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * 首頁「我的團」：我開過與參加過的團，可回到該團或「再揪一次」。
 * 再揪一次只複製開團設定（團名、送餐地點、店家），套用當下菜單；
 * 不複製成員、訂單或付款狀態（那是 #16 的「重新開團」）。
 */
export function MyRooms({ openStoreIds }: { openStoreIds: Set<string> }) {
  const [rooms, setRooms] = useState<MyRoomSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  // 每個團一個請求 ID：網路重試不會多開一團；內容被拒時才換新的。
  const requestIds = useRef(new Map<string, string>());

  useEffect(() => {
    roomGateway.myRooms().then(setRooms).catch(() => setRooms([]));
  }, []);

  async function again(room: MyRoomSummary, storeIds: string[]) {
    setBusyId(room.id);
    setError("");
    const requestId = requestIds.current.get(room.id) ?? newRequestId();
    requestIds.current.set(room.id, requestId);
    try {
      const r = await roomGateway.createRoom({
        title: room.title, nickname: room.nickname, avatarId: room.avatarId, requestId, storeIds,
        deliveryPoint: room.deliveryPoint ?? undefined,
      });
      navigate(r.invitePath);
    } catch (e) {
      if (!(e instanceof ApiError && e.retryable)) requestIds.current.delete(room.id);
      setError(`「${room.title}」${errorText(e)}`);
      setBusyId(null);
    }
  }

  if (!rooms || rooms.length === 0) return null;
  return (
    <section className="panel my-rooms" aria-label="我的團">
      <h2>我的團</h2>
      <p className="muted" style={{ margin: 0 }}>你開過和參加過的團。「再揪一次」沿用團名、送餐地點和店家，菜單用店家目前的版本。</p>
      {error && <div className="banner error">{error}</div>}
      <ul className="my-room-list">
        {(expanded ? rooms : rooms.slice(0, PREVIEW_COUNT)).map((room) => {
          const storeIds = room.stores.filter((s) => openStoreIds.has(s.id)).map((s) => s.id);
          const resting = room.stores.filter((s) => !openStoreIds.has(s.id));
          return (
            <li key={room.id} className="card my-room">
              <div className="row my-room-head">
                <strong>{room.title}</strong>
                <span className={`tag${room.status === "open" ? " live" : ""}`}>{room.status === "open" ? "進行中" : "已收單"}</span>
                <span className="tag">{room.role === "owner" ? "我開的" : "我參加的"}</span>
                <span className="spacer" />
                <small className="muted">{when.format(room.createdAt)}</small>
              </div>
              <small className="muted">
                {room.stores.map((s) => s.name).join("、")} · {room.memberCount} 人
                {room.myTotalTwd > 0 ? ` · 我點了 NT$${room.myTotalTwd}` : " · 我沒點"}
                {room.deliveryPoint ? " · 外送" : " · 自取"}
              </small>
              <div className="row">
                <a className="btn small" {...link(`/r/${room.id}`)}>回到這團</a>
                <button type="button" className="btn small green" disabled={busyId !== null || storeIds.length === 0}
                  onClick={() => again(room, storeIds)}>
                  {busyId === room.id ? "開團中…" : "再揪一次"}
                </button>
                {storeIds.length === 0
                  ? <small className="muted">店家都休息中</small>
                  : resting.length > 0 && <small className="muted">{resting.map((s) => s.name).join("、")} 休息中，會略過</small>}
              </div>
            </li>
          );
        })}
      </ul>
      {rooms.length > PREVIEW_COUNT && <button type="button" className="btn small ghost" onClick={() => setExpanded(!expanded)}>
        {expanded ? "只看最近幾團" : `顯示全部 ${rooms.length} 團`}
      </button>}
    </section>
  );
}
