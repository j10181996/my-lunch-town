import { useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "../../shared/contracts";
import { roomGateway } from "../adapters/http";
import { errorText } from "../api";

const MIN = 60_000;
/** 截止前多久提醒團員。 */
export const REMIND_BEFORE_MS = 5 * MIN;
const EXPIRE_RETRY_MS = 3000;

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** 本機時鐘判斷是否已過截止；只用來停用按鈕，實際拒絕以伺服器時間為準。 */
export function deadlinePassed(snap: RoomSnapshot, now: number) {
  return snap.room.status === "open" && snap.room.deadlineAt != null && now >= snap.room.deadlineAt;
}

export function formatClock(at: number) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

function formatLeft(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 頂列倒數徽章。 */
export function DeadlineTag({ snap, now }: { snap: RoomSnapshot; now: number }) {
  const at = snap.room.deadlineAt;
  if (snap.room.status !== "open" || at == null) return null;
  const left = at - now;
  const urgent = left <= REMIND_BEFORE_MS;
  return <span className={`tag deadline-tag${urgent ? " urgent" : ""}`} role="timer" aria-label="距離截止">
    {left > 0 ? `⏰ ${formatLeft(left)}` : "⏰ 收單中…"}
  </span>;
}

interface Props {
  snap: RoomSnapshot;
  now: number;
  isOwner: boolean;
  online: boolean;
  onSnapshot(s: RoomSnapshot): void;
  say(kind: "ok" | "error" | "info", text: string): void;
}

/**
 * 截止提醒與自動收單觸發：
 * - 剩 5 分鐘時提醒一次；
 * - 時間到請伺服器收單（可重試，伺服器以自己的時間判斷，未到不做事）；
 * - 揪團者可設定、延後或取消截止。
 */
export function RoomDeadlinePanel({ snap, now, isOwner, online, onSnapshot, say }: Props) {
  const at = snap.room.deadlineAt ?? null;
  const open = snap.room.status === "open";
  const left = at == null ? null : at - now;
  const [busy, setBusy] = useState(false);
  const reminded = useRef<number | null>(null);
  const expiring = useRef(false);

  // 剩 5 分鐘提醒一次；截止時間改了就重新計算。
  useEffect(() => {
    if (!open || at == null || left == null || left <= 0 || left > REMIND_BEFORE_MS || reminded.current === at) return;
    reminded.current = at;
    say("info", `還剩 ${Math.ceil(left / MIN)} 分鐘截止（${formatClock(at)}），還沒點的快點！`);
  }, [open, at, left, say]);

  // 時間到：任何在線團員都會請伺服器收單；失敗或伺服器時間未到就每 3 秒重試。
  const due = open && left != null && left <= 0;
  useEffect(() => {
    if (!due || !online) return;
    let stopped = false;
    const attempt = async () => {
      if (stopped || expiring.current) return;
      expiring.current = true;
      try {
        onSnapshot(await roomGateway.expireRoom(snap.room.id));
      } catch { /* 下一輪重試 */ }
      finally { expiring.current = false; }
    };
    void attempt();
    const timer = setInterval(attempt, EXPIRE_RETRY_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [due, online, snap.room.id, onSnapshot]);

  async function update(deadlineAt: number | null) {
    setBusy(true);
    try { onSnapshot(await roomGateway.setDeadline(snap.room.id, deadlineAt)); }
    catch (e) { say("error", errorText(e)); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  if (due) return <div className="banner info" role="status">已到截止時間，正在自動收單並送單給店家…</div>;

  const urgent = left != null && left <= REMIND_BEFORE_MS;
  const base = Math.max(now, at ?? now);
  return <div className={`card stack deadline-card${urgent ? " urgent" : ""}`} aria-label="截止時間">
    {at == null
      ? <span>沒有設定截止時間，由揪團者手動收單。</span>
      : <span><strong>{formatClock(at)}</strong> 截止，還剩 <strong>{formatLeft(left!)}</strong>；時間到會自動收單並送單給店家。</span>}
    {isOwner && <div className="row">
      {at == null
        ? [15, 30, 60].map((m) => <button key={m} type="button" className="btn small" disabled={busy || !online}
            onClick={() => update(now + m * MIN)}>{m} 分鐘後截止</button>)
        : <>
          <button type="button" className="btn small" disabled={busy || !online} onClick={() => update(base + 10 * MIN)}>延後 10 分鐘</button>
          <button type="button" className="btn small ghost" disabled={busy || !online} onClick={() => update(null)}>取消截止</button>
        </>}
    </div>}
  </div>;
}
