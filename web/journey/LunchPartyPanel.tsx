import type { RoomSnapshot } from "../../shared/contracts";
export function LunchPartyPanel({ snap, disabled, busy, onReady, onPhoto }: {
  snap: RoomSnapshot; disabled: boolean; busy: boolean; onReady(ready: boolean): void; onPhoto(): void;
}) {
  const ids = snap.lunchParty?.readyMemberIds ?? [];
  const mine = ids.includes(snap.me.id);
  const all = ids.length === snap.members.length && snap.members.length > 0;
  return <section className="lunch-party card" aria-label="全團選餐進度">
    <div className="party-heading"><strong>{all ? "🎉 大家都選好了！" : "🍱 午餐集合中"}</strong><span>{ids.length} / {snap.members.length}</span></div>
    <p role="status">已有 {ids.length}／{snap.members.length} 人選好午餐</p>
    <progress aria-label="全團選餐完成進度" max={snap.members.length || 1} value={ids.length} />
    <button className={`btn ${mine ? "green" : "primary"} big`} aria-pressed={mine}
      disabled={disabled || busy || (!mine && snap.myTotalQuantity === 0)} onClick={() => onReady(!mine)}>
      {busy ? "同步中…" : mine ? "✓ 我選好了，點此取消" : "我選好了！"}
    </button>
    <small>{snap.room.status === "closed" ? "已收單，保留選餐紀錄。" : snap.myTotalQuantity === 0 ? "先選一份午餐，再和大家集合。" : "修改餐點會取消完成；這個按鈕不會收單或送單。"}</small>
    <details><summary>看看大家的進度</summary><ul>{snap.members.map((m) => <li key={m.id}>{ids.includes(m.id) ? "✓" : "○"} {m.nickname}{m.id === snap.me.id ? "（我）" : ""}</li>)}</ul></details>
    {snap.lunchParty?.celebration && <button className="btn" onClick={onPhoto}>📷 查看最近一次全團合照</button>}
  </section>;
}
